from typing import Any

import pytest
from django.contrib import auth
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.models import (
    AccountDeletionRequest,
    AccountSession,
    AuthAttempt,
    OneTimeToken,
    User,
)
from apps.accounts.roles import Role
from apps.audit.models import AuditRecord
from apps.education.models import StudentCohort

from .helpers import PASSWORD, create_user, csrf_client, token_from_latest_email

pytestmark = pytest.mark.django_db


REGISTRATION = {
    "full_name": "  New Student  ",
    "email": "NEW@Example.com",
    "password": PASSWORD,
    "password_confirm": PASSWORD,
    "preferred_language": "ar",
    "cohort_id": "a19b3034-e038-46b8-8806-7b113329f061",
    "accept_policies": True,
}


def test_unsafe_anonymous_requests_require_csrf() -> None:
    client = APIClient(enforce_csrf_checks=True)

    response = client.post("/api/v1/auth/register", REGISTRATION, format="json")

    assert response.status_code == 403
    assert User.objects.count() == 0


def test_registration_is_strict_and_creates_unverified_account(settings: Any) -> None:
    client, csrf = csrf_client()
    payload = {**REGISTRATION, "roles": ["administrator"]}

    rejected = client.post("/api/v1/auth/register", payload, format="json", HTTP_X_CSRFTOKEN=csrf)
    accepted = client.post(
        "/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf
    )

    assert rejected.status_code == 400
    assert accepted.status_code == 201
    user = User.objects.get()
    assert user.email == "new@example.com"
    assert user.full_name == "New Student"
    assert user.preferred_language == "ar"
    assert user.cohort_id == StudentCohort.objects.get(code="61").id
    assert user.policy_version == settings.ACCOUNT_POLICY_VERSION
    assert user.policy_accepted_at is not None
    assert not user.is_email_verified
    assert not user.groups.exists()
    token = OneTimeToken.objects.get(kind=OneTimeToken.Kind.EMAIL_VERIFICATION)
    raw_token = token_from_latest_email()
    assert raw_token not in token.token_digest
    assert token.token_digest != raw_token


def test_duplicate_registration_does_not_reveal_account_existence() -> None:
    client, csrf = csrf_client()
    first = client.post("/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf)
    repeated = client.post(
        "/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf
    )

    assert first.status_code == repeated.status_code == 201
    assert first.json() == repeated.json() == {"status": "verification_required"}
    assert User.objects.count() == 1
    assert OneTimeToken.objects.filter(kind=OneTimeToken.Kind.EMAIL_VERIFICATION).count() == 1


def test_registration_source_bucket_blocks_multi_identity_flooding(settings: Any) -> None:
    settings.ACCOUNT_SENSITIVE_REQUEST_LIMIT = 20
    settings.ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT = 1
    client, csrf = csrf_client()

    first = client.post(
        "/api/v1/auth/register",
        REGISTRATION,
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
        REMOTE_ADDR="198.51.100.20",
    )
    limited = client.post(
        "/api/v1/auth/register",
        {**REGISTRATION, "email": "another@example.com"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
        REMOTE_ADDR="198.51.100.20",
    )

    assert first.status_code == 201
    assert limited.status_code == 429
    assert AuthAttempt.objects.filter(scope="registration_source").count() == 1


def test_email_verification_token_is_single_use() -> None:
    client, csrf = csrf_client()
    client.post("/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf)
    raw_token = token_from_latest_email()

    first = client.post(
        "/api/v1/auth/verify-email",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    second = client.post(
        "/api/v1/auth/verify-email",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert first.status_code == 200
    assert second.status_code == 400
    assert User.objects.get().is_email_verified


def test_resend_and_reset_requests_do_not_disclose_account_existence() -> None:
    create_user()
    client, csrf = csrf_client()

    missing = client.post(
        "/api/v1/auth/password-reset",
        {"email": "missing@example.com"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    existing = client.post(
        "/api/v1/auth/password-reset",
        {"email": "student@example.com"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert missing.status_code == existing.status_code == 200
    assert missing.json() == existing.json() == {"status": "accepted"}


def test_login_requires_verification_and_uses_generic_error() -> None:
    create_user(verified=False)
    client, csrf = csrf_client()

    response = client.post(
        "/api/v1/auth/login",
        {"email": "student@example.com", "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "invalid_credentials"


def test_login_creates_server_session_and_logout_removes_it() -> None:
    user = create_user()
    client, csrf = csrf_client()

    login_response = client.post(
        "/api/v1/auth/login",
        {"email": user.email, "password": PASSWORD, "remember_me": True},
        format="json",
        HTTP_USER_AGENT="Mozilla/5.0 Chrome/126",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert login_response.status_code == 200
    assert "sessionid" in client.cookies
    account_session = AccountSession.objects.get(user=user)
    assert account_session.device_label == "Chrome on Computer"
    assert account_session.session_key == client.session.session_key
    assert client.get("/api/v1/auth/session").status_code == 200
    csrf = client.cookies["csrftoken"].value

    logout_response = client.post("/api/v1/auth/logout", format="json", HTTP_X_CSRFTOKEN=csrf)
    assert logout_response.status_code == 204
    assert not AccountSession.objects.filter(user=user).exists()


def test_login_rate_limit_is_database_backed(settings: Any) -> None:
    settings.ACCOUNT_LOGIN_ATTEMPT_LIMIT = 2
    create_user()
    client, csrf = csrf_client()
    payload = {"email": "student@example.com", "password": "wrong-password"}

    first = client.post("/api/v1/auth/login", payload, format="json", HTTP_X_CSRFTOKEN=csrf)
    second = client.post("/api/v1/auth/login", payload, format="json", HTTP_X_CSRFTOKEN=csrf)
    limited = client.post("/api/v1/auth/login", payload, format="json", HTTP_X_CSRFTOKEN=csrf)

    assert first.status_code == second.status_code == 403
    assert limited.status_code == 429
    assert AuthAttempt.objects.filter(scope="login").count() == 2


def test_login_source_bucket_blocks_identity_spraying(settings: Any) -> None:
    settings.ACCOUNT_LOGIN_ATTEMPT_LIMIT = 20
    settings.ACCOUNT_LOGIN_SOURCE_ATTEMPT_LIMIT = 2
    client, csrf = csrf_client()

    first = client.post(
        "/api/v1/auth/login",
        {"email": "first@example.com", "password": "wrong-password"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
        REMOTE_ADDR="198.51.100.10",
    )
    second = client.post(
        "/api/v1/auth/login",
        {"email": "second@example.com", "password": "wrong-password"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
        REMOTE_ADDR="198.51.100.10",
    )
    limited = client.post(
        "/api/v1/auth/login",
        {"email": "third@example.com", "password": "wrong-password"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
        REMOTE_ADDR="198.51.100.10",
    )

    assert first.status_code == second.status_code == 403
    assert limited.status_code == 429
    assert AuthAttempt.objects.filter(scope="login_source").count() == 2


def test_sensitive_account_requests_are_rate_limited(settings: Any) -> None:
    settings.ACCOUNT_SENSITIVE_REQUEST_LIMIT = 2
    client, csrf = csrf_client()
    payload = {"email": "student@example.com"}

    for _ in range(2):
        response = client.post(
            "/api/v1/auth/password-reset",
            payload,
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        assert response.status_code == 200
    limited = client.post(
        "/api/v1/auth/password-reset",
        payload,
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert limited.status_code == 429
    assert AuthAttempt.objects.filter(scope="password_reset_request").count() == 2


def test_password_reset_invalidates_sessions_and_token() -> None:
    user = create_user()
    client, csrf = csrf_client()
    client.post(
        "/api/v1/auth/login",
        {"email": user.email, "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    csrf = client.cookies["csrftoken"].value
    client.post(
        "/api/v1/auth/password-reset",
        {"email": user.email},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    raw_token = token_from_latest_email()
    new_password = "A-new-safe-password-2026"

    response = client.post(
        "/api/v1/auth/password-reset/confirm",
        {
            "token": raw_token,
            "new_password": new_password,
            "new_password_confirm": new_password,
        },
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.check_password(new_password)
    assert not AccountSession.objects.filter(user=user).exists()
    assert client.get("/api/v1/auth/session").status_code == 403
    replay = client.post(
        "/api/v1/auth/password-reset/confirm",
        {
            "token": raw_token,
            "new_password": PASSWORD,
            "new_password_confirm": PASSWORD,
        },
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert replay.status_code == 400


def test_profile_allows_only_owned_editable_fields() -> None:
    user = create_user()
    client, csrf = csrf_client()
    client.force_login(user)

    rejected = client.patch(
        "/api/v1/account/profile",
        {"status": User.Status.SUSPENDED},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    accepted = client.patch(
        "/api/v1/account/profile",
        {"full_name": "  Updated Student ", "preferred_language": "ar"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert rejected.status_code == 400
    assert accepted.status_code == 200
    user.refresh_from_db()
    assert user.full_name == "Updated Student"
    assert user.status == User.Status.ACTIVE


def test_welcome_completion_is_server_stored_and_idempotent() -> None:
    user = create_user(username="welcome_student")
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]

    before = client.get("/api/v1/auth/session")
    first = client.post(
        "/api/v1/account/welcome/complete",
        {},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    second = client.post(
        "/api/v1/account/welcome/complete",
        {},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert before.json()["user"]["welcome_required"] is True
    assert first.status_code == second.status_code == 200
    assert first.json()["user"]["welcome_completed_at"] is not None
    assert (
        second.json()["user"]["welcome_completed_at"]
        == first.json()["user"]["welcome_completed_at"]
    )


def test_email_change_requires_password_and_verifies_new_address() -> None:
    user = create_user()
    client, csrf = csrf_client()
    client.force_login(user)

    wrong_password = client.post(
        "/api/v1/account/email",
        {"new_email": "new-email@example.com", "current_password": "wrong"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    accepted = client.post(
        "/api/v1/account/email",
        {"new_email": "NEW-EMAIL@Example.com", "current_password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert wrong_password.status_code == 400
    assert accepted.status_code == 200
    raw_token = token_from_latest_email()
    confirmed = client.post(
        "/api/v1/account/email/confirm",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert confirmed.status_code == 200
    user.refresh_from_db()
    assert user.email == "new-email@example.com"
    assert user.is_email_verified


def test_account_deletion_request_requires_password_email_confirmation_and_tracks_status(
    settings: Any,
) -> None:
    settings.ACCOUNT_DELETION_POLICY_VERSION = ""
    user = create_user()
    client, csrf = csrf_client()
    client.force_login(user)

    wrong = client.post(
        "/api/v1/account/deletion",
        {"current_password": "wrong"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    requested = client.post(
        "/api/v1/account/deletion",
        {"current_password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert wrong.status_code == 400
    assert requested.status_code == 201
    assert requested.json()["status"] == "pending_confirmation"
    deletion_request = AccountDeletionRequest.objects.get(user=user)
    assert deletion_request.confirmation_token.kind == OneTimeToken.Kind.ACCOUNT_DELETION
    assert AuditRecord.objects.filter(
        action="account.deletion.requested", target_id=str(deletion_request.id)
    ).exists()

    raw_token = token_from_latest_email()
    assert raw_token not in deletion_request.confirmation_token.token_digest
    confirmed = client.post(
        "/api/v1/account/deletion/confirm",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    replay = client.post(
        "/api/v1/account/deletion/confirm",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["request"]["policy_version"] == ""
    assert replay.status_code == 400
    deletion_request.refresh_from_db()
    assert deletion_request.confirmed_at is not None
    assert deletion_request.completed_at is None
    assert AuditRecord.objects.filter(
        action="account.deletion.confirmed", target_id=str(deletion_request.id)
    ).exists()

    cancelled = client.delete(
        "/api/v1/account/deletion",
        {"current_password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_password_change_preserves_current_session_and_invalidates_others() -> None:
    user = create_user()
    current, csrf = csrf_client()
    other, other_csrf = csrf_client()
    for client, token in ((current, csrf), (other, other_csrf)):
        response = client.post(
            "/api/v1/auth/login",
            {"email": user.email, "password": PASSWORD},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        assert response.status_code == 200
    csrf = current.cookies["csrftoken"].value
    assert AccountSession.objects.filter(user=user).count() == 2

    new_password = "Changed-password-2026-safe"
    response = current.post(
        "/api/v1/account/password",
        {
            "current_password": PASSWORD,
            "new_password": new_password,
            "new_password_confirm": new_password,
        },
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 200
    assert current.get("/api/v1/auth/session").status_code == 200
    assert other.get("/api/v1/auth/session").status_code == 403
    assert AccountSession.objects.filter(user=user).count() == 1


def test_dashboard_reports_only_real_account_and_role_data() -> None:
    admin = create_user(email="admin@example.com")
    Group.objects.get(name=Role.ADMINISTRATOR.value).user_set.add(admin)
    create_user(email="unverified@example.com", verified=False)
    suspended = create_user(email="suspended@example.com")
    suspended.status = User.Status.SUSPENDED
    suspended.save()
    client = APIClient()
    client.force_authenticate(admin)

    response = client.get("/api/v1/dashboard")

    assert response.status_code == 200
    payload = response.json()
    assert payload["roles"] == ["student", "administrator"]
    assert payload["workspaces"] == ["administrator"]
    assert payload["administration"] == {"total": 3, "verified": 2, "suspended": 1}
    assert "lessons" not in payload
    assert "progress" not in payload


def test_only_administrators_can_manage_roles_and_final_admin_is_protected() -> None:
    admin = create_user(email="admin@example.com")
    student = create_user()
    group = Group.objects.get(name=Role.ADMINISTRATOR.value)
    group.user_set.add(admin)
    client, csrf = csrf_client()
    client.force_login(student)
    denied = client.patch(
        f"/api/v1/admin/users/{student.id}/roles",
        {"roles": ["creator"]},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert denied.status_code == 403

    client.force_login(admin)
    assigned = client.patch(
        f"/api/v1/admin/users/{student.id}/roles",
        {"roles": ["creator"]},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    rejected = client.patch(
        f"/api/v1/admin/users/{admin.id}/roles",
        {"roles": []},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert assigned.status_code == 200
    assert assigned.json()["roles"] == ["student", "creator"]
    assert rejected.status_code == 400
    assert student.groups.filter(name=Role.CREATOR.value).exists()
    assert admin.groups.filter(name=Role.ADMINISTRATOR.value).exists()


def test_suspended_account_cannot_keep_authenticating() -> None:
    user = create_user()
    user.status = User.Status.SUSPENDED
    user.save()
    client, csrf = csrf_client()

    response = client.post(
        "/api/v1/auth/login",
        {"email": user.email, "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 403
    assert auth.authenticate(username=user.email, password=PASSWORD) is None


def _latest_email_link() -> str:
    from django.core import mail

    assert mail.outbox
    links = [line for line in mail.outbox[-1].body.splitlines() if line.startswith("http")]
    assert len(links) == 1
    return links[0]


def test_account_emails_link_into_the_client_router_with_the_token(settings: Any) -> None:
    """A path-only link is served by the static index and loses the token."""

    settings.PUBLIC_APP_URL = "https://app.example.test"
    client, csrf = csrf_client()

    client.post("/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf)
    verification_link = _latest_email_link()
    raw_token = token_from_latest_email()

    assert verification_link.startswith("https://app.example.test/#/verify-email?token=")
    assert raw_token in verification_link

    client.post(
        "/api/v1/auth/password-reset",
        {"email": REGISTRATION["email"]},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    # The account is not verified yet, so no reset mail is sent and the last
    # message is still the verification one. Verify first, then check the reset.
    client.post(
        "/api/v1/auth/verify-email",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    client.post(
        "/api/v1/auth/password-reset",
        {"email": REGISTRATION["email"]},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert _latest_email_link().startswith("https://app.example.test/#/reset-password?token=")


def test_email_change_and_deletion_links_use_the_same_router_form(settings: Any) -> None:
    settings.PUBLIC_APP_URL = "https://app.example.test/"
    user = create_user(email="linkform@example.com", username="linkform")
    client, csrf = csrf_client()
    client.force_login(user)

    client.post(
        "/api/v1/account/email",
        {"new_email": "moved@example.com", "current_password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert _latest_email_link().startswith("https://app.example.test/#/confirm-email?token=")

    client.post(
        "/api/v1/account/deletion",
        {"current_password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert _latest_email_link().startswith("https://app.example.test/#/settings?token=")


def test_verification_link_token_completes_registration_and_enables_login() -> None:
    """The full production path: register, follow the mailed link, then sign in."""

    client, csrf = csrf_client()
    client.post("/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf)
    raw_token = token_from_latest_email()

    before_login = client.post(
        "/api/v1/auth/login",
        {"email": REGISTRATION["email"], "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    verified = client.post(
        "/api/v1/auth/verify-email",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    after_login = client.post(
        "/api/v1/auth/login",
        {"email": REGISTRATION["email"], "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert before_login.status_code == 403
    assert before_login.json()["error"]["code"] == "invalid_credentials"
    assert verified.status_code == 200
    assert verified.json() == {"status": "verified"}
    user = User.objects.get()
    assert user.email_verified_at is not None
    assert OneTimeToken.objects.get(kind=OneTimeToken.Kind.EMAIL_VERIFICATION).used_at is not None
    assert after_login.status_code == 200
    assert after_login.json()["user"]["email"] == "new@example.com"
    assert after_login.json()["user"]["is_email_verified"] is True


def test_verify_email_rejects_an_unknown_token_without_touching_any_account() -> None:
    client, csrf = csrf_client()
    client.post("/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf)

    response = client.post(
        "/api/v1/auth/verify-email",
        {"token": "not-a-real-token"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_or_expired_token"
    assert not User.objects.get().is_email_verified


def test_verify_email_rejects_an_expired_token(settings: Any) -> None:
    settings.ACCOUNT_EMAIL_VERIFICATION_TTL_SECONDS = 0
    client, csrf = csrf_client()
    client.post("/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf)
    raw_token = token_from_latest_email()

    response = client.post(
        "/api/v1/auth/verify-email",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_or_expired_token"
    assert not User.objects.get().is_email_verified


def test_resend_verification_supersedes_the_previous_link_and_verifies() -> None:
    client, csrf = csrf_client()
    client.post("/api/v1/auth/register", REGISTRATION, format="json", HTTP_X_CSRFTOKEN=csrf)
    first_token = token_from_latest_email()

    resent = client.post(
        "/api/v1/auth/resend-verification",
        {"email": REGISTRATION["email"]},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    second_token = token_from_latest_email()
    superseded = client.post(
        "/api/v1/auth/verify-email",
        {"token": first_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    accepted = client.post(
        "/api/v1/auth/verify-email",
        {"token": second_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert resent.status_code == 200
    assert second_token != first_token
    assert superseded.status_code == 400
    assert accepted.status_code == 200
    assert User.objects.get().is_email_verified


def test_email_case_and_spacing_are_normalized_across_register_verify_and_login() -> None:
    client, csrf = csrf_client()
    client.post(
        "/api/v1/auth/register",
        {**REGISTRATION, "email": "  MiXeD.Case@Example.COM  "},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    raw_token = token_from_latest_email()
    client.post(
        "/api/v1/auth/verify-email",
        {"token": raw_token},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    response = client.post(
        "/api/v1/auth/login",
        {"email": "MIXED.CASE@EXAMPLE.com", "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert User.objects.get().email == "mixed.case@example.com"
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "mixed.case@example.com"
