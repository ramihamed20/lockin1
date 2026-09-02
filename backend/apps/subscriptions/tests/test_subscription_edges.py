from datetime import UTC, datetime, timedelta
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.entitlements.models import EntitlementDefinition
from apps.entitlements.services import grant_manual_entitlement
from apps.notifications.models import Notification
from apps.product_catalog.models import Plan, PlanVersion, Price, Product
from apps.subscriptions.models import Subscription, SubscriptionAccount, SubscriptionTransition
from apps.subscriptions.serializers import SubscriptionSerializer
from apps.subscriptions.services import (
    advance_billing_period,
    create_pending_subscription,
    create_trial_for_user,
    get_or_create_individual_account,
    refresh_subscription,
    transition_subscription,
)

pytestmark = pytest.mark.django_db


def _trial(email: str = "subscription-edge@example.com"):
    user = create_user(email=email, username=email.split("@", 1)[0].replace("-", "_"))
    subscription, _ = create_trial_for_user(user=user, source_reference="subscription-edge")
    return user, subscription


def test_subscription_serializer_exposes_the_current_access_deadline() -> None:
    _, subscription = _trial("subscription-expiry-contract@example.com")
    trial_end = subscription.trial_ends_at
    assert SubscriptionSerializer(subscription).data["expires_at"] == trial_end

    subscription.status = Subscription.Status.ACTIVE
    subscription.current_period_ends_at = trial_end + timedelta(days=30)
    assert SubscriptionSerializer(subscription).data["expires_at"] == (
        subscription.current_period_ends_at
    )

    subscription.status = Subscription.Status.GRACE
    subscription.grace_ends_at = subscription.current_period_ends_at + timedelta(days=7)
    assert SubscriptionSerializer(subscription).data["expires_at"] == subscription.grace_ends_at

    subscription.status = Subscription.Status.EXPIRED
    assert SubscriptionSerializer(subscription).data["expires_at"] is None


def test_subscription_api_current_cancel_and_admin_transition() -> None:
    empty_user = create_user(email="no-subscription@example.com", username="no_subscription")
    empty_client = APIClient()
    empty_client.force_authenticate(empty_user)
    assert empty_client.get("/api/v1/subscriptions/current").json() == {"subscription": None}
    assert empty_client.post("/api/v1/subscriptions/current/cancel").status_code == 404

    user, subscription = _trial()
    client = APIClient()
    client.force_authenticate(user)
    current = client.get("/api/v1/subscriptions/current")
    cancelled = client.post("/api/v1/subscriptions/current/cancel", {}, format="json")
    repeated = client.post("/api/v1/subscriptions/current/cancel", {}, format="json")
    assert current.status_code == 200
    assert current.json()["subscription"]["status"] == Subscription.Status.TRIALING
    assert current.json()["subscription"]["expires_at"] == (
        subscription.trial_ends_at.isoformat().replace("+00:00", "Z")
    )
    assert cancelled.status_code == 200
    assert repeated.status_code == 200
    assert repeated.json()["cancel_at_period_end"] is True

    denied = client.post(
        f"/api/v1/subscriptions/admin/{subscription.id}/transition",
        {"to_status": "suspended", "reason_code": "admin_review"},
        format="json",
    )
    assert denied.status_code == 403
    admin = create_user(
        email="subscription-edge-admin@example.com",
        username="subscription_edge_admin",
        is_superuser=True,
        is_staff=True,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    transitioned = admin_client.post(
        f"/api/v1/subscriptions/admin/{subscription.id}/transition",
        {"to_status": "suspended", "reason_code": "admin_review"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="subscription-edge-admin-001",
    )
    replay = admin_client.post(
        f"/api/v1/subscriptions/admin/{subscription.id}/transition",
        {"to_status": "suspended", "reason_code": "admin_review"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="subscription-edge-admin-001",
    )
    invalid = admin_client.post(
        f"/api/v1/subscriptions/admin/{uuid4()}/transition",
        {"to_status": "suspended", "reason_code": "missing"},
        format="json",
    )
    assert transitioned.status_code == 200
    assert replay.status_code == 200
    assert transitioned.json()["status"] == Subscription.Status.SUSPENDED
    assert invalid.status_code == 400


def test_direct_manual_entitlement_allows_access_without_a_live_subscription() -> None:
    user, subscription = _trial("manual-access@example.com")
    subscription.status = Subscription.Status.CANCELLED
    subscription.save(update_fields=("status", "updated_at"))
    entitlement, _ = EntitlementDefinition.objects.get_or_create(
        code="focus.workspace", defaults={"title": "Focus workspace"}
    )
    admin = create_user(
        email="manual-access-admin@example.com",
        username="manual_access_admin",
        is_superuser=True,
        is_staff=True,
    )
    grant_manual_entitlement(
        user=user,
        entitlement_code=entitlement.code,
        source_id=uuid4(),
        starts_at=datetime.now(UTC),
        ends_at=None,
        actor=admin,
        reason_code="test_direct_access",
    )
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/v1/subscriptions/current")
    assert response.json()["subscription"]["access_allowed"] is True


def test_billing_period_math_handles_calendar_edges_and_validation() -> None:
    start = datetime(2024, 1, 31, 12, tzinfo=UTC)
    assert advance_billing_period(start, interval=Price.Interval.DAY, count=7) == start + timedelta(
        days=7
    )
    assert advance_billing_period(start, interval=Price.Interval.MONTH, count=1) == datetime(
        2024, 2, 29, 12, tzinfo=UTC
    )
    assert advance_billing_period(start, interval=Price.Interval.YEAR, count=1) == datetime(
        2025, 1, 31, 12, tzinfo=UTC
    )
    with pytest.raises(ValueError, match="positive"):
        advance_billing_period(start, interval=Price.Interval.DAY, count=0)
    with pytest.raises(ValueError, match="Unsupported"):
        advance_billing_period(start, interval="week", count=1)


def test_pending_subscription_and_transition_edge_cases() -> None:
    user = create_user(email="pending-edge@example.com", username="pending_edge")
    account = get_or_create_individual_account(user=user)
    same_account = get_or_create_individual_account(user=user)
    assert same_account.id == account.id
    monthly = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    assert monthly.current_version is not None
    pending, created = create_pending_subscription(
        account=account,
        plan_version=monthly.current_version,
        idempotency_key="pending-edge-create-001",
    )
    replay, replay_created = create_pending_subscription(
        account=account,
        plan_version=monthly.current_version,
        idempotency_key="pending-edge-create-001",
    )
    same_pending, same_pending_created = create_pending_subscription(
        account=account,
        plan_version=monthly.current_version,
        idempotency_key="pending-edge-create-002",
    )
    assert (created, replay_created, same_pending_created) == (True, False, False)
    assert pending.id == replay.id == same_pending.id
    with pytest.raises(ValueError, match="idempotency"):
        create_pending_subscription(
            account=account, plan_version=monthly.current_version, idempotency_key=""
        )

    product = Product.objects.create(code="pending-edge-product", title="Pending edge")
    other_plan = Plan.objects.create(
        product=product, code="pending-edge-plan", status=Plan.Status.ACTIVE
    )
    other_version = PlanVersion.objects.create(
        plan=other_plan,
        version=1,
        title="Other pending",
        published_at=datetime.now(UTC),
    )
    with pytest.raises(ValueError, match="pending subscription"):
        create_pending_subscription(
            account=account, plan_version=other_version, idempotency_key="pending-edge-other-001"
        )

    effective = datetime.now(UTC)
    activated = transition_subscription(
        subscription_id=pending.id,
        to_status=Subscription.Status.ACTIVE,
        reason_code="paid",
        source=SubscriptionTransition.Source.SYSTEM,
        effective_at=effective,
        idempotency_key="transition-edge-001",
        period_started_at=effective,
        period_ends_at=effective + timedelta(days=30),
    )
    duplicate = transition_subscription(
        subscription_id=pending.id,
        to_status=Subscription.Status.ACTIVE,
        reason_code="paid",
        source=SubscriptionTransition.Source.SYSTEM,
        effective_at=effective,
        idempotency_key="transition-edge-001",
    )
    out_of_order = transition_subscription(
        subscription_id=pending.id,
        to_status=Subscription.Status.SUSPENDED,
        reason_code="late_event",
        source=SubscriptionTransition.Source.SYSTEM,
        effective_at=effective - timedelta(days=1),
        idempotency_key="transition-edge-old-001",
    )
    assert activated.changed is True
    assert duplicate.changed is False
    assert out_of_order.changed is False
    with pytest.raises(ValueError, match="must end after"):
        transition_subscription(
            subscription_id=pending.id,
            to_status=Subscription.Status.SUSPENDED,
            reason_code="bad_period",
            source=SubscriptionTransition.Source.SYSTEM,
            effective_at=effective + timedelta(minutes=1),
            idempotency_key="transition-edge-bad-period-001",
            period_started_at=effective,
            period_ends_at=effective,
        )


def test_refresh_cancellation_no_grace_and_scheduler_command() -> None:
    user, trial = _trial("trial-cancel-edge@example.com")
    trial.cancel_at_period_end = True
    trial.save(update_fields=("cancel_at_period_end", "updated_at"))
    refreshed = refresh_subscription(subscription=trial, now=trial.trial_ends_at)
    assert refreshed.status == Subscription.Status.CANCELLED

    product = Product.objects.create(code="zero-grace-product", title="Zero grace")
    plan = Plan.objects.create(product=product, code="zero-grace", status=Plan.Status.ACTIVE)
    version = PlanVersion.objects.create(
        plan=plan,
        version=1,
        title="Zero grace",
        grace_days=0,
        published_at=datetime.now(UTC),
    )
    account = SubscriptionAccount.objects.create(
        kind=SubscriptionAccount.Kind.INDIVIDUAL,
        primary_user=create_user(email="zero-grace@example.com", username="zero_grace"),
        display_name="Zero grace",
    )
    end = datetime.now(UTC) - timedelta(minutes=1)
    active = Subscription.objects.create(
        account=account,
        plan_version=version,
        status=Subscription.Status.ACTIVE,
        started_at=end - timedelta(days=30),
        current_period_started_at=end - timedelta(days=30),
        current_period_ends_at=end,
    )
    assert (
        refresh_subscription(subscription=active, now=datetime.now(UTC)).status
        == Subscription.Status.EXPIRED
    )

    output = StringIO()
    with (
        patch(
            "apps.subscriptions.management.commands.run_subscription_scheduler.Event"
        ) as event_factory,
        patch(
            "apps.subscriptions.management.commands.run_subscription_scheduler.call_command"
        ) as lifecycle,
    ):
        event = event_factory.return_value
        event.is_set.side_effect = [False, True]
        call_command("run_subscription_scheduler", stdout=output)
    lifecycle.assert_called_once_with("process_subscription_lifecycle")
    event.wait.assert_called_once()
    assert "Subscription scheduler running" in output.getvalue()


def test_lifecycle_command_covers_localized_reminders_and_authoritative_transitions() -> None:
    # Keep the authoritative scheduler clock after the trial-creation events so
    # lifecycle transitions are not (correctly) treated as out of order.
    now = datetime(2026, 9, 10, 12, tzinfo=UTC)
    arabic_user, arabic = _trial("arabic-reminder@example.com")
    arabic_user.preferred_language = "ar"
    arabic_user.save(update_fields=("preferred_language", "updated_at"))
    arabic.trial_ends_at = now + timedelta(days=1)
    arabic.current_period_ends_at = arabic.trial_ends_at
    arabic.save(update_fields=("trial_ends_at", "current_period_ends_at", "updated_at"))

    _, english = _trial("english-reminder@example.com")
    english.status = Subscription.Status.ACTIVE
    english.trial_started_at = None
    english.trial_ends_at = None
    english.current_period_ends_at = now + timedelta(days=3)
    english.save(
        update_fields=(
            "status",
            "trial_started_at",
            "trial_ends_at",
            "current_period_ends_at",
            "updated_at",
        )
    )

    _, expired_grace = _trial("expired-grace-command@example.com")
    expired_grace.status = Subscription.Status.GRACE
    expired_grace.trial_started_at = None
    expired_grace.trial_ends_at = None
    expired_grace.current_period_started_at = now - timedelta(days=37)
    expired_grace.current_period_ends_at = now - timedelta(days=7)
    expired_grace.grace_ends_at = now
    expired_grace.save(
        update_fields=(
            "status",
            "trial_started_at",
            "trial_ends_at",
            "current_period_started_at",
            "current_period_ends_at",
            "grace_ends_at",
            "updated_at",
        )
    )

    _, enters_grace = _trial("enters-grace-command@example.com")
    monthly = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    assert monthly.current_version is not None
    enters_grace.plan_version = monthly.current_version
    enters_grace.status = Subscription.Status.ACTIVE
    enters_grace.trial_started_at = None
    enters_grace.trial_ends_at = None
    enters_grace.current_period_started_at = now - timedelta(days=30)
    enters_grace.current_period_ends_at = now
    enters_grace.grace_ends_at = now + timedelta(days=7)
    enters_grace.save(
        update_fields=(
            "plan_version",
            "status",
            "trial_started_at",
            "trial_ends_at",
            "current_period_started_at",
            "current_period_ends_at",
            "grace_ends_at",
            "updated_at",
        )
    )

    _, no_reminder = _trial("no-reminder-command@example.com")
    no_reminder.status = Subscription.Status.ACTIVE
    no_reminder.trial_started_at = None
    no_reminder.trial_ends_at = None
    no_reminder.current_period_ends_at = now + timedelta(days=5)
    no_reminder.save(
        update_fields=(
            "status",
            "trial_started_at",
            "trial_ends_at",
            "current_period_ends_at",
            "updated_at",
        )
    )

    output = StringIO()
    with patch(
        "apps.subscriptions.management.commands.process_subscription_lifecycle.timezone.now",
        return_value=now,
    ):
        call_command("process_subscription_lifecycle", stdout=output)

    arabic_notification = Notification.objects.get(
        recipient=arabic_user, template_key="billing.expiry.1_days"
    )
    assert arabic_notification.title == "ينتهي الاشتراك غدًا"
    assert Notification.objects.filter(template_key="billing.expiry.3_days").count() == 1
    expired_grace.refresh_from_db()
    enters_grace.refresh_from_db()
    assert expired_grace.status == Subscription.Status.EXPIRED
    assert enters_grace.status == Subscription.Status.GRACE
    assert AuditRecord.objects.filter(action="subscription_expired").count() == 1
    assert "2 transitions; 2 reminders" in output.getvalue()
