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

from apps.accounts.models import (
    AccountSecurityEvent,
    AccountSession,
    OAuthFlow,
    SocialIdentity,
    User,
)
from apps.accounts.oauth import (
    APPLE_TOKEN_ENDPOINT,
    GOOGLE_TOKEN_ENDPOINT,
    OAuthAccountLinkError,
    OAuthConfigurationError,
    OAuthFlowError,
    OAuthProviderError,
    OAuthRegistrationUnavailable,
    OAuthSignupRequired,
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


def start_flow(
    *,
    client: APIClient,
    csrf: str,
    provider: str,
    intent: str = "register",
    accept_policies: bool = True,
) -> str:
    """Start a flow the way the client does: the provider button states the
    consent, so acceptance rides along on login and registration alike."""

    response = client.post(
        f"/api/v1/auth/oauth/{provider}/start",
        {
            "intent": intent,
            "preferred_language": "ar",
            "remember_me": True,
            "accept_policies": accept_policies,
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
    start_flow(client=client, csrf=csrf, provider="google", intent="login", accept_policies=False)
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
        pytest.raises(OAuthSignupRequired, match="before signing in"),
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


def test_google_is_the_only_available_provider_for_both_screens(settings: Any) -> None:
    """Availability is provider state, not screen state: one answer serves both."""

    configure_google(settings)
    settings.APPLE_OAUTH_SERVICES_ID = ""
    settings.APPLE_OAUTH_TEAM_ID = ""
    settings.APPLE_OAUTH_KEY_ID = ""
    settings.APPLE_OAUTH_PRIVATE_KEY = ""

    response = APIClient().get("/api/v1/auth/oauth/providers")

    assert response.status_code == 200
    assert response.json() == {"providers": {"google": True, "apple": False}}


def test_google_start_accepts_both_intents_and_records_them(settings: Any) -> None:
    configure_google(settings)
    client, csrf = csrf_client()

    for intent in ("login", "register"):
        response = client.post(
            "/api/v1/auth/oauth/google/start",
            {
                "intent": intent,
                "preferred_language": "ar",
                "remember_me": True,
                "accept_policies": True,
            },
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        assert response.status_code == 200
        authorization_url = response.json()["authorization_url"]
        assert authorization_url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")

    assert sorted(OAuthFlow.objects.values_list("intent", flat=True)) == ["login", "register"]
    # The consent stated at the provider button is recorded against the current
    # policy version for both screens, not only for the registration screen.
    for flow in OAuthFlow.objects.all():
        assert flow.policy_accepted
        assert flow.policy_version == settings.ACCOUNT_POLICY_VERSION


def test_oauth_start_requires_an_explicit_position_on_the_policies(settings: Any) -> None:
    """Consent is never inferred from silence: a client that omits the field is
    rejected rather than quietly recorded as having declined (or accepted)."""

    configure_google(settings)
    client, csrf = csrf_client()

    response = client.post(
        "/api/v1/auth/oauth/google/start",
        {"intent": "login", "preferred_language": "ar", "remember_me": True},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 400
    assert "accept_policies" in response.json()["error"]["fields"]
    assert not OAuthFlow.objects.exists()


def test_google_login_signs_in_an_existing_social_account(settings: Any) -> None:
    """The reported failure: sign-in from the login screen, not the signup screen."""

    configure_google(settings)
    existing = create_user(email="returning@example.com", username="returning")
    SocialIdentity.objects.create(
        user=existing,
        provider="google",
        subject="returning-subject",
        provider_email=existing.email,
        email_verified=True,
    )
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    profile = ProviderProfile(
        provider="google",
        subject="returning-subject",
        email=existing.email,
        email_verified=True,
        full_name="Returning Student",
        is_private_relay=False,
    )

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert response.status_code == 302
    assert response["Location"].endswith("?oauth=success&provider=google")
    assert AccountSession.objects.get(user=existing).session_key == client.session.session_key
    assert client.get("/api/v1/auth/session").json()["user"]["email"] == existing.email


@pytest.mark.parametrize("intent", ["login", "register"])
def test_a_new_google_user_is_created_from_either_screen(settings: Any, intent: str) -> None:
    """The reported failure: "Continue with Google" from the login screen was
    rejected for a first-time user. The button states the consent on both
    screens, so both screens can complete a first sign-in."""

    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent=intent)
    profile = ProviderProfile(
        provider="google",
        subject="first-time-subject",
        email="first-time@example.com",
        email_verified=True,
        full_name="First Timer",
        is_private_relay=False,
    )

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert response["Location"].endswith("?oauth=success&provider=google")
    created = User.objects.get(email="first-time@example.com")
    assert created.is_email_verified
    assert SocialIdentity.objects.get(user=created).subject == "first-time-subject"
    assert AccountSession.objects.get(user=created).session_key == client.session.session_key


def test_the_accepted_policy_version_is_recorded_against_the_new_account(settings: Any) -> None:
    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    profile = ProviderProfile(
        provider="google",
        subject="recorded-consent-subject",
        email="recorded-consent@example.com",
        email_verified=True,
        full_name="Recorded Consent",
        is_private_relay=False,
    )

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        client.get("/api/v1/auth/oauth/google/callback", {"state": state, "code": "one-time-code"})

    created = User.objects.get(email="recorded-consent@example.com")
    assert created.policy_accepted_at is not None
    assert created.policy_version == settings.ACCOUNT_POLICY_VERSION
    registration_event = AccountSecurityEvent.objects.get(
        user=created,
        event_type=AccountSecurityEvent.EventType.REGISTERED,
    )
    assert registration_event.metadata == {
        "policy_version": settings.ACCOUNT_POLICY_VERSION,
        "provider": "google",
    }


def test_a_flow_without_recorded_consent_cannot_create_an_account(settings: Any) -> None:
    """Consent is not weakened, only relocated: a flow that carries no recorded
    acceptance still creates nothing, whichever intent it claims."""

    configure_google(settings)
    profile = ProviderProfile(
        provider="google",
        subject="no-consent-subject",
        email="no-consent@example.com",
        email_verified=True,
        full_name="No Consent",
        is_private_relay=False,
    )

    for intent in ("login", "register"):
        client, csrf = csrf_client()
        state = start_flow(
            client=client, csrf=csrf, provider="google", intent=intent, accept_policies=False
        )
        with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
            response = client.get(
                "/api/v1/auth/oauth/google/callback",
                {"state": state, "code": "one-time-code"},
            )
        assert "oauth_error=signup_required" in response["Location"]

    # A stored acceptance with no policy version to attribute it to is not
    # consent either, so a tampered flow row cannot buy an account.
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    OAuthFlow.objects.filter(used_at__isnull=True).update(policy_version="")
    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert "oauth_error=signup_required" in response["Location"]
    assert not User.objects.filter(email="no-consent@example.com").exists()
    assert not SocialIdentity.objects.exists()


def test_consented_login_creation_still_enforces_state_binding_and_single_use(
    settings: Any,
) -> None:
    """Carrying consent from the login screen changes what a valid flow may do,
    never which flows are valid."""

    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    profile = ProviderProfile(
        provider="google",
        subject="protected-subject",
        email="protected@example.com",
        email_verified=True,
        full_name="Protected",
        is_private_relay=False,
    )

    # The state alone is not enough: another browser holds no binding cookie.
    other_browser = APIClient()
    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        stolen = other_browser.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )
    assert "oauth_error=flow_invalid" in stolen["Location"]
    assert not User.objects.filter(email="protected@example.com").exists()

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        first = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )
        replayed = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert first["Location"].endswith("?oauth=success&provider=google")
    assert "oauth_error=flow_invalid" in replayed["Location"]
    assert User.objects.filter(email="protected@example.com").count() == 1


def test_google_signup_after_the_signup_prompt_creates_the_account(settings: Any) -> None:
    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="register")
    profile = ProviderProfile(
        provider="google",
        subject="first-time-subject",
        email="first-time@example.com",
        email_verified=True,
        full_name="First Timer",
        is_private_relay=False,
    )

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert response["Location"].endswith("?oauth=success&provider=google")
    created = User.objects.get(email="first-time@example.com")
    assert created.is_email_verified
    assert created.policy_version == settings.ACCOUNT_POLICY_VERSION


def test_disabled_registration_still_reports_a_closed_platform(settings: Any) -> None:
    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="register")
    profile = ProviderProfile(
        provider="google",
        subject="closed-platform-subject",
        email="closed@example.com",
        email_verified=True,
        full_name="Closed Platform",
        is_private_relay=False,
    )

    with (
        patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile),
        patch("apps.accounts.oauth._registration_enabled", return_value=False),
    ):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert "oauth_error=registration_unavailable" in response["Location"]
    assert not User.objects.filter(email="closed@example.com").exists()


def _complete_google_signup(
    *,
    settings: Any,
    provider_name: str,
    email: str = "rami@example.com",
    subject: str = "google-onboarding-subject",
) -> tuple[APIClient, str, User]:
    """Run a first-time Google sign-in and return the client ready to onboard."""

    configure_google(settings)
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    profile = ProviderProfile(
        provider="google",
        subject=subject,
        email=email,
        email_verified=True,
        full_name=provider_name,
        is_private_relay=False,
    )
    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )
    assert response["Location"].endswith("?oauth=success&provider=google")
    rotated_csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    return client, rotated_csrf, User.objects.get(email=email)


def test_the_chosen_username_is_the_only_public_name_a_google_account_shows(
    settings: Any,
) -> None:
    """The reported failure: Google offered "Rami ha", the reader chose "ra33",
    and the product showed the provider's name instead of the chosen one."""

    client, csrf, created = _complete_google_signup(settings=settings, provider_name="Rami ha")

    # Nothing from the provider was written into the profile in the first place.
    assert created.full_name == ""
    assert created.username is None

    completed = client.patch(
        "/api/v1/account/profile",
        {"username": "ra33"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert completed.status_code == 200
    created.refresh_from_db()
    assert created.username == "ra33"
    # The displayed name is exactly the chosen username -- not the provider's
    # name, and not the two of them joined.
    assert created.full_name == "ra33"
    session_user = client.get("/api/v1/auth/session").json()["user"]
    assert session_user["full_name"] == "ra33"
    assert session_user["username"] == "ra33"
    assert not session_user["username_required"]
    # "Rami ha" survives nowhere a reader can see, in whole or in part.
    assert "Rami" not in json.dumps(session_user)
    assert "Rami ha ra33" not in json.dumps(session_user)
    # The provider identity is kept only where sign-in needs it.
    identity = SocialIdentity.objects.get(user=created)
    assert identity.subject == "google-onboarding-subject"
    assert identity.provider_email == "rami@example.com"


def test_a_spaced_provider_name_does_not_reach_the_chosen_username(settings: Any) -> None:
    client, csrf = _complete_google_signup(
        settings=settings, provider_name="  Rami   ha  Al Fitouri  "
    )[:2]

    completed = client.patch(
        "/api/v1/account/profile",
        {"username": "  RA33  "},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert completed.status_code == 200
    # Normalization is the username's own: trimmed and lowercased, with no part
    # of the provider's spaced name folded in.
    user = User.objects.get(email="rami@example.com")
    assert user.username == "ra33"
    assert user.full_name == "ra33"
    assert " " not in user.full_name


def test_username_validation_and_uniqueness_survive_the_display_name_change(
    settings: Any,
) -> None:
    create_user(email="taken@example.com", username="ra33", full_name="Existing Owner")
    client, csrf = _complete_google_signup(settings=settings, provider_name="Rami ha")[:2]

    for rejected_username in ("ra", "ra 33", "Ra33!", "_ra33", "r" * 31):
        response = client.patch(
            "/api/v1/account/profile",
            {"username": rejected_username},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        assert response.status_code == 400, rejected_username
        assert "username" in response.json()["error"]["fields"]

    taken = client.patch(
        "/api/v1/account/profile",
        {"username": "RA33"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert taken.status_code == 400
    assert "username" in taken.json()["error"]["fields"]
    # A refused username leaves no display name behind either.
    rejected_user = User.objects.get(email="rami@example.com")
    assert rejected_user.username is None
    assert rejected_user.full_name == ""
    # The account that already owned the name is untouched.
    assert User.objects.get(email="taken@example.com").full_name == "Existing Owner"


def test_a_display_name_the_reader_wrote_is_never_replaced_by_a_username(
    settings: Any,
) -> None:
    """Email-and-password accounts name themselves at registration, so setting a
    username later must not overwrite what they wrote."""

    user = create_user(email="typed@example.com", full_name="Ahmed Al Mansouri")
    client = APIClient()
    client.force_authenticate(user=user)

    named = client.patch("/api/v1/account/profile", {"username": "ahmed99"}, format="json")

    assert named.status_code == 200
    user.refresh_from_db()
    assert user.username == "ahmed99"
    assert user.full_name == "Ahmed Al Mansouri"

    # A provider account that later renames itself keeps its display in step,
    # until the reader writes a name of their own -- which then stays.
    google_client, csrf = _complete_google_signup(settings=settings, provider_name="Rami ha")[:2]
    google_client.patch(
        "/api/v1/account/profile", {"username": "ra33"}, format="json", HTTP_X_CSRFTOKEN=csrf
    )
    google_client.patch(
        "/api/v1/account/profile", {"username": "ra34"}, format="json", HTTP_X_CSRFTOKEN=csrf
    )
    renamed = User.objects.get(email="rami@example.com")
    assert (renamed.username, renamed.full_name) == ("ra34", "ra34")

    google_client.patch(
        "/api/v1/account/profile",
        {"full_name": "Rami Chosen"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    google_client.patch(
        "/api/v1/account/profile", {"username": "ra35"}, format="json", HTTP_X_CSRFTOKEN=csrf
    )
    kept = User.objects.get(email="rami@example.com")
    assert (kept.username, kept.full_name) == ("ra35", "Rami Chosen")


def test_an_existing_google_account_keeps_its_name_and_signs_in_unchanged(settings: Any) -> None:
    """Accounts that onboarded before this change are read, not rewritten."""

    configure_google(settings)
    existing = create_user(
        email="returning-google@example.com", username="ra33", full_name="Rami ha"
    )
    SocialIdentity.objects.create(
        user=existing,
        provider="google",
        subject="returning-google-subject",
        provider_email=existing.email,
        email_verified=True,
    )
    client, csrf = csrf_client()
    state = start_flow(client=client, csrf=csrf, provider="google", intent="login")
    profile = ProviderProfile(
        provider="google",
        subject="returning-google-subject",
        email=existing.email,
        email_verified=True,
        full_name="Rami ha",
        is_private_relay=False,
    )

    with patch("apps.accounts.oauth.exchange_oauth_code", return_value=profile):
        response = client.get(
            "/api/v1/auth/oauth/google/callback",
            {"state": state, "code": "one-time-code"},
        )

    assert response["Location"].endswith("?oauth=success&provider=google")
    existing.refresh_from_db()
    assert (existing.username, existing.full_name) == ("ra33", "Rami ha")
    assert client.get("/api/v1/auth/session").json()["user"]["full_name"] == "Rami ha"
