"""Subscription state and entitlement state converge, or neither is committed.

Entitlements used to be granted only by a subscriber on
``SubscriptionStatusChanged``, dispatched after commit through a bus that
isolates handlers by swallowing their exceptions. So a transient failure there
-- a lock timeout, a dropped connection -- produced an ACTIVE subscription with
no grant, no error the request could see, and a reader who had just paid being
refused every study endpoint until reconciliation next ran.

The grant is now written inside the transaction that changes the subscription.
The subscriber and the reconciliation job both remain, as repair.
"""

from typing import Any
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.models import EntitlementGrant
from apps.entitlements.services import entitlement_decision
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import (
    create_trial_for_user,
    get_or_create_individual_account,
    transition_subscription,
)

pytestmark = pytest.mark.django_db


def test_a_new_trial_is_entitled_without_waiting_for_a_subscriber() -> None:
    user = create_user(email="converged-trial@example.com")

    create_trial_for_user(user=user, source_reference="test")

    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed is True


def test_a_failed_grant_rolls_back_the_transition_that_required_it() -> None:
    """Fail together rather than drift apart.

    A subscription reported as ACTIVE while the reader cannot open anything is
    worse than a submission that fails and can be retried.
    """

    user = create_user(email="failed-grant@example.com")
    subscription, _ = create_trial_for_user(user=user, source_reference="test")
    before = Subscription.objects.get(id=subscription.id).status

    with (
        patch(
            "apps.entitlements.services.sync_subscription_entitlements",
            side_effect=RuntimeError("entitlement write failed"),
        ),
        pytest.raises(RuntimeError),
    ):
        transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.ACTIVE,
            reason_code="test_activation",
            source=SubscriptionTransition.Source.SYSTEM,
            effective_at=timezone.now(),
            idempotency_key="converge-failure-0001",
        )

    subscription.refresh_from_db()
    assert subscription.status == before
    assert not SubscriptionTransition.objects.filter(
        subscription=subscription, idempotency_key="converge-failure-0001"
    ).exists()


def test_converging_twice_grants_nothing_twice() -> None:
    """The subscriber still runs after commit; it must stay idempotent."""

    user = create_user(email="idempotent-grant@example.com")
    subscription, _ = create_trial_for_user(user=user, source_reference="test")
    grants = EntitlementGrant.objects.filter(user=user).count()

    from apps.entitlements.services import sync_subscription_entitlements

    sync_subscription_entitlements(subscription_id=subscription.id)
    sync_subscription_entitlements(subscription_id=subscription.id)

    assert EntitlementGrant.objects.filter(user=user).count() == grants


def test_reconciliation_still_repairs_a_grant_removed_out_of_band() -> None:
    """The repair path is preserved, not replaced."""

    user = create_user(email="repaired-grant@example.com")
    create_trial_for_user(user=user, source_reference="test")
    EntitlementGrant.objects.filter(user=user).update(
        status=EntitlementGrant.Status.REVOKED, revoked_at=timezone.now()
    )
    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed is False

    call_command("reconcile_commerce")

    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed is True


def test_a_swallowed_subscriber_failure_is_reported(settings: Any) -> None:
    """Isolation is not silence: the bus reports what it swallows."""

    from platform_core.events import domain_events
    from platform_core.events.base import DomainEvent

    class Probe(DomainEvent):
        event_name = "test.probe"

    def explode(event: DomainEvent) -> None:
        raise RuntimeError("subscriber failed")

    unsubscribe = domain_events.subscribe(Probe, explode)
    try:
        with patch("platform_core.observability.providers") as observability:
            domain_events.publish(Probe())
    finally:
        unsubscribe()

    observability.metric_sink.increment.assert_called_once()
    assert observability.metric_sink.increment.call_args[0][0] == "events.subscriber.failed"
    observability.error_reporter.capture_exception.assert_called_once()


def test_an_account_without_a_subscription_is_created_and_entitled_together() -> None:
    user = create_user(email="account-and-grant@example.com")
    account = get_or_create_individual_account(user=user)

    create_trial_for_user(user=user, source_reference="test")

    assert account.subscriptions.count() == 1
    assert EntitlementGrant.objects.filter(
        user=user, status=EntitlementGrant.Status.ACTIVE
    ).exists()


@pytest.mark.parametrize(
    ("target_status", "reason"),
    (
        (Subscription.Status.CANCELLED, "admin_cancelled"),
        (Subscription.Status.SUSPENDED, "admin_suspended"),
    ),
)
def test_stop_states_deny_even_if_a_subscription_grant_is_stale(
    target_status: str, reason: str
) -> None:
    user = create_user(email=f"{target_status}-access@example.com")
    subscription, _ = create_trial_for_user(user=user, source_reference="test")
    before_transitions = subscription.transitions.count()

    transition_subscription(
        subscription_id=subscription.id,
        to_status=target_status,
        reason_code=reason,
        source=SubscriptionTransition.Source.ADMIN,
        effective_at=timezone.now(),
        idempotency_key=f"stop-access-{target_status}-001",
    )

    grant = EntitlementGrant.objects.get(
        user=user,
        source_type=EntitlementGrant.SourceType.SUBSCRIPTION,
        source_id=subscription.id,
        entitlement__code="content.premium",
    )
    assert grant.status == EntitlementGrant.Status.REVOKED
    # Simulate legacy drift: the read-side authority must still fail closed.
    EntitlementGrant.objects.filter(id=grant.id).update(
        status=EntitlementGrant.Status.ACTIVE,
        revoked_at=None,
    )

    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed is False
    client = APIClient()
    client.force_authenticate(user)
    assert client.get("/api/v1/bookmarks").status_code == 403
    assert subscription.transitions.count() == before_transitions + 1


def test_suspended_subscription_reactivation_restores_canonical_access() -> None:
    user = create_user(email="reactivated-access@example.com")
    subscription, _ = create_trial_for_user(user=user, source_reference="test")
    now = timezone.now()
    transition_subscription(
        subscription_id=subscription.id,
        to_status=Subscription.Status.SUSPENDED,
        reason_code="admin_suspended",
        source=SubscriptionTransition.Source.ADMIN,
        effective_at=now,
        idempotency_key="reactivation-suspend-001",
    )
    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed is False

    transition_subscription(
        subscription_id=subscription.id,
        to_status=Subscription.Status.ACTIVE,
        reason_code="admin_reactivated",
        source=SubscriptionTransition.Source.ADMIN,
        effective_at=now,
        idempotency_key="reactivation-active-001",
    )

    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed is True
