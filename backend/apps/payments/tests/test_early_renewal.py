from base64 import urlsafe_b64encode
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.payments.models import ManualRechargeSubmission, Payment
from apps.payments.telegram import ManualPaymentTelegramMessage
from apps.product_catalog.models import Plan
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def payment_settings(settings):  # type: ignore[no-untyped-def]
    settings.PAYMENT_CODE_ENCRYPTION_KEY = urlsafe_b64encode(b"e" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_ADMIN_CHAT_ID = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""


def _paid_subscription(*, remaining_days: int, email: str):
    user = create_user(email=email, username=email.split("@", 1)[0].replace("-", "_"))
    subscription, _ = create_trial_for_user(user=user, source_reference="early-renewal")
    plan = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    assert plan.current_version is not None
    # Relative to the real clock, which the trial above was created on.
    now = timezone.now().replace(microsecond=0) + timedelta(days=1)
    subscription.plan_version = plan.current_version
    subscription.status = Subscription.Status.ACTIVE
    subscription.trial_started_at = None
    subscription.trial_ends_at = None
    subscription.current_period_started_at = now - timedelta(days=30 - remaining_days)
    subscription.current_period_ends_at = now + timedelta(days=remaining_days)
    subscription.grace_ends_at = subscription.current_period_ends_at + timedelta(days=7)
    subscription.save()
    return user, subscription, now


def _plan(code: str) -> Plan:
    return Plan.objects.select_related("current_version").get(code=code)


def _post(client: APIClient, plan: Plan, codes: list[str], key: str):
    return client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(plan.id), "recharge_codes": codes},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_early_renewal_is_rejected_before_final_seven_days() -> None:
    user, _, now = _paid_subscription(remaining_days=8, email="eight-days@example.com")
    client = APIClient()
    client.force_authenticate(user)
    with patch("apps.payments.manual_services.timezone.now", return_value=now):
        response = _post(client, _plan("lockin_monthly"), ["1111111111111"], "early-eight-days-001")

    assert response.status_code == 400
    assert not Payment.objects.filter(account__primary_user=user).exists()


@pytest.mark.parametrize(
    ("remaining_days", "plan_code", "expected_months"),
    ((7, "lockin_monthly", 1), (4, "lockin_three_months", 3), (1, "lockin_monthly", 1)),
)
def test_early_renewal_keeps_original_days_and_appends_full_server_duration(
    remaining_days: int, plan_code: str, expected_months: int
) -> None:
    user, subscription, now = _paid_subscription(
        remaining_days=remaining_days, email=f"early-{remaining_days}-{plan_code}@example.com"
    )
    original_end = subscription.current_period_ends_at
    assert original_end is not None
    client = APIClient()
    client.force_authenticate(user)
    with patch("apps.payments.manual_services.timezone.now", return_value=now):
        response = _post(
            client,
            _plan(plan_code),
            [f"12345678901{remaining_days:02d}"],
            f"early-success-{remaining_days}-{expected_months}-001",
        )

    assert response.status_code == 201
    subscription.refresh_from_db()
    submission = ManualRechargeSubmission.objects.get(payment_id=response.json()["payment"]["id"])
    assert submission.is_early_renewal is True
    assert submission.previous_subscription_end_at == original_end
    assert submission.extension_started_at == original_end
    assert subscription.current_period_ends_at == submission.extension_ends_at
    expected_month = ((original_end.month - 1 + expected_months) % 12) + 1
    assert subscription.current_period_ends_at.month == expected_month
    assert subscription.payment_verification == Subscription.PaymentVerification.PROVISIONAL


def test_early_renewal_telegram_message_is_distinguished(
    django_capture_on_commit_callbacks,
) -> None:  # type: ignore[no-untyped-def]
    user, subscription, now = _paid_subscription(
        remaining_days=4, email="early-telegram@example.com"
    )
    original_end = subscription.current_period_ends_at
    assert original_end is not None
    client = APIClient()
    client.force_authenticate(user)
    with (
        patch("apps.payments.manual_services.timezone.now", return_value=now),
        patch("apps.payments.manual_services.notify_manual_payment", return_value=True) as notify,
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = _post(
            client,
            _plan("lockin_monthly"),
            ["6543210987654"],
            "early-telegram-submit-001",
        )
    assert response.status_code == 201
    notify.assert_called_once()
    message = notify.call_args.args[0]
    assert message.event == ManualPaymentTelegramMessage.Event.EARLY_RENEWAL
    assert message.current_expiry == original_end.isoformat()
    assert "Type: Early Renewal" in message.render()


def test_rejecting_early_renewal_removes_only_its_extension() -> None:
    user, subscription, now = _paid_subscription(
        remaining_days=4, email="rollback-early@example.com"
    )
    original_end = subscription.current_period_ends_at
    assert original_end is not None
    client = APIClient()
    client.force_authenticate(user)
    with patch("apps.payments.manual_services.timezone.now", return_value=now):
        submitted = _post(
            client, _plan("lockin_monthly"), ["2222222222222"], "early-rollback-submit-001"
        )
    assert submitted.status_code == 201
    payment_id = submitted.json()["payment"]["id"]
    extended_end = Subscription.objects.get(id=subscription.id).current_period_ends_at
    assert extended_end and extended_end > original_end

    admin = create_user(
        email="early-review-admin@example.com",
        username="early_review_admin",
        is_staff=True,
        is_superuser=True,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    rejected = admin_client.post(
        f"/api/v1/operations/admin/purchases/{payment_id}/manual-review",
        {"decision": "reject", "reason": "Recharge card is invalid"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="early-rollback-review-001",
    )

    assert rejected.status_code == 200
    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.current_period_ends_at == original_end
    assert subscription.payment_verification == Subscription.PaymentVerification.VERIFIED
    assert ManualRechargeSubmission.objects.get(payment_id=payment_id).status == "rejected"


def test_repeated_early_renewal_submission_is_idempotent_and_second_card_is_optional() -> None:
    user, subscription, now = _paid_subscription(
        remaining_days=4, email="early-idempotent@example.com"
    )
    original_end = subscription.current_period_ends_at
    assert original_end is not None
    client = APIClient()
    client.force_authenticate(user)
    payload = ["3333333333333"]
    with patch("apps.payments.manual_services.timezone.now", return_value=now):
        first = _post(client, _plan("lockin_monthly"), payload, "early-idempotent-submit-001")
        replay = _post(client, _plan("lockin_monthly"), payload, "early-idempotent-submit-001")

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["payment"]["id"] == first.json()["payment"]["id"]
    subscription.refresh_from_db()
    assert subscription.current_period_ends_at == original_end + timedelta(days=30)
    assert ManualRechargeSubmission.objects.filter(user=user).count() == 1


def test_recharge_codes_are_exactly_thirteen_digits_and_first_offer_is_one_time() -> None:
    user = create_user(email="first-offer@example.com", username="first_offer")
    create_trial_for_user(user=user, source_reference="first-offer")
    client = APIClient()
    client.force_authenticate(user)
    first_plan = _plan("lockin_first_month")
    invalid = _post(client, first_plan, ["123456789012"], "first-offer-invalid-001")
    assert invalid.status_code == 400

    accepted = _post(client, first_plan, ["4444444444444"], "first-offer-submit-001")
    assert accepted.status_code == 201
    payment_id = accepted.json()["payment"]["id"]
    admin = create_user(
        email="first-offer-admin@example.com",
        username="first_offer_admin",
        is_staff=True,
        is_superuser=True,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    assert (
        admin_client.post(
            f"/api/v1/operations/admin/purchases/{payment_id}/manual-review",
            {"decision": "approve", "reason": "Card value verified"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="first-offer-review-001",
        ).status_code
        == 200
    )

    denied = _post(client, first_plan, ["5555555555555"], "first-offer-repeat-001")
    assert denied.status_code == 400


def test_non_five_lyd_plan_accepts_an_optional_second_card_and_never_exposes_it_to_user() -> None:
    user = create_user(email="two-cards@example.com", username="two_cards")
    create_trial_for_user(user=user, source_reference="two-cards")
    client = APIClient()
    client.force_authenticate(user)
    response = _post(
        client,
        _plan("lockin_monthly"),
        ["6666666666666", "7777777777777"],
        "two-cards-submit-001",
    )

    assert response.status_code == 201
    submission = ManualRechargeSubmission.objects.get(payment_id=response.json()["payment"]["id"])
    assert submission.recharge_codes.count() == 2
    assert "6666666666666" not in str(response.json())
    assert "7777777777777" not in str(response.json())
