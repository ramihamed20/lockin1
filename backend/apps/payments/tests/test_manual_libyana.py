import base64
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.notifications.models import Notification
from apps.payments.models import ManualRechargeSubmission, Payment
from apps.product_catalog.models import Plan, Price
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user, refresh_subscription

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def manual_payment_settings(settings):  # type: ignore[no-untyped-def]
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""


def _trial_user(*, email: str = "libyana@example.com"):
    username = email.split("@", maxsplit=1)[0].replace("-", "_")[:30]
    user = create_user(email=email, username=username)
    subscription, created = create_trial_for_user(user=user, source_reference="test")
    assert created is True
    return user, subscription


def _monthly_plan_and_price() -> tuple[Plan, Price]:
    plan = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    assert plan.current_version_id is not None
    price = Price.objects.get(
        plan_version_id=plan.current_version_id,
        currency="LYD",
        status=Price.Status.ACTIVE,
    )
    return plan, price


def _submit(client: APIClient, *, plan: Plan, code: str, key: str):
    return client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(plan.id), "recharge_code": code},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_new_user_receives_exactly_one_seven_day_trial() -> None:
    user, first = _trial_user(email="single-trial@example.com")
    second, created = create_trial_for_user(user=user, source_reference="oauth-reconnect")

    assert first.trial_ends_at - first.trial_started_at == timedelta(days=7)
    assert second.id == first.id
    assert created is False
    assert Subscription.objects.filter(account__primary_user=user).count() == 1


def test_submission_uses_server_plan_terms_and_grants_provisional_access() -> None:
    user, trial = _trial_user()
    plan, price = _monthly_plan_and_price()
    client = APIClient()
    client.force_authenticate(user)

    tampered = client.post(
        "/api/v1/payments/manual-libyana",
        {
            "plan_id": str(plan.id),
            "recharge_code": "1234 5678 9012",
            "price": 1,
            "duration": 999,
            "status": "active",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="manual-tamper-attempt-001",
    )
    response = _submit(
        client,
        plan=plan,
        code="1234 5678 9012",
        key="manual-payment-submit-001",
    )

    assert tampered.status_code == 400
    assert response.status_code == 201
    payment = Payment.objects.get(id=response.json()["payment"]["id"])
    submission = payment.manual_submission
    trial.refresh_from_db()
    assert payment.amount_minor == price.amount_minor
    assert payment.currency == price.currency
    assert submission.status == ManualRechargeSubmission.Status.PENDING
    assert "123456789012" not in submission.recharge_code_ciphertext
    assert trial.status == Subscription.Status.ACTIVE
    assert trial.payment_verification == Subscription.PaymentVerification.PROVISIONAL
    assert trial.current_period_ends_at == trial.trial_ends_at + timedelta(days=30)
    assert "recharge_code" not in response.json()["submission"]
    assert AuditRecord.objects.filter(action="payment_submitted").exists()


def test_manual_recharge_submission_requires_csrf_for_session_authentication() -> None:
    user, _ = _trial_user(email="csrf-payment@example.com")
    plan, _ = _monthly_plan_and_price()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)

    response = _submit(
        client,
        plan=plan,
        code="222233334444",
        key="manual-csrf-rejected-001",
    )

    assert response.status_code == 403
    assert not ManualRechargeSubmission.objects.filter(user=user).exists()


def test_duplicate_recharge_code_is_rejected_for_another_user() -> None:
    first_user, _ = _trial_user(email="first-card@example.com")
    second_user, _ = _trial_user(email="second-card@example.com")
    plan, _ = _monthly_plan_and_price()
    first_client = APIClient()
    first_client.force_authenticate(first_user)
    second_client = APIClient()
    second_client.force_authenticate(second_user)

    assert _submit(
        first_client,
        plan=plan,
        code="5555-4444-3333",
        key="manual-duplicate-first-001",
    ).status_code == 201
    duplicate = _submit(
        second_client,
        plan=plan,
        code="555544443333",
        key="manual-duplicate-second-001",
    )

    assert duplicate.status_code == 400
    assert ManualRechargeSubmission.objects.count() == 1


def test_only_admin_can_review_and_approval_is_idempotent() -> None:
    user, subscription = _trial_user(email="approval-user@example.com")
    plan, _ = _monthly_plan_and_price()
    client = APIClient()
    client.force_authenticate(user)
    submitted = _submit(
        client,
        plan=plan,
        code="987654321012",
        key="manual-approval-submit-001",
    )
    payment_id = submitted.json()["payment"]["id"]
    expected_end = Subscription.objects.get(id=subscription.id).current_period_ends_at

    denied = client.post(
        f"/api/v1/operations/admin/purchases/{payment_id}/manual-review",
        {"decision": "approve", "reason": "Card is valid"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="manual-review-denied-001",
    )
    assert denied.status_code == 403

    admin = create_user(
        email="payment-admin@example.com",
        username="payment_admin",
        is_staff=True,
        is_superuser=True,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    first = admin_client.post(
        f"/api/v1/operations/admin/purchases/{payment_id}/manual-review",
        {"decision": "approve", "reason": "Card value verified"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="manual-review-approve-001",
    )
    repeated = admin_client.post(
        f"/api/v1/operations/admin/purchases/{payment_id}/manual-review",
        {"decision": "approve", "reason": "Repeated safe request"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="manual-review-approve-002",
    )

    assert first.status_code == 200
    assert repeated.status_code == 200
    subscription.refresh_from_db()
    submission = ManualRechargeSubmission.objects.get(payment_id=payment_id)
    assert subscription.payment_verification == Subscription.PaymentVerification.VERIFIED
    assert subscription.current_period_ends_at == expected_end
    assert submission.recharge_code_ciphertext == ""
    assert AuditRecord.objects.filter(action="payment_approved").count() == 1


def test_rejection_revokes_only_provisional_access_and_keeps_account_data() -> None:
    user, subscription = _trial_user(email="rejection-user@example.com")
    user.full_name = "Saved Study Owner"
    user.save(update_fields=("full_name", "updated_at"))
    now = datetime(2026, 9, 20, 10, tzinfo=UTC)
    subscription.status = Subscription.Status.EXPIRED
    subscription.trial_started_at = None
    subscription.trial_ends_at = None
    subscription.current_period_started_at = now - timedelta(days=31)
    subscription.current_period_ends_at = now - timedelta(days=1)
    subscription.ended_at = now - timedelta(days=1)
    subscription.save()
    plan, _ = _monthly_plan_and_price()
    client = APIClient()
    client.force_authenticate(user)
    with patch("apps.payments.manual_services.timezone.now", return_value=now):
        response = _submit(
            client,
            plan=plan,
            code="111122223333",
            key="manual-rejection-submit-001",
        )
    payment_id = response.json()["payment"]["id"]
    admin = create_user(
        email="rejection-admin@example.com",
        username="rejection_admin",
        is_staff=True,
        is_superuser=True,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    rejected = admin_client.post(
        f"/api/v1/operations/admin/purchases/{payment_id}/manual-review",
        {"decision": "reject", "reason": "Recharge code invalid"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="manual-review-reject-001",
    )

    assert rejected.status_code == 200
    subscription.refresh_from_db()
    user.refresh_from_db()
    assert subscription.status == Subscription.Status.EXPIRED
    assert subscription.payment_verification == Subscription.PaymentVerification.VERIFIED
    assert user.full_name == "Saved Study Owner"
    assert user.__class__.objects.filter(id=user.id).exists()
    assert AuditRecord.objects.filter(action="payment_rejected").exists()


def test_grace_renewal_remains_anchored_to_original_expiration() -> None:
    user, subscription = _trial_user(email="grace-renewal@example.com")
    plan, _ = _monthly_plan_and_price()
    expiration = datetime(2026, 9, 1, 12, tzinfo=UTC)
    renewed_at = datetime(2026, 9, 8, 9, tzinfo=UTC)
    subscription.status = Subscription.Status.GRACE
    subscription.current_period_started_at = expiration - timedelta(days=30)
    subscription.current_period_ends_at = expiration
    subscription.grace_ends_at = expiration + timedelta(days=7)
    subscription.trial_started_at = None
    subscription.trial_ends_at = None
    subscription.save()
    client = APIClient()
    client.force_authenticate(user)
    with patch("apps.payments.manual_services.timezone.now", return_value=renewed_at):
        response = _submit(
            client,
            plan=plan,
            code="777788889999",
            key="manual-grace-renewal-001",
        )

    assert response.status_code == 201
    subscription.refresh_from_db()
    assert subscription.current_period_ends_at == datetime(2026, 10, 1, 12, tzinfo=UTC)


def test_lifecycle_reminders_grace_and_expiration_are_server_driven() -> None:
    user, subscription = _trial_user(email="lifecycle@example.com")
    plan, _ = _monthly_plan_and_price()
    version = plan.current_version
    assert version is not None
    now = datetime(2026, 8, 29, 10, tzinfo=UTC)
    subscription.plan_version = version
    subscription.status = Subscription.Status.ACTIVE
    subscription.trial_started_at = None
    subscription.trial_ends_at = None
    subscription.current_period_started_at = now - timedelta(days=23)
    subscription.current_period_ends_at = now + timedelta(days=7)
    subscription.grace_ends_at = now + timedelta(days=14)
    subscription.save()

    with patch(
        "apps.subscriptions.management.commands.process_subscription_lifecycle.timezone.now",
        return_value=now,
    ):
        call_command("process_subscription_lifecycle")
        call_command("process_subscription_lifecycle")
    assert Notification.objects.filter(
        recipient=user,
        template_key="billing.expiry.7_days",
    ).count() == 1

    grace = refresh_subscription(
        subscription=subscription,
        now=subscription.current_period_ends_at,
    )
    assert grace.status == Subscription.Status.GRACE
    assert grace.grace_ends_at - grace.current_period_ends_at == timedelta(days=7)
    expired = refresh_subscription(subscription=grace, now=grace.grace_ends_at)
    assert expired.status == Subscription.Status.EXPIRED
    assert user.__class__.objects.filter(id=user.id).exists()
