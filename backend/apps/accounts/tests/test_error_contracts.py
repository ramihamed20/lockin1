"""Each account failure has its own machine-readable code -- but never one that
tells a stranger whether an address has an account.

The rule these tests pin down: a reason is named only to someone who has
proved they hold the secret (the code that was mailed, or the reset link).
A wrong guess gets one answer, whatever the address.
"""

import smtplib
from datetime import timedelta
from typing import Any
from unittest.mock import patch

import pytest
from django.core import mail
from django.db import transaction
from django.utils import timezone

from apps.accounts.email_delivery import (
    BACKLOG_SECONDS,
    account_email_delivery_state,
    dispatch_due_account_emails,
)
from apps.accounts.models import AccountDeletionRequest, AccountEmailDelivery, OneTimeToken, User
from apps.accounts.services import VERIFICATION_CODE_ATTEMPT_LIMIT

from .helpers import (
    PASSWORD,
    code_from_latest_email,
    create_user,
    csrf_client,
    token_from_latest_email,
)

pytestmark = pytest.mark.django_db

REGISTRATION = {
    "full_name": "New Student",
    "email": "new@example.com",
    "password": PASSWORD,
    "password_confirm": PASSWORD,
    "preferred_language": "en",
    "cohort_id": "a19b3034-e038-46b8-8806-7b113329f061",
    "accept_policies": True,
}


def _post(client: Any, csrf: str, path: str, body: dict[str, object]) -> Any:
    return client.post(f"/api/v1{path}", body, format="json", HTTP_X_CSRFTOKEN=csrf)


def _registered() -> tuple[Any, str, str]:
    client, csrf = csrf_client()
    _post(client, csrf, "/auth/register", REGISTRATION)
    return client, csrf, code_from_latest_email()


def _error(response: Any) -> tuple[int, str, str]:
    error = response.json()["error"]
    return response.status_code, error["code"], error["message"]


def test_a_wrong_code_reads_the_same_for_an_account_and_for_no_account() -> None:
    client, csrf, code = _registered()
    wrong = "000000" if code != "000000" else "111111"
    existing = _post(
        client, csrf, "/auth/verify-email", {"email": "new@example.com", "code": wrong}
    )
    missing = _post(
        client, csrf, "/auth/verify-email", {"email": "nobody@example.com", "code": wrong}
    )
    verified = create_user(email="done@example.com")
    already = _post(client, csrf, "/auth/verify-email", {"email": verified.email, "code": wrong})

    assert _error(existing) == _error(missing) == _error(already)
    assert _error(existing)[:2] == (400, "invalid_verification_code")


def test_a_code_replaced_by_a_resend_says_so_to_its_holder() -> None:
    client, csrf, first_code = _registered()
    OneTimeToken.objects.update(created_at=timezone.now() - timedelta(minutes=2))
    _post(client, csrf, "/auth/resend-verification", {"email": "new@example.com"})

    response = _post(
        client, csrf, "/auth/verify-email", {"email": "new@example.com", "code": first_code}
    )

    assert _error(response)[:2] == (400, "verification_code_replaced")
    assert not User.objects.get(email="new@example.com").is_email_verified


def test_a_code_burned_by_wrong_guesses_says_so_only_with_the_right_code() -> None:
    client, csrf, code = _registered()
    wrong = "000000" if code != "000000" else "111111"
    with patch("apps.accounts.views._enforce_sensitive_request_limit"):
        for _ in range(VERIFICATION_CODE_ATTEMPT_LIMIT):
            last_wrong = _post(
                client, csrf, "/auth/verify-email", {"email": "new@example.com", "code": wrong}
            )
        right = _post(
            client, csrf, "/auth/verify-email", {"email": "new@example.com", "code": code}
        )

    # The guess that burned the code reads like any other wrong guess.
    assert _error(last_wrong)[:2] == (400, "invalid_verification_code")
    assert _error(right)[:2] == (400, "verification_attempts_exceeded")


def test_reset_links_name_their_state_to_whoever_holds_them() -> None:
    create_user()
    client, csrf = csrf_client()
    _post(client, csrf, "/auth/password-reset", {"email": "student@example.com"})
    token = token_from_latest_email()
    new_password = "Another-lockin-pass-2026"
    body = {"token": token, "new_password": new_password, "new_password_confirm": new_password}

    unknown = _post(client, csrf, "/auth/password-reset/confirm", {**body, "token": "x" * 43})
    assert _error(unknown)[:2] == (400, "invalid_reset_token")

    OneTimeToken.objects.filter(kind=OneTimeToken.Kind.PASSWORD_RESET).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    expired = _post(client, csrf, "/auth/password-reset/confirm", body)
    assert _error(expired)[:2] == (400, "reset_link_expired")

    OneTimeToken.objects.filter(kind=OneTimeToken.Kind.PASSWORD_RESET).update(
        expires_at=timezone.now() + timedelta(hours=1)
    )
    assert _post(client, csrf, "/auth/password-reset/confirm", body).status_code == 200
    used = _post(client, csrf, "/auth/password-reset/confirm", body)
    assert _error(used)[:2] == (400, "reset_link_used")


def test_a_new_password_must_differ_from_the_current_one() -> None:
    user = create_user()
    client, csrf = csrf_client()
    client.force_login(user)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]

    same = _post(
        client,
        csrf,
        "/account/password",
        {"current_password": PASSWORD, "new_password": PASSWORD, "new_password_confirm": PASSWORD},
    )
    wrong = _post(
        client,
        csrf,
        "/account/password",
        {
            "current_password": "not-the-password",
            "new_password": "Brand-new-pass-2026",
            "new_password_confirm": "Brand-new-pass-2026",
        },
    )

    assert same.status_code == 400
    assert same.json()["error"]["fields"]["new_password"] == [
        "Choose a new password that is different from your current one."
    ]
    assert wrong.json()["error"]["fields"]["current_password"] == [
        "The current password is incorrect."
    ]


def test_an_email_that_cannot_be_sent_is_reported_and_leaves_nothing_half_done() -> None:
    user = create_user()
    client, _ = csrf_client()
    client.force_login(user)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    refused = smtplib.SMTPServerDisconnected("Connection unexpectedly closed")

    with patch("apps.accounts.services.send_mail", side_effect=refused):
        change = _post(
            client,
            csrf,
            "/account/email",
            {"new_email": "other@example.com", "current_password": PASSWORD},
        )
        deletion = _post(client, csrf, "/account/deletion", {"current_password": PASSWORD})

    assert _error(change)[:2] == (503, "email_delivery_unavailable")
    assert _error(deletion)[:2] == (503, "email_delivery_unavailable")
    # No link the reader never received is left usable, and no deletion request
    # is left waiting for a confirmation that never arrived.
    for kind in (OneTimeToken.Kind.EMAIL_CHANGE, OneTimeToken.Kind.ACCOUNT_DELETION):
        assert not OneTimeToken.objects.filter(kind=kind, used_at__isnull=True).exists()
    assert not AccountDeletionRequest.objects.exclude(
        status=AccountDeletionRequest.Status.CANCELLED
    ).exists()
    assert "Connection unexpectedly closed" not in change.content.decode()


def test_signing_up_again_tells_the_mailbox_not_the_screen() -> None:
    verified = create_user(email="taken@example.com")
    client, csrf = csrf_client()
    response = _post(client, csrf, "/auth/register", {**REGISTRATION, "email": verified.email})
    fresh = _post(client, csrf, "/auth/register", {**REGISTRATION, "email": "fresh@example.com"})

    assert response.status_code == fresh.status_code == 201
    assert response.json() == fresh.json()
    dispatch_due_account_emails()
    subjects = {message.to[0]: message.subject for message in mail.outbox}
    # The owner hears the truth, with a way back in rather than a code.
    assert subjects["taken@example.com"] == "You already have a Lock-in account"
    assert "/reset-password" in next(m.body for m in mail.outbox if m.to == ["taken@example.com"])
    assert subjects["fresh@example.com"] == "Your Lock-in verification code"


def test_delivery_state_reports_the_queue_not_the_address() -> None:
    assert account_email_delivery_state() == "queued"
    _registered()
    assert account_email_delivery_state() == "queued"

    # A message left waiting past the backlog window means mail is not flowing.
    create_user(email="late@example.com", verified=False)
    client, csrf = csrf_client()
    _post(client, csrf, "/auth/register", {**REGISTRATION, "email": "late2@example.com"})
    AccountEmailDelivery.objects.filter(status=AccountEmailDelivery.Status.PENDING).update(
        created_at=timezone.now() - timedelta(seconds=BACKLOG_SECONDS + 1)
    )
    assert account_email_delivery_state() == "delayed"
    missing = _post(client, csrf, "/auth/password-reset", {"email": "nobody@example.com"})
    assert missing.json()["email_delivery"] == "delayed"

    # A recent permanent failure with nothing sent since also reads as delayed,
    # and clears as soon as a message goes out.
    with patch("apps.accounts.email_delivery.send_mail", side_effect=TimeoutError()):
        AccountEmailDelivery.objects.update(attempts=4)
        dispatch_due_account_emails()
    assert AccountEmailDelivery.objects.filter(status=AccountEmailDelivery.Status.FAILED).exists()
    assert account_email_delivery_state() == "delayed"
    _post(client, csrf, "/auth/register", {**REGISTRATION, "email": "later@example.com"})
    dispatch_due_account_emails()
    assert account_email_delivery_state() == "queued"


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_smtp_never_runs_inside_a_database_transaction() -> None:
    """A slow mail server must not hold the account's row lock, or outlive the
    idle-transaction limit and roll back a link that was already mailed."""

    user = create_user()
    client, _ = csrf_client()
    client.force_login(user)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    seen: list[bool] = []

    def send(*args: object, **kwargs: object) -> int:
        seen.append(transaction.get_connection().in_atomic_block)
        return 1

    with patch("apps.accounts.services.send_mail", side_effect=send):
        change = _post(
            client,
            csrf,
            "/account/email",
            {"new_email": "other@example.com", "current_password": PASSWORD},
        )
        deletion = _post(client, csrf, "/account/deletion", {"current_password": PASSWORD})

    assert change.status_code == 200
    assert deletion.status_code == 201
    assert seen == [False, False]


def test_signing_up_again_never_cancels_a_reset_link_the_owner_is_using() -> None:
    owner = create_user(email="owner@example.com")
    client, csrf = csrf_client()
    _post(client, csrf, "/auth/password-reset", {"email": owner.email})
    live = token_from_latest_email()
    sent_before = len(mail.outbox)

    # Someone keeps trying to sign up with the owner's address.
    for _ in range(3):
        response = _post(client, csrf, "/auth/register", {**REGISTRATION, "email": owner.email})
        assert response.status_code == 201
    dispatch_due_account_emails()

    # The owner's link still works, and no extra mail reached them.
    assert len(mail.outbox) == sent_before
    new_password = "Owner-chosen-pass-2026"
    confirmed = _post(
        client,
        csrf,
        "/auth/password-reset/confirm",
        {"token": live, "new_password": new_password, "new_password_confirm": new_password},
    )
    assert confirmed.status_code == 200


def test_repeated_sign_ups_for_a_verified_address_send_one_notice_per_window() -> None:
    owner = create_user(email="owner@example.com")
    client, csrf = csrf_client()
    for _ in range(3):
        _post(client, csrf, "/auth/register", {**REGISTRATION, "email": owner.email})
    dispatch_due_account_emails()
    notices = [m for m in mail.outbox if m.subject == "You already have a Lock-in account"]
    assert len(notices) == 1
    assert (
        OneTimeToken.objects.filter(user=owner, kind=OneTimeToken.Kind.PASSWORD_RESET).count() == 1
    )


def test_one_refused_address_does_not_mark_everyone_else_delayed() -> None:
    _registered()
    refused = smtplib.SMTPRecipientsRefused({"new@example.com": (550, b"5.1.1 No such user")})
    with patch("apps.accounts.email_delivery.send_mail", side_effect=refused):
        AccountEmailDelivery.objects.update(
            status=AccountEmailDelivery.Status.PENDING,
            next_attempt_at=timezone.now() - timedelta(seconds=1),
        )
        dispatch_due_account_emails()
    assert AccountEmailDelivery.objects.filter(
        status=AccountEmailDelivery.Status.FAILED, last_error__startswith="SMTPRecipientsRefused"
    ).exists()
    assert account_email_delivery_state() == "queued"
