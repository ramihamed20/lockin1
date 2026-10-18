import logging
import smtplib
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.email_delivery import (
    MAX_ATTEMPTS,
    dispatch_due_account_emails,
    enqueue_account_email,
)
from apps.accounts.models import AccountEmailDelivery, OneTimeToken
from apps.accounts.services import _token_digest, issue_token
from apps.accounts.tests.helpers import create_user

pytestmark = pytest.mark.django_db


def _delivery() -> AccountEmailDelivery:
    user = create_user(email="delivery-lease@example.com")
    issued = issue_token(
        user=user, kind=OneTimeToken.Kind.PASSWORD_RESET, lifetime=timedelta(hours=1)
    )
    return enqueue_account_email(
        user=user,
        token=OneTimeToken.objects.get(token_digest=_token_digest(issued.raw_token)),
        subject="Synthetic delivery",
        body="Synthetic test message",
    )


def test_a_second_dispatcher_cannot_send_an_active_claim() -> None:
    delivery = _delivery()
    overlapping_results = []

    def send(*args, **kwargs):
        if not overlapping_results:
            # Simulate another worker while the first SMTP operation is still
            # active. Its claim transaction has already committed.
            overlapping_results.append(-1)
            overlapping_results[0] = dispatch_due_account_emails()
        return 1

    with patch("apps.accounts.email_delivery.send_mail", side_effect=send) as smtp:
        assert dispatch_due_account_emails() == 1
    assert overlapping_results == [0]
    assert smtp.call_count == 1
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.SENT
    assert delivery.attempts == 1


def test_expired_claim_is_recovered_after_worker_interruption() -> None:
    delivery = _delivery()
    delivery.status = AccountEmailDelivery.Status.SENDING
    delivery.attempts = 1
    delivery.next_attempt_at = timezone.now() - timedelta(seconds=1)
    delivery.save()
    with patch("apps.accounts.email_delivery.send_mail", return_value=1):
        assert dispatch_due_account_emails() == 1
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.SENT
    assert delivery.attempts == 2


def test_stale_sender_cannot_complete_a_new_workers_claim() -> None:
    delivery = _delivery()

    def supersede(*args, **kwargs):
        AccountEmailDelivery.objects.filter(id=delivery.id).update(
            attempts=2,
            status=AccountEmailDelivery.Status.SENDING,
            next_attempt_at=timezone.now() + timedelta(minutes=5),
        )
        return 1

    with patch("apps.accounts.email_delivery.send_mail", side_effect=supersede):
        assert dispatch_due_account_emails() == 0
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.SENDING
    assert delivery.sent_at is None


def test_smtp_failures_back_off_and_do_not_store_sensitive_error_text() -> None:
    delivery = _delivery()
    with patch("apps.accounts.email_delivery.send_mail", side_effect=OSError("private SMTP text")):
        assert dispatch_due_account_emails() == 0
        assert dispatch_due_account_emails() == 0
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.PENDING
    assert delivery.attempts == 1
    assert delivery.last_error == "OSError"
    assert delivery.next_attempt_at > timezone.now()


def _verification_delivery(email: str = "reader@gmail.com") -> tuple[AccountEmailDelivery, str]:
    user = create_user(email=email)
    issued = issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(minutes=10),
        value="482913",
        scope=str(user.id),
    )
    delivery = enqueue_account_email(
        user=user,
        token=OneTimeToken.objects.get(token_digest=_token_digest("482913", scope=str(user.id))),
        subject="Your Lock-in verification code",
        body="Your Lock-in verification code is 482913",
    )
    return delivery, issued.raw_token


def test_a_code_replaced_while_queued_is_never_sent() -> None:
    delivery, _ = _verification_delivery()
    # A resend revokes the old code before the worker reaches it.
    issue_token(
        user=delivery.token.user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(minutes=10),
    )
    with patch("apps.accounts.email_delivery.send_mail") as smtp:
        assert dispatch_due_account_emails() == 0
    smtp.assert_not_called()
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.FAILED
    assert delivery.last_error == "TokenNoLongerUsable"
    assert delivery.attempts == 0


def test_an_expired_code_is_not_sent_late() -> None:
    delivery, _ = _verification_delivery()
    OneTimeToken.objects.filter(id=delivery.token_id).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    with patch("apps.accounts.email_delivery.send_mail") as smtp:
        assert dispatch_due_account_emails() == 0
    smtp.assert_not_called()


def test_a_permanent_gmail_rejection_stops_with_its_protocol_code() -> None:
    delivery, code = _verification_delivery()
    refused = smtplib.SMTPRecipientsRefused(
        {
            "reader@gmail.com": (
                550,
                b"5.7.26 Unauthenticated email from lockin.ly is not accepted for reader@gmail.com",
            )
        }
    )
    with patch("apps.accounts.email_delivery.send_mail", side_effect=refused) as smtp:
        assert dispatch_due_account_emails() == 0
        assert dispatch_due_account_emails() == 0
    assert smtp.call_count == 1
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.FAILED
    assert delivery.last_error == "SMTPRecipientsRefused:550:5.7.26"
    assert "reader" not in delivery.last_error
    assert code not in delivery.last_error


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (
            smtplib.SMTPAuthenticationError(535, b"5.7.8 Authentication failed"),
            "SMTPAuthenticationError:535:5.7.8",
        ),
        (
            smtplib.SMTPResponseException(421, b"4.7.0 Try again later"),
            "SMTPResponseException:421:4.7.0",
        ),
        (
            smtplib.SMTPServerDisconnected("Connection unexpectedly closed"),
            "SMTPServerDisconnected",
        ),
        (TimeoutError("timed out"), "TimeoutError"),
    ],
)
def test_server_side_and_transient_failures_keep_retrying(error: Exception, expected: str) -> None:
    delivery, _ = _verification_delivery()
    with patch("apps.accounts.email_delivery.send_mail", side_effect=error):
        assert dispatch_due_account_emails() == 0
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.PENDING
    assert delivery.attempts == 1
    assert delivery.last_error == expected
    assert delivery.next_attempt_at > timezone.now()


def test_retries_end_after_the_attempt_limit() -> None:
    delivery, _ = _verification_delivery()
    with patch("apps.accounts.email_delivery.send_mail", side_effect=TimeoutError()) as smtp:
        for _ in range(MAX_ATTEMPTS):
            AccountEmailDelivery.objects.filter(id=delivery.id).update(
                next_attempt_at=timezone.now() - timedelta(seconds=1)
            )
            dispatch_due_account_emails()
        AccountEmailDelivery.objects.filter(id=delivery.id).update(
            next_attempt_at=timezone.now() - timedelta(seconds=1)
        )
        dispatch_due_account_emails()
    assert smtp.call_count == MAX_ATTEMPTS
    delivery.refresh_from_db()
    assert delivery.status == AccountEmailDelivery.Status.FAILED


def test_delivery_logs_carry_the_flow_and_domain_but_never_the_code_or_address(caplog) -> None:
    delivery, code = _verification_delivery(email="private.person@gmail.com")
    caplog.set_level(logging.INFO, logger="lockin.email")
    with patch("apps.accounts.email_delivery.send_mail", return_value=1):
        assert dispatch_due_account_emails() == 1
    records = [record for record in caplog.records if record.name == "lockin.email"]
    assert [record.event for record in records] == ["account_email.provider_accepted"]
    assert records[0].flow == OneTimeToken.Kind.EMAIL_VERIFICATION
    assert records[0].recipient_domain == "gmail.com"
    dumped = " ".join(f"{record.getMessage()} {record.__dict__}" for record in records)
    assert code not in dumped
    assert "private.person" not in dumped
    assert "verification code is" not in dumped


def test_status_report_names_a_missing_scheduler_without_exposing_addresses() -> None:
    delivery, code = _verification_delivery(email="hidden.reader@gmail.com")
    output = StringIO()
    call_command("account_email_status", stdout=output)
    text = output.getvalue()
    assert "has never run" in text
    assert "email_verification / pending" in text
    assert "hidden.reader" not in text
    assert code not in text

    with patch("apps.accounts.email_delivery.send_mail", side_effect=TimeoutError()):
        dispatch_due_account_emails()
    output = StringIO()
    call_command("account_email_status", stdout=output)
    assert "TimeoutError @ gmail.com" in output.getvalue()
    assert "hidden.reader" not in output.getvalue()


def test_the_scheduler_dispatches_email_before_any_other_job() -> None:
    from apps.operations_integrations.management.commands.run_operations_scheduler import JOBS

    assert JOBS[0].code == "account_email_delivery"
