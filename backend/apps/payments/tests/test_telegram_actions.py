"""Approve and reject a manual payment from a Telegram button.

The webhook is a public URL that moves money-shaped state, so these tests are as
much about what it refuses as what it does. Every decision must land through
``review_manual_recharge`` -- the same function the operations console calls --
so the subscription, invoice, notification and audit consequences are identical
whichever button was pressed.
"""

import base64
import json
from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.payments.models import (
    ManualRechargeSubmission,
    Payment,
    PaymentTransition,
    TelegramPaymentOperator,
)
from apps.payments.telegram import build_callback_data, payment_action_keyboard
from apps.product_catalog.models import Plan, Price
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db

WEBHOOK = "/api/v1/billing/webhooks/telegram"
SECRET = "telegram-webhook-secret-token-for-tests-0001"  # noqa: S105 - test fixture value.
CHAT_ID = "-1001234567890"
OPERATOR_TELEGRAM_ID = "556677889"


@pytest.fixture(autouse=True)
def telegram_settings(settings: Any) -> None:
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = "1234567:test-bot-token"  # noqa: S105 - fixture value.
    settings.TELEGRAM_PAYMENT_CHAT_ID = CHAT_ID
    settings.TELEGRAM_ADMIN_CHAT_ID = ""
    settings.TELEGRAM_WEBHOOK_SECRET_TOKEN = SECRET


@pytest.fixture(autouse=True)
def silent_telegram():
    """No test may reach the network; every call is observed instead."""

    with patch("apps.payments.telegram._call", return_value=True) as call:
        yield call


def _operator(*, capability: bool = True) -> TelegramPaymentOperator:
    user = create_user(email="tg-operator@example.com", username="tg_operator")
    if capability:
        user.groups.add(Group.objects.get(name=Role.ADMINISTRATOR.value))
    return TelegramPaymentOperator.objects.create(
        user=user, telegram_user_id=OPERATOR_TELEGRAM_ID, label="Night shift"
    )


def _monthly_plan() -> Plan:
    plan = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    assert Price.objects.filter(
        plan_version_id=plan.current_version_id, currency="LYD", status=Price.Status.ACTIVE
    ).exists()
    return plan


def _pending_payment(
    *, email: str = "tg-payer@example.com", code: str = "1122334455667"
) -> Payment:
    user = create_user(email=email, username=email.split("@")[0].replace("-", "_")[:30])
    create_trial_for_user(user=user, source_reference="test")
    client = APIClient()
    client.force_authenticate(user)
    response = client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(_monthly_plan().id), "recharge_codes": [code]},
        format="json",
        HTTP_IDEMPOTENCY_KEY=f"tg-submit-{code}",
    )
    assert response.status_code == 201
    return Payment.objects.get(id=response.json()["payment"]["id"])


def _paid_subscription(*, remaining_days: int, email: str) -> tuple[Any, Subscription]:
    """An active paid period ending soon, with the trial window cleared.

    Mirrors the fixture in test_early_renewal: leaving trial_ends_at behind a
    rewritten period violates subscription_trial_window_valid.
    """

    user = create_user(email=email, username=email.split("@")[0].replace("-", "_")[:30])
    subscription, _ = create_trial_for_user(user=user, source_reference="test")
    now = timezone.now()
    subscription.status = Subscription.Status.ACTIVE
    subscription.trial_started_at = None
    subscription.trial_ends_at = None
    subscription.current_period_started_at = now - timedelta(days=30 - remaining_days)
    subscription.current_period_ends_at = now + timedelta(days=remaining_days)
    subscription.grace_ends_at = subscription.current_period_ends_at + timedelta(days=7)
    subscription.save()
    return user, subscription


def _update(
    *,
    payment: Payment | None = None,
    action: str = "approve",
    data: str | None = None,
    chat_id: str = CHAT_ID,
    from_id: str = OPERATOR_TELEGRAM_ID,
) -> dict[str, Any]:
    if data is None:
        assert payment is not None
        data = build_callback_data(action=action, payment_id=payment.id)
    return {
        "update_id": 42,
        "callback_query": {
            "id": "callback-1",
            "from": {"id": from_id},
            "data": data,
            "message": {
                "message_id": 900,
                "text": "🔔 طلب اشتراك جديد",
                "chat": {"id": chat_id},
            },
        },
    }


def _post(update: dict[str, Any], *, secret: str | None = SECRET) -> Any:
    client = APIClient()
    headers = {} if secret is None else {"HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN": secret}
    return client.post(WEBHOOK, data=json.dumps(update), content_type="application/json", **headers)


# --------------------------------------------------------------------------
# The notification carries the buttons
# --------------------------------------------------------------------------


def test_a_pending_notification_carries_approve_and_reject_buttons(
    silent_telegram: Any, django_capture_on_commit_callbacks: Any
) -> None:
    # The notification is dispatched on commit, which a test transaction never
    # reaches on its own.
    with django_capture_on_commit_callbacks(execute=True):
        payment = _pending_payment()

    sent = [call for call in silent_telegram.call_args_list if call.args[0] == "sendMessage"]
    assert sent, "the submission should have produced a Telegram notification"
    markup = sent[-1].args[1]["reply_markup"]["inline_keyboard"][0]

    assert [button["text"] for button in markup] == ["☑ Approve", "❌ Reject"]
    for button in markup:
        payload = button["callback_data"]
        assert len(payload.encode()) <= 64
        assert str(payment.id.hex) in payload
        # Nothing sensitive travels in callback_data.
        assert "1122334455667" not in payload
        assert "tg-payer" not in payload


def test_a_decided_notification_carries_no_buttons(
    silent_telegram: Any, django_capture_on_commit_callbacks: Any
) -> None:
    payment = _pending_payment()
    operator = _operator()
    silent_telegram.reset_mock()

    from apps.payments.manual_services import review_manual_recharge

    with django_capture_on_commit_callbacks(execute=True):
        review_manual_recharge(
            payment_id=payment.id,
            actor=operator.user,
            decision="approve",
            reason="Approved from the operations console for this test.",
            idempotency_key="console-approval-0001",
        )

    sent = [call for call in silent_telegram.call_args_list if call.args[0] == "sendMessage"]
    assert sent, "console approval still announces itself in Telegram"
    assert "reply_markup" not in sent[-1].args[1]


# --------------------------------------------------------------------------
# The happy paths
# --------------------------------------------------------------------------


def test_an_authorized_approve_activates_through_the_canonical_service(
    silent_telegram: Any,
) -> None:
    payment = _pending_payment()
    operator = _operator()
    silent_telegram.reset_mock()

    response = _post(_update(payment=payment, action="approve"))

    assert response.status_code == 200
    assert response.json() == {"status": "handled", "changed": True}
    payment.refresh_from_db()
    submission = ManualRechargeSubmission.objects.get(payment=payment)
    assert payment.status == Payment.Status.SUCCEEDED
    assert submission.status == ManualRechargeSubmission.Status.APPROVED
    # The real administrator is the audited actor -- no invented system user.
    assert submission.reviewed_by_id == operator.user.id
    subscription = Subscription.objects.get(id=payment.subscription_id)
    assert subscription.payment_verification == Subscription.PaymentVerification.VERIFIED
    assert AuditRecord.objects.filter(
        action="payment_approved", actor=operator.user, target_id=str(submission.id)
    ).exists()

    methods = [call.args[0] for call in silent_telegram.call_args_list]
    assert "answerCallbackQuery" in methods
    assert "editMessageText" in methods
    # The edited message replaces the announcement rather than duplicating it.
    assert "sendMessage" not in methods
    edit = next(
        call for call in silent_telegram.call_args_list if call.args[0] == "editMessageText"
    )
    assert "✅ Approved" in edit.args[1]["text"]
    assert edit.args[1]["reply_markup"] == {"inline_keyboard": []}


def test_an_authorized_reject_rolls_the_subscription_back(silent_telegram: Any) -> None:
    payment = _pending_payment(email="tg-reject@example.com", code="2233445566778")
    operator = _operator()
    silent_telegram.reset_mock()

    response = _post(_update(payment=payment, action="reject"))

    assert response.status_code == 200
    payment.refresh_from_db()
    submission = ManualRechargeSubmission.objects.get(payment=payment)
    assert payment.status == Payment.Status.FAILED
    assert submission.status == ManualRechargeSubmission.Status.REJECTED
    assert submission.reviewed_by_id == operator.user.id
    edit = next(
        call for call in silent_telegram.call_args_list if call.args[0] == "editMessageText"
    )
    assert "❌ Rejected" in edit.args[1]["text"]


def test_early_renewal_approval_keeps_the_extended_period(silent_telegram: Any) -> None:
    """The Telegram path must not bypass early-renewal accounting."""

    user, subscription = _paid_subscription(remaining_days=5, email="tg-renewal@example.com")
    client = APIClient()
    client.force_authenticate(user)
    submitted = client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(_monthly_plan().id), "recharge_codes": ["3344556677889"]},
        format="json",
        HTTP_IDEMPOTENCY_KEY="tg-renewal-submit-0001",
    )
    assert submitted.status_code == 201
    payment = Payment.objects.get(id=submitted.json()["payment"]["id"])
    submission = ManualRechargeSubmission.objects.get(payment=payment)
    assert submission.is_early_renewal is True
    extension_ends_at = submission.extension_ends_at
    _operator()

    assert _post(_update(payment=payment, action="approve")).status_code == 200

    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.current_period_ends_at == extension_ends_at
    assert subscription.payment_verification == Subscription.PaymentVerification.VERIFIED


# --------------------------------------------------------------------------
# What it refuses
# --------------------------------------------------------------------------


def test_a_missing_or_wrong_secret_is_not_acknowledged() -> None:
    payment = _pending_payment(email="tg-secret@example.com", code="4455667788990")
    _operator()

    assert _post(_update(payment=payment), secret=None).status_code == 404
    assert _post(_update(payment=payment), secret="wrong-secret-value").status_code == 404
    assert Payment.objects.get(id=payment.id).status == Payment.Status.PENDING


def test_the_webhook_is_closed_when_no_secret_is_configured(settings: Any) -> None:
    payment = _pending_payment(email="tg-nosecret@example.com", code="5566778899001")
    _operator()
    settings.TELEGRAM_WEBHOOK_SECRET_TOKEN = ""

    assert _post(_update(payment=payment), secret="anything").status_code == 404
    assert Payment.objects.get(id=payment.id).status == Payment.Status.PENDING


def test_an_unauthorized_chat_cannot_act() -> None:
    payment = _pending_payment(email="tg-chat@example.com", code="6677889900112")
    _operator()

    response = _post(_update(payment=payment, chat_id="-1009999999999"))

    assert response.status_code == 403
    assert Payment.objects.get(id=payment.id).status == Payment.Status.PENDING


def test_an_unlinked_telegram_account_cannot_act() -> None:
    payment = _pending_payment(email="tg-unlinked@example.com", code="7788990011223")
    _operator()

    response = _post(_update(payment=payment, from_id="999000111"))

    assert response.status_code == 403
    assert Payment.objects.get(id=payment.id).status == Payment.Status.PENDING


def test_a_deactivated_link_cannot_act() -> None:
    payment = _pending_payment(email="tg-inactive@example.com", code="8899001122334")
    operator = _operator()
    TelegramPaymentOperator.objects.filter(id=operator.id).update(is_active=False)

    assert _post(_update(payment=payment)).status_code == 403
    assert Payment.objects.get(id=payment.id).status == Payment.Status.PENDING


def test_a_linked_account_without_the_capability_cannot_act() -> None:
    """Capability is read live, so revoking payments.manage revokes the button."""

    payment = _pending_payment(email="tg-nocap@example.com", code="9900112233445")
    _operator(capability=False)

    assert _post(_update(payment=payment)).status_code == 403
    assert Payment.objects.get(id=payment.id).status == Payment.Status.PENDING


@pytest.mark.parametrize(
    "data",
    [
        "",
        "garbage",
        "p1:a:not-a-uuid:0123456789",
        "p9:a:0123456789abcdef0123456789abcdef:0123456789",
        "p1:z:0123456789abcdef0123456789abcdef:0123456789",
        "p1:a:0123456789abcdef0123456789abcdef:deadbeef01",
        "p1:a:0123456789abcdef0123456789abcdef",
    ],
)
def test_malformed_or_unsigned_callback_data_is_refused(data: str) -> None:
    _operator()

    assert _post(_update(data=data)).status_code == 403


def test_callback_data_signed_for_a_different_action_is_refused() -> None:
    """The signature covers the action, so approve cannot be replayed as reject."""

    payment = _pending_payment(email="tg-swap@example.com", code="1010101010101")
    _operator()
    approve = build_callback_data(action="approve", payment_id=payment.id)
    tampered = approve.replace("p1:a:", "p1:r:", 1)

    assert _post(_update(data=tampered)).status_code == 403
    assert Payment.objects.get(id=payment.id).status == Payment.Status.PENDING


def test_an_unknown_payment_is_answered_without_confirming_it_exists(
    silent_telegram: Any,
) -> None:
    from uuid import uuid4

    _operator()
    unknown = build_callback_data(action="approve", payment_id=uuid4())
    silent_telegram.reset_mock()

    response = _post(_update(data=unknown))

    assert response.status_code == 200
    assert response.json() == {"status": "handled", "changed": False}
    answer = next(
        call for call in silent_telegram.call_args_list if call.args[0] == "answerCallbackQuery"
    )
    assert answer.args[1]["text"] == "This request is no longer available."


def test_a_body_that_is_not_json_is_refused() -> None:
    client = APIClient()
    response = client.post(
        WEBHOOK,
        data=b"not json at all",
        content_type="application/json",
        HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=SECRET,
    )
    assert response.status_code == 400


def test_a_non_callback_update_is_ignored_without_retry() -> None:
    response = _post({"update_id": 1, "message": {"text": "hello"}})

    assert response.status_code == 200
    assert response.json() == {"status": "ignored"}


# --------------------------------------------------------------------------
# Idempotency and concurrency
# --------------------------------------------------------------------------


def test_a_redelivered_callback_transitions_the_payment_only_once(
    silent_telegram: Any,
) -> None:
    payment = _pending_payment(email="tg-redeliver@example.com", code="1212121212121")
    _operator()

    first = _post(_update(payment=payment, action="approve"))
    second = _post(_update(payment=payment, action="approve"))
    third = _post(_update(payment=payment, action="approve"))

    assert first.json() == {"status": "handled", "changed": True}
    assert second.json() == {"status": "handled", "changed": False}
    assert third.json() == {"status": "handled", "changed": False}
    # One approval transition, no matter how many deliveries.
    assert (
        PaymentTransition.objects.filter(
            payment=payment, to_status=Payment.Status.SUCCEEDED
        ).count()
        == 1
    )
    assert Payment.objects.get(id=payment.id).status == Payment.Status.SUCCEEDED


def test_two_operators_pressing_approve_produce_one_transition() -> None:
    payment = _pending_payment(email="tg-two-admins@example.com", code="1313131313131")
    first_operator = _operator()
    second_user = create_user(email="tg-operator-2@example.com", username="tg_operator_2")
    second_user.groups.add(Group.objects.get(name=Role.ADMINISTRATOR.value))
    TelegramPaymentOperator.objects.create(
        user=second_user, telegram_user_id="112233445", label="Day shift"
    )

    first = _post(_update(payment=payment, action="approve"))
    second = _post(_update(payment=payment, action="approve", from_id="112233445"))

    assert first.json()["changed"] is True
    assert second.json()["changed"] is False
    assert (
        PaymentTransition.objects.filter(
            payment=payment, to_status=Payment.Status.SUCCEEDED
        ).count()
        == 1
    )
    submission = ManualRechargeSubmission.objects.get(payment=payment)
    assert submission.reviewed_by_id == first_operator.user.id


def test_rejecting_an_already_approved_payment_is_refused_harmlessly(
    silent_telegram: Any,
) -> None:
    payment = _pending_payment(email="tg-approved-first@example.com", code="1414141414141")
    _operator()
    assert _post(_update(payment=payment, action="approve")).json()["changed"] is True
    silent_telegram.reset_mock()

    response = _post(_update(payment=payment, action="reject"))

    assert response.status_code == 200
    assert response.json() == {"status": "handled", "changed": False}
    assert Payment.objects.get(id=payment.id).status == Payment.Status.SUCCEEDED
    answer = next(
        call for call in silent_telegram.call_args_list if call.args[0] == "answerCallbackQuery"
    )
    assert "already been reviewed" in answer.args[1]["text"]


def test_approving_an_already_rejected_payment_is_refused_harmlessly() -> None:
    payment = _pending_payment(email="tg-rejected-first@example.com", code="1515151515151")
    _operator()
    assert _post(_update(payment=payment, action="reject")).json()["changed"] is True

    response = _post(_update(payment=payment, action="approve"))

    assert response.status_code == 200
    assert response.json() == {"status": "handled", "changed": False}
    assert Payment.objects.get(id=payment.id).status == Payment.Status.FAILED


# --------------------------------------------------------------------------
# Telegram is not allowed to corrupt payment state
# --------------------------------------------------------------------------


def test_a_telegram_transport_failure_leaves_the_approval_committed() -> None:
    """The database is authoritative; the chat is a replaceable channel."""

    payment = _pending_payment(email="tg-transport@example.com", code="1616161616161")
    _operator()

    with patch("apps.payments.telegram._call", return_value=False):
        response = _post(_update(payment=payment, action="approve"))

    assert response.status_code == 200
    assert Payment.objects.get(id=payment.id).status == Payment.Status.SUCCEEDED


def test_a_raising_telegram_client_does_not_roll_back_or_ask_for_a_retry() -> None:
    payment = _pending_payment(email="tg-raise@example.com", code="1717171717171")
    _operator()

    with patch(
        "apps.payments.telegram_actions.answer_callback_query",
        side_effect=RuntimeError("telegram exploded"),
    ):
        response = _post(_update(payment=payment, action="approve"))

    # 200 so Telegram stops redelivering an action that already committed.
    assert response.status_code == 200
    assert response.json()["status"] == "error"
    assert Payment.objects.get(id=payment.id).status == Payment.Status.SUCCEEDED


def test_the_keyboard_never_carries_a_recharge_code() -> None:
    payment = _pending_payment(email="tg-nocode@example.com", code="1818181818181")

    serialized = json.dumps(payment_action_keyboard(payment.id))

    assert "1818181818181" not in serialized
    assert "tg-nocode" not in serialized
