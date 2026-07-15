from typing import Any

import pytest
from django.contrib import auth
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.models import AccountSession, AuthAttempt, OneTimeToken, User
from apps.accounts.roles import Role

from .helpers import PASSWORD, create_user, csrf_client, token_from_latest_email

pytestmark = pytest.mark.django_db


REGISTRATION = {
    "full_name": "  New Student  ",
    "email": "NEW@Example.com",
    "password": PASSWORD,
    "password_confirm": PASSWORD,
    "preferred_language": "ar",
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
    assert user.policy_version == settings.ACCOUNT_POLICY_VERSION
    assert user.policy_accepted_at is not None
    assert not user.is_email_verified
    assert not user.groups.exists()
    token = OneTimeToken.objects.get(kind=OneTimeToken.Kind.EMAIL_VERIFICATION)
    raw_token = token_from_latest_email()
    assert raw_token not in token.token_digest
    assert token.token_digest != raw_token


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
