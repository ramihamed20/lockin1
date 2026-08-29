from datetime import timedelta
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import AccountSession, OAuthFlow, SocialIdentity, User
from apps.accounts.oauth import ProviderProfile, exchange_oauth_code
from apps.subscriptions.models import Subscription

from .helpers import create_user, csrf_client

pytestmark = pytest.mark.django_db


def configure_google(settings: Any) -> None:
    settings.GOOGLE_OAUTH_CLIENT_ID = "google-client-id.apps.googleusercontent.com"
    settings.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret"
    settings.GOOGLE_OAUTH_REDIRECT_URI = (
        "http://testserver/api/v1/auth/oauth/google/callback"
    )
    settings.PUBLIC_APP_URL = "http://testserver/"


def configure_apple(settings: Any) -> None:
    settings.APPLE_OAUTH_SERVICES_ID = "com.example.lockin.web"
    settings.APPLE_OAUTH_TEAM_ID = "TEAM123456"
    settings.APPLE_OAUTH_KEY_ID = "KEY1234567"
    settings.APPLE_OAUTH_PRIVATE_KEY = "test-private-key"
    settings.APPLE_OAUTH_REDIRECT_URI = (
        "http://testserver/api/v1/auth/oauth/apple/callback"
    )
    settings.PUBLIC_APP_URL = "http://testserver/"


def start_flow(
    *, client: APIClient, csrf: str, provider: str, intent: str = "register"
) -> str:
    response = client.post(
        f"/api/v1/auth/oauth/{provider}/start",
        {
            "intent": intent,
            "preferred_language": "ar",
            "remember_me": True,
            "accept_policies": intent == "register",
        },
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == 200
    authorization_url = response.json()["authorization_url"]
    state = parse_qs(urlparse(authorization_url).query)["state"][0]
    assert "nonce" in parse_qs(urlparse(authorization_url).query)
    return state


def test_public_cohorts_are_data_backed_and_localized() -> None:
    response = APIClient().get("/api/v1/auth/cohorts")

    assert response.status_code == 200
    assert [(item["code"], item["name_ar"]) for item in response.json()["cohorts"]] == [
        ("61", "الطب البشري 61"),
        ("60", "الطب البشري 60"),
        ("year-2", "طب أسنان طرابلس سنة ثانية"),
        ("year-1", "طب أسنان طرابلس سنة أولى"),
        ("year-2", "طب أسنان زاوية سنة ثانية"),
        ("year-2", "طب أسنان بنغازي سنة ثانية"),
        ("preparatory", "تمهيدي علوم طبية طرابلس"),
    ]


def test_oauth_start_requires_csrf_and_reports_configuration(settings: Any) -> None:
    configure_google(settings)
    rejected = APIClient(enforce_csrf_checks=True).post(
        "/api/v1/auth/oauth/google/start",
        {"intent": "login"},
        format="json",
    )
    status_response = APIClient().get("/api/v1/auth/oauth/providers")

    assert rejected.status_code == 403
    assert status_response.json() == {
        "providers": {"google": True, "apple": False}
    }


def test_google_callback_creates_user_in_existing_session_system(
    settings: Any, django_capture_on_commit_callbacks: Any
) -> None:
    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google")
    profile = ProviderProfile(
        provider="google",
        subject="google-subject-new",
        email="oauth@example.com",
        email_verified=True,
        full_name="OAuth Student",
        is_private_relay=False,
    )

    with (
        django_capture_on_commit_callbacks(execute=True),
        patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile),
    ):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert response.status_code == 302
    assert response["Location"].endswith("?oauth=success&provider=google")
    user = User.objects.get(email="oauth@example.com")
    assert user.is_email_verified
    assert user.profile_completion_required
    assert user.preferred_language == "ar"
    assert SocialIdentity.objects.get(user=user).subject == "google-subject-new"
    assert AccountSession.objects.get(user=user).session_key == client.session.session_key
    session_user = client.get("/api/v1/auth/session").json()["user"]
    assert session_user["onboarding_required"]
    assert session_user["username_required"]
    subscription = Subscription.objects.get(account__primary_user=user)
    assert subscription.trial_ends_at - subscription.trial_started_at == timedelta(days=7)

    rotated_csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    username_completed = client.patch(
        "/api/v1/account/profile",
        {"username": "oauth_student"},
        format="json",
        HTTP_X_CSRFTOKEN=rotated_csrf,
    )
    assert username_completed.status_code == 200
    assert not username_completed.json()["user"]["username_required"]
    assert username_completed.json()["user"]["onboarding_required"]
    completed = client.patch(
        "/api/v1/account/profile",
        {"cohort_id": "a19b3034-e038-46b8-8806-7b113329f061"},
        format="json",
        HTTP_X_CSRFTOKEN=rotated_csrf,
    )
    assert completed.status_code == 200
    assert not completed.json()["user"]["onboarding_required"]


def test_verified_existing_email_is_linked_without_duplicate_user(settings: Any) -> None:
    configure_google(settings)
    existing = create_user(email="existing@example.com", username="existing")
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    profile = ProviderProfile(
        provider="google",
        subject="google-existing-subject",
        email=existing.email,
        email_verified=True,
        full_name="Ignored Provider Name",
        is_private_relay=False,
    )

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert response.status_code == 302
    assert User.objects.count() == 1
    assert SocialIdentity.objects.get().user == existing
    existing.refresh_from_db()
    assert not existing.profile_completion_required


def test_unverified_existing_email_cannot_be_taken_over_or_replayed(settings: Any) -> None:
    configure_google(settings)
    create_user(email="unverified@example.com", verified=False)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    profile = ProviderProfile(
        provider="google",
        subject="attacker-subject",
        email="unverified@example.com",
        email_verified=True,
        full_name="Attacker",
        is_private_relay=False,
    )

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        first = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )
        replay = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert "oauth_error=account_link_required" in first["Location"]
    assert "oauth_error=flow_invalid" in replay["Location"]
    assert not SocialIdentity.objects.exists()
    assert OAuthFlow.objects.get().used_at is not None


def test_copied_callback_state_is_rejected_in_a_different_browser(settings: Any) -> None:
    configure_google(settings)
    initiating_client, csrf = csrf_client()
    state = start_flow(client=initiating_client, csrf=csrf, provider="google")

    with patch("apps.accounts.oauth.exchange_oauth_code") as exchange:
        response = APIClient().get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "copied-code"},
        )

    assert "oauth_error=flow_invalid" in response["Location"]
    exchange.assert_not_called()
    assert OAuthFlow.objects.get().used_at is None


def test_apple_cancelled_form_post_consumes_state_without_csrf(settings: Any) -> None:
    configure_apple(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="apple", intent="login")

    response = client.post(
        "/api/v1/auth/oauth/apple/callback",
        {"state": state, "error": "access_denied"},
    )

    assert response.status_code == 302
    assert response["Location"].endswith("?oauth=cancelled&provider=apple")
    assert OAuthFlow.objects.get().used_at is not None


def test_apple_private_relay_domains_are_recognized() -> None:
    claims = {
        "sub": "apple-subject",
        "email": "student@private.icloud.com",
        "email_verified": "true",
        "nonce": "nonce",
    }
    with (
        patch("apps.accounts.oauth._token_payload", return_value={"id_token": "token"}),
        patch("apps.accounts.oauth._verified_claims", return_value=claims),
    ):
        profile = exchange_oauth_code(
            provider="apple",
            code="code",
            nonce="nonce",
            apple_user_payload='{"name":{"firstName":"Relay","lastName":"Student"}}',
        )

    assert profile.is_private_relay
    assert profile.full_name == "Relay Student"
