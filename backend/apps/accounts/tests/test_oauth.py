import json
from datetime import timedelta
from typing import Any
from unittest.mock import MagicMock, patch
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import AccountSession, OAuthFlow, SocialIdentity, User
from apps.accounts.oauth import (
    APPLE_TOKEN_ENDPOINT,
    GOOGLE_TOKEN_ENDPOINT,
    OAuthAccountLinkError,
    OAuthConfigurationError,
    OAuthFlowError,
    OAuthProviderError,
    OAuthRegistrationUnavailable,
    ProviderConfig,
    ProviderProfile,
    _apple_client_secret,
    _apple_name,
    _post_form_json,
    _token_payload,
    _verified_claims,
    consume_oauth_flow,
    exchange_oauth_code,
    oauth_browser_cookie_name,
    provider_config,
    resolve_social_user,
)
from apps.subscriptions.models import Subscription

from .helpers import create_user, csrf_client

pytestmark = pytest.mark.django_db


def configure_google(settings: Any) -> None:
    settings.GOOGLE_OAUTH_CLIENT_ID = "google-client-id.apps.googleusercontent.com"
    settings.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret"
    settings.GOOGLE_OAUTH_REDIRECT_URI = "http://testserver/api/v1/auth/oauth/google/callback"
    settings.PUBLIC_APP_URL = "http://testserver/"


def configure_apple(settings: Any) -> None:
    settings.APPLE_OAUTH_SERVICES_ID = "com.example.lockin.web"
    settings.APPLE_OAUTH_TEAM_ID = "TEAM123456"
    settings.APPLE_OAUTH_KEY_ID = "KEY1234567"
    settings.APPLE_OAUTH_PRIVATE_KEY = "test-private-key"
    settings.APPLE_OAUTH_REDIRECT_URI = "http://testserver/api/v1/auth/oauth/apple/callback"
    settings.PUBLIC_APP_URL = "http://testserver/"


def start_flow(*, client: APIClient, csrf: str, provider: str, intent: str = "register") -> str:
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
    assert status_response.json() == {"providers": {"google": True, "apple": False}}


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


def test_oauth_callback_is_source_rate_limited(settings: Any) -> None:
    configure_google(settings)
    settings.ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT = 1
    client = APIClient()

    first = client.get("/api/v1/auth/oauth/google/callback")
    limited = client.get("/api/v1/auth/oauth/google/callback")

    assert "oauth_error=flow_invalid" in first["Location"]
    assert "oauth_error=rate_limited" in limited["Location"]


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


def test_oauth_provider_http_json_is_allowlisted_bounded_and_validated(settings: Any) -> None:
    settings.OAUTH_HTTP_TIMEOUT_SECONDS = 3
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps({"id_token": "token"}).encode()
    with patch("apps.accounts.oauth.urlopen", return_value=response) as opened:
        assert _post_form_json(GOOGLE_TOKEN_ENDPOINT, {"code": "one-time"}) == {"id_token": "token"}
    assert opened.call_args.kwargs["timeout"] == 3

    with pytest.raises(OAuthProviderError, match="not permitted"):
        _post_form_json("https://attacker.example/token", {"code": "unsafe"})
    with (
        patch("apps.accounts.oauth.urlopen", side_effect=URLError("offline")),
        pytest.raises(OAuthProviderError, match="could not complete"),
    ):
        _post_form_json(GOOGLE_TOKEN_ENDPOINT, {"code": "offline"})

    for raw in (b"x" * 65_537, b"not-json", b"[]"):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = raw
        with (
            patch("apps.accounts.oauth.urlopen", return_value=response),
            pytest.raises(OAuthProviderError, match="invalid response"),
        ):
            _post_form_json(APPLE_TOKEN_ENDPOINT, {"code": "invalid"})


def test_token_exchange_builds_google_and_apple_requests_and_rejects_provider_errors(
    settings: Any,
) -> None:
    configure_google(settings)
    with patch(
        "apps.accounts.oauth._post_form_json", return_value={"id_token": "google-token"}
    ) as posted:
        assert _token_payload(provider="google", code="google-code")["id_token"] == "google-token"
    assert posted.call_args.args[0] == GOOGLE_TOKEN_ENDPOINT
    assert posted.call_args.args[1]["client_secret"] == "test-google-secret"

    configure_apple(settings)
    with (
        patch("apps.accounts.oauth._apple_client_secret", return_value="apple-secret"),
        patch(
            "apps.accounts.oauth._post_form_json", return_value={"id_token": "apple-token"}
        ) as posted,
    ):
        assert _token_payload(provider="apple", code="apple-code")["id_token"] == "apple-token"
    assert posted.call_args.args[0] == APPLE_TOKEN_ENDPOINT
    assert posted.call_args.args[1]["client_secret"] == "apple-secret"

    with (
        patch("apps.accounts.oauth._apple_client_secret", return_value="apple-secret"),
        patch("apps.accounts.oauth._post_form_json", return_value={"error": "invalid_grant"}),
        pytest.raises(OAuthProviderError, match="could not complete"),
    ):
        _token_payload(provider="apple", code="expired")


def test_apple_client_secret_and_verified_claims_are_strict(settings: Any) -> None:
    configure_apple(settings)
    config = ProviderConfig(
        provider="apple",
        client_id=settings.APPLE_OAUTH_SERVICES_ID,
        client_secret="line-one\\nline-two",
        redirect_uri=settings.APPLE_OAUTH_REDIRECT_URI,
    )
    with patch("apps.accounts.oauth.jwt.encode", return_value="signed-secret") as encoded:
        assert _apple_client_secret(config) == "signed-secret"
    assert encoded.call_args.args[1] == "line-one\nline-two"
    with (
        patch("apps.accounts.oauth.jwt.encode", side_effect=ValueError("bad key")),
        pytest.raises(OAuthConfigurationError, match="credentials are invalid"),
    ):
        _apple_client_secret(config)

    configure_google(settings)
    signing_key = MagicMock()
    signing_key.key = "public-key"
    jwks = MagicMock()
    jwks.get_signing_key_from_jwt.return_value = signing_key
    claims = {
        "sub": "subject",
        "nonce": "expected-nonce",
        "aud": settings.GOOGLE_OAUTH_CLIENT_ID,
    }
    with (
        patch("apps.accounts.oauth.jwt.PyJWKClient", return_value=jwks),
        patch("apps.accounts.oauth.jwt.decode", return_value=claims) as decoded,
    ):
        assert (
            _verified_claims(provider="google", id_token="signed-token", nonce="expected-nonce")
            == claims
        )
    assert decoded.call_args.kwargs["audience"] == settings.GOOGLE_OAUTH_CLIENT_ID

    with (
        patch("apps.accounts.oauth.jwt.PyJWKClient", return_value=jwks),
        patch("apps.accounts.oauth.jwt.decode", return_value={"nonce": "wrong"}),
        pytest.raises(OAuthProviderError, match="invalid identity token"),
    ):
        _verified_claims(provider="google", id_token="token", nonce="expected")
    with (
        patch("apps.accounts.oauth.jwt.PyJWKClient", side_effect=jwt.PyJWTError("bad")),
        pytest.raises(OAuthProviderError, match="invalid identity token"),
    ):
        _verified_claims(provider="google", id_token="bad", nonce="expected")


def test_provider_profile_rejects_missing_subject_and_invalid_email() -> None:
    assert _apple_name("") == ""
    assert _apple_name("{") == ""
    assert _apple_name("[]") == ""
    assert _apple_name('{"name":"not-an-object"}') == ""

    with (
        patch("apps.accounts.oauth._token_payload", return_value={"id_token": "token"}),
        patch("apps.accounts.oauth._verified_claims", return_value={"email": "ok@example.com"}),
        pytest.raises(OAuthProviderError, match="invalid identity token"),
    ):
        exchange_oauth_code(provider="google", code="code", nonce="nonce")


def test_oauth_rejects_unsupported_configuration_and_tampered_flow_state(settings: Any) -> None:
    with pytest.raises(OAuthConfigurationError, match="not supported"):
        provider_config("unknown")
    settings.GOOGLE_OAUTH_CLIENT_ID = ""
    settings.GOOGLE_OAUTH_CLIENT_SECRET = ""
    settings.GOOGLE_OAUTH_REDIRECT_URI = ""
    with pytest.raises(OAuthConfigurationError, match="not configured"):
        provider_config("google")
    with pytest.raises(OAuthFlowError, match="invalid or expired"):
        consume_oauth_flow(provider="google", state="tampered", browser_binding="browser")
    with (
        patch(
            "apps.accounts.oauth.signing.loads",
            return_value={"flow_id": "", "state_secret": "secret", "nonce": "nonce"},
        ),
        pytest.raises(OAuthFlowError, match="invalid or expired"),
    ):
        consume_oauth_flow(provider="google", state="signed", browser_binding="browser")

    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google")
    binding = client.cookies[oauth_browser_cookie_name()].value
    flow = OAuthFlow.objects.get()
    flow.used_at = timezone.now()
    flow.save(update_fields=("used_at",))
    with pytest.raises(OAuthFlowError, match="invalid or expired"):
        consume_oauth_flow(provider="google", state=state, browser_binding=binding)

    state = start_flow(client=client, csrf=csrf, provider="google")
    flow = OAuthFlow.objects.filter(used_at__isnull=True).get()
    flow.state_digest = "0" * 64
    flow.save(update_fields=("state_digest",))
    with pytest.raises(OAuthFlowError, match="invalid or expired"):
        consume_oauth_flow(provider="google", state=state, browser_binding=binding)

    flow.state_digest = "stored-digest"
    flow.save(update_fields=("state_digest",))
    with (
        patch(
            "apps.accounts.oauth.signing.loads",
            return_value={
                "flow_id": str(flow.id),
                "state_secret": "secret",
                "nonce": "nonce",
            },
        ),
        patch("apps.accounts.oauth._flow_digest", return_value="different-digest"),
        pytest.raises(OAuthFlowError, match="invalid or expired"),
    ):
        consume_oauth_flow(provider="google", state="signed", browser_binding=binding)

    state = start_flow(client=client, csrf=csrf, provider="google")
    flow = OAuthFlow.objects.filter(used_at__isnull=True).latest("created_at")
    flow.nonce_digest = "0" * 64
    flow.save(update_fields=("nonce_digest",))
    with pytest.raises(OAuthFlowError, match="invalid or expired"):
        consume_oauth_flow(provider="google", state=state, browser_binding=binding)


def test_social_registration_failures_are_converted_to_safe_domain_errors(settings: Any) -> None:
    configure_google(settings)
    client, csrf = csrf_client()
    start_flow(client=client, csrf=csrf, provider="google", intent="login")
    login_flow = OAuthFlow.objects.get()
    new_profile = ProviderProfile(
        provider="google",
        subject="safe-failure-subject",
        email="safe-failure@example.com",
        email_verified=True,
        full_name="Safe Failure",
        is_private_relay=False,
    )
    with (
        patch("apps.accounts.oauth._registration_enabled", return_value=False),
        pytest.raises(OAuthRegistrationUnavailable, match="temporarily unavailable"),
    ):
        resolve_social_user(profile=new_profile, flow=login_flow)
    with (
        patch("apps.accounts.oauth._registration_enabled", return_value=True),
        pytest.raises(OAuthRegistrationUnavailable, match="Accept the current"),
    ):
        resolve_social_user(profile=new_profile, flow=login_flow)

    client, csrf = csrf_client()
    start_flow(client=client, csrf=csrf, provider="google")
    registration_flow = OAuthFlow.objects.filter(policy_accepted=True).latest("created_at")
    with (
        patch("apps.accounts.oauth._registration_enabled", return_value=True),
        patch("apps.accounts.oauth.User.objects.create_user", side_effect=IntegrityError),
        pytest.raises(OAuthAccountLinkError, match="registered while"),
    ):
        resolve_social_user(profile=new_profile, flow=registration_flow)

    existing = create_user(email="identity-race@example.com", username="identity_race")
    race_profile = ProviderProfile(
        provider="google",
        subject="identity-race-subject",
        email=existing.email,
        email_verified=True,
        full_name="Identity Race",
        is_private_relay=False,
    )
    with (
        patch("apps.accounts.oauth.SocialIdentity.objects.create", side_effect=IntegrityError),
        pytest.raises(OAuthAccountLinkError, match="linked safely"),
    ):
        resolve_social_user(profile=race_profile, flow=registration_flow)

    inactive = create_user(email="inactive-match@example.com", username="inactive_match")
    inactive.status = User.Status.SUSPENDED
    inactive.is_active = False
    inactive.save(update_fields=("status", "is_active", "updated_at"))
    inactive_profile = ProviderProfile(
        provider="google",
        subject="inactive-match-subject",
        email=inactive.email,
        email_verified=True,
        full_name="Inactive Match",
        is_private_relay=False,
    )
    with pytest.raises(OAuthAccountLinkError, match="cannot sign in"):
        resolve_social_user(profile=inactive_profile, flow=registration_flow)


def test_social_identity_reconnect_updates_metadata_and_blocks_unsafe_links(settings: Any) -> None:
    configure_google(settings)
    client, csrf = csrf_client()
    start_flow(client=client, csrf=csrf, provider="google")
    flow = OAuthFlow.objects.get()
    linked_user = create_user(email="linked-oauth@example.com", username="linked_oauth")
    identity = SocialIdentity.objects.create(
        user=linked_user,
        provider=SocialIdentity.Provider.GOOGLE,
        subject="linked-subject",
        provider_email="old-provider@example.com",
        email_verified=True,
    )
    refreshed_profile = ProviderProfile(
        provider="google",
        subject="linked-subject",
        email="linked-oauth@example.com",
        email_verified=True,
        full_name="Linked Student",
        is_private_relay=False,
    )
    assert resolve_social_user(profile=refreshed_profile, flow=flow) == linked_user
    identity.refresh_from_db()
    assert identity.provider_email == "linked-oauth@example.com"
    assert identity.last_used_at is not None

    linked_user.status = User.Status.SUSPENDED
    linked_user.is_active = False
    linked_user.save(update_fields=("status", "is_active", "updated_at"))
    with pytest.raises(OAuthAccountLinkError, match="cannot sign in"):
        resolve_social_user(profile=refreshed_profile, flow=flow)

    missing_verified_email = ProviderProfile(
        provider="google",
        subject="unverified-provider-subject",
        email="",
        email_verified=False,
        full_name="Unverified",
        is_private_relay=False,
    )
    with pytest.raises(OAuthAccountLinkError, match="verified email"):
        resolve_social_user(profile=missing_verified_email, flow=flow)

    already_linked = create_user(email="already-linked@example.com", username="already_linked")
    SocialIdentity.objects.create(
        user=already_linked,
        provider=SocialIdentity.Provider.GOOGLE,
        subject="original-google-subject",
        provider_email=already_linked.email,
        email_verified=True,
    )
    conflicting_profile = ProviderProfile(
        provider="google",
        subject="different-google-subject",
        email=already_linked.email,
        email_verified=True,
        full_name="Already Linked",
        is_private_relay=False,
    )
    with pytest.raises(OAuthAccountLinkError, match="different account"):
        resolve_social_user(profile=conflicting_profile, flow=flow)
    with (
        patch("apps.accounts.oauth._token_payload", return_value={"id_token": "token"}),
        patch(
            "apps.accounts.oauth._verified_claims",
            return_value={"sub": "subject", "email": "not-an-email", "nonce": "nonce"},
        ),
        pytest.raises(OAuthProviderError, match="invalid email"),
    ):
        exchange_oauth_code(provider="google", code="code", nonce="nonce")
