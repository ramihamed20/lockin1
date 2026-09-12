"""A Telegram button is only usable if an operator link can be created.

``test_telegram_actions`` verifies the read path thoroughly, but every one of its
tests creates the ``TelegramPaymentOperator`` row itself. The shipped product had
no way to create one at all -- no admin registration, no command, no API -- so
the whole feature refused every press in production while the suite stayed
green. These tests hold the provisioning path, not just the check it feeds.
"""

import base64
import json
from io import StringIO
from typing import Any
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from django.core.management import CommandError, call_command
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.payments.models import ManualRechargeSubmission, Payment, TelegramPaymentOperator
from apps.payments.telegram import build_callback_data
from apps.payments.telegram_actions import TELEGRAM_REVIEW_SOURCE
from apps.product_catalog.models import Plan, Price
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db

WEBHOOK = "/api/v1/billing/webhooks/telegram"
SECRET = "telegram-webhook-secret-token-for-tests-0002"  # noqa: S105 - test fixture value.
CHAT_ID = "-1009876543210"
TELEGRAM_ID = "778899001"


@pytest.fixture(autouse=True)
def telegram_settings(settings: Any) -> None:
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = "1234567:test-bot-token"  # noqa: S105 - fixture value.
    settings.TELEGRAM_PAYMENT_CHAT_ID = CHAT_ID
    settings.TELEGRAM_ADMIN_CHAT_ID = ""
    settings.TELEGRAM_WEBHOOK_SECRET_TOKEN = SECRET


@pytest.fixture(autouse=True)
def silent_telegram():
    with patch("apps.payments.telegram._call", return_value=True) as call:
        yield call


def _admin(*, email: str = "tg-cmd-admin@example.com") -> Any:
    user = create_user(email=email, username=email.split("@")[0].replace("-", "_")[:30])
    user.groups.add(Group.objects.get(name=Role.ADMINISTRATOR.value))
    return user


def _run(*args: str) -> str:
    out = StringIO()
    call_command("telegram_operator", *args, stdout=out, stderr=out)
    return out.getvalue()


def _pending_payment(*, email: str, code: str) -> Payment:
    user = create_user(email=email, username=email.split("@")[0].replace("-", "_")[:30])
    create_trial_for_user(user=user, source_reference="test")
    plan = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    assert Price.objects.filter(
        plan_version_id=plan.current_version_id, currency="LYD", status=Price.Status.ACTIVE
    ).exists()
    client = APIClient()
    client.force_authenticate(user)
    response = client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(plan.id), "recharge_codes": [code]},
        format="json",
        HTTP_IDEMPOTENCY_KEY=f"tg-cmd-submit-{code}",
    )
    assert response.status_code == 201
    return Payment.objects.get(id=response.json()["payment"]["id"])


def _press(payment: Payment, *, action: str = "approve") -> Any:
    update = {
        "update_id": 7,
        "callback_query": {
            "id": "callback-cmd-1",
            "from": {"id": TELEGRAM_ID},
            "data": build_callback_data(action=action, payment_id=payment.id),
            "message": {
                "message_id": 901,
                "text": "🔔 طلب اشتراك جديد",
                "chat": {"id": CHAT_ID},
            },
        },
    }
    return APIClient().post(
        WEBHOOK,
        data=json.dumps(update),
        content_type="application/json",
        HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=SECRET,
    )


def test_the_command_links_an_operator_that_the_webhook_then_accepts() -> None:
    """The system-level gap: provisioning and the check that reads it, together."""

    admin = _admin()
    payment = _pending_payment(email="tg-cmd-payer@example.com", code="3344556677889")

    _run("--link", TELEGRAM_ID, "--user", admin.email, "--label", "Night shift")

    response = _press(payment)

    assert response.status_code == 200
    assert response.json() == {"status": "handled", "changed": True}
    payment.refresh_from_db()
    assert payment.status == Payment.Status.SUCCEEDED
    submission = ManualRechargeSubmission.objects.get(payment=payment)
    assert submission.status == ManualRechargeSubmission.Status.APPROVED
    assert submission.reviewed_by_id == admin.id


def test_a_review_from_telegram_is_distinguishable_on_the_audit_trail() -> None:
    admin = _admin(email="tg-cmd-source@example.com")
    payment = _pending_payment(email="tg-cmd-source-payer@example.com", code="4455667788990")
    _run("--link", TELEGRAM_ID, "--user", admin.email)

    _press(payment)

    submission = ManualRechargeSubmission.objects.get(payment=payment)
    record = AuditRecord.objects.get(action="payment_approved", target_id=str(submission.id))
    # Both channels run the same service; the channel is the only thing that
    # differs, and the audit trail could not previously show it.
    assert record.source == TELEGRAM_REVIEW_SOURCE


def test_a_console_review_still_records_the_console_as_its_source() -> None:
    admin = _admin(email="tg-cmd-console@example.com")
    payment = _pending_payment(email="tg-cmd-console-payer@example.com", code="5566778899001")
    client = APIClient()
    client.force_authenticate(admin)

    response = client.post(
        f"/api/v1/operations/admin/purchases/{payment.id}/manual-review",
        {"decision": "approve", "reason": "Card verified."},
        format="json",
        HTTP_IDEMPOTENCY_KEY="tg-cmd-console-review-key",
    )

    assert response.status_code == 200
    submission = ManualRechargeSubmission.objects.get(payment=payment)
    record = AuditRecord.objects.get(action="payment_approved", target_id=str(submission.id))
    assert record.source == "admin_control.api"


def test_linking_an_account_without_payments_manage_is_refused_at_creation() -> None:
    """A link that can never work is refused now rather than at the button."""

    student = create_user(email="tg-cmd-student@example.com", username="tg_cmd_student")

    with pytest.raises(CommandError, match="payments.manage"):
        _run("--link", TELEGRAM_ID, "--user", student.email)

    assert not TelegramPaymentOperator.objects.exists()


def test_linking_refuses_a_username_where_a_numeric_id_is_required() -> None:
    admin = _admin(email="tg-cmd-username@example.com")

    with pytest.raises(CommandError, match="numeric"):
        _run("--link", "@someone", "--user", admin.email)


def test_a_revoked_link_stops_acting_but_keeps_its_history() -> None:
    admin = _admin(email="tg-cmd-revoke@example.com")
    payment = _pending_payment(email="tg-cmd-revoke-payer@example.com", code="6677889900112")
    _run("--link", TELEGRAM_ID, "--user", admin.email)

    _run("--revoke", TELEGRAM_ID)
    response = _press(payment)

    assert response.status_code == 200
    assert response.json() == {"status": "ignored"}
    payment.refresh_from_db()
    assert payment.status != Payment.Status.SUCCEEDED
    # The row is the actor on past reviews, so revoking must not delete it.
    assert TelegramPaymentOperator.objects.get(telegram_user_id=TELEGRAM_ID).is_active is False


def test_listing_says_plainly_when_no_operator_is_linked() -> None:
    assert "No Telegram operators are linked" in _run("--list")


def test_listing_flags_a_link_whose_account_lost_the_capability() -> None:
    admin = _admin(email="tg-cmd-lost@example.com")
    _run("--link", TELEGRAM_ID, "--user", admin.email)
    admin.groups.clear()

    assert "lacks payments.manage" in _run("--list")
