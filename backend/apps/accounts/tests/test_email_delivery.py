from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.accounts.email_delivery import dispatch_due_account_emails, enqueue_account_email
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
