"""One bad record must not abort a whole scheduled run.

Both of these jobs are repair and lifecycle passes over the entire estate, so
aborting on the first exception failed exactly the accounts that needed them:
reconciliation stopped healing subscriptions behind the bad row, and the
lifecycle job stopped expiring trials and stopped warning readers whose access
was about to end.

Isolation must not become silence, so a run that skipped anything still fails.
"""

from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db


def _trialing_users(count: int) -> list[Subscription]:
    subscriptions = []
    for index in range(count):
        user = create_user(email=f"isolated-{index}@example.com")
        subscription, _ = create_trial_for_user(user=user, source_reference="test")
        subscriptions.append(subscription)
    return subscriptions


def test_reconciliation_continues_past_a_failing_subscription() -> None:
    subscriptions = _trialing_users(3)
    poisoned = subscriptions[1].id
    seen: list[Any] = []

    def sync(*, subscription_id: Any) -> None:
        seen.append(subscription_id)
        if subscription_id == poisoned:
            raise RuntimeError("this row cannot be synchronised")

    with (
        patch(
            "apps.commerce_integrations.management.commands.reconcile_commerce"
            ".sync_subscription_entitlements",
            side_effect=sync,
        ),
        pytest.raises(CommandError, match="1 record"),
    ):
        call_command("reconcile_commerce")

    # Every subscription was attempted, including the ones after the bad row.
    assert {subscription.id for subscription in subscriptions} <= set(seen)


def test_lifecycle_continues_past_a_failing_subscription() -> None:
    subscriptions = _trialing_users(3)
    poisoned = subscriptions[0].id
    seen: list[Any] = []

    def refresh(*, subscription: Subscription, now: Any = None) -> Subscription:
        seen.append(subscription.id)
        if subscription.id == poisoned:
            raise RuntimeError("this subscription cannot advance")
        return subscription

    with (
        patch(
            "apps.subscriptions.management.commands.process_subscription_lifecycle"
            ".refresh_subscription",
            side_effect=refresh,
        ),
        pytest.raises(CommandError, match="1 subscription"),
    ):
        call_command("process_subscription_lifecycle")

    assert {subscription.id for subscription in subscriptions} <= set(seen)


def test_a_clean_reconciliation_run_still_succeeds() -> None:
    _trialing_users(2)

    call_command("reconcile_commerce")
    call_command("process_subscription_lifecycle")


def test_a_skipped_record_is_reported_as_a_metric() -> None:
    subscriptions = _trialing_users(1)

    with (
        patch(
            "apps.commerce_integrations.management.commands.reconcile_commerce.providers"
        ) as observability,
        patch(
            "apps.commerce_integrations.management.commands.reconcile_commerce"
            ".sync_subscription_entitlements",
            side_effect=RuntimeError("nope"),
        ),
        pytest.raises(CommandError),
    ):
        call_command("reconcile_commerce")

    assert subscriptions
    observability.metric_sink.increment.assert_any_call(
        "commerce.reconciliation.record_failed", attributes={"stage": "subscription"}
    )


def test_expiry_reminders_still_reach_the_accounts_behind_a_bad_row() -> None:
    """The user-visible half of the isolation.

    A reader whose trial ends in three days is warned even though an earlier
    subscription in the same pass could not advance.
    """

    from apps.notifications.models import Notification

    healthy_user = create_user(email="warned-reader@example.com")
    healthy, _ = create_trial_for_user(user=healthy_user, source_reference="test")
    Subscription.objects.filter(id=healthy.id).update(
        trial_ends_at=timezone.now() + timedelta(days=3)
    )
    broken_user = create_user(email="broken-reader@example.com")
    broken, _ = create_trial_for_user(user=broken_user, source_reference="test")

    def refresh(*, subscription: Subscription, now: Any = None) -> Subscription:
        if subscription.id == broken.id:
            raise RuntimeError("this subscription cannot advance")
        return subscription

    with (
        patch(
            "apps.subscriptions.management.commands.process_subscription_lifecycle"
            ".refresh_subscription",
            side_effect=refresh,
        ),
        pytest.raises(CommandError),
    ):
        call_command("process_subscription_lifecycle")

    assert Notification.objects.filter(recipient_id=healthy_user.id).exists()
