import json
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

import jwt
from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.http import HttpRequest
from django.utils import timezone
from django.utils.crypto import salted_hmac

from apps.system_configuration.services import get_configuration_value
from platform_core.events import publish_after_commit

from .events import UserEmailVerified, UserRegistered
from .models import AccountSecurityEvent, OAuthFlow, SocialIdentity, User
from .services import establish_account_session, normalize_email

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"  # noqa: S105
GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs"
APPLE_AUTHORIZATION_ENDPOINT = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_ENDPOINT = "https://appleid.apple.com/auth/token"  # noqa: S105
APPLE_JWKS_ENDPOINT = "https://appleid.apple.com/auth/keys"
APPLE_PRIVATE_RELAY_DOMAINS = frozenset(
    {"privaterelay.appleid.com", "private.icloud.com"}
)
_STATE_SALT = "lockin.accounts.oauth-state"
_MAX_PROVIDER_RESPONSE_BYTES = 65_536
OAUTH_BROWSER_COOKIE_PATH = "/"


class OAuthConfigurationError(RuntimeError):
    pass


class OAuthFlowError(ValueError):
    pass


class OAuthProviderError(RuntimeError):
    pass


class OAuthAccountLinkError(ValueError):
    pass


class OAuthRegistrationUnavailable(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    provider: str
    client_id: str
    client_secret: str
    redirect_uri: str


@dataclass(frozen=True, slots=True)
class ProviderProfile:
    provider: str
    subject: str
    email: str
    email_verified: bool
    full_name: str
    is_private_relay: bool


def _configured_value(name: str) -> str:
    value = getattr(settings, name, "")
    return value.strip() if isinstance(value, str) else ""


def provider_config(provider: str) -> ProviderConfig:
    if provider == SocialIdentity.Provider.GOOGLE:
        config = ProviderConfig(
            provider=provider,
            client_id=_configured_value("GOOGLE_OAUTH_CLIENT_ID"),
            client_secret=_configured_value("GOOGLE_OAUTH_CLIENT_SECRET"),
            redirect_uri=_configured_value("GOOGLE_OAUTH_REDIRECT_URI"),
        )
    elif provider == SocialIdentity.Provider.APPLE:
        config = ProviderConfig(
            provider=provider,
            client_id=_configured_value("APPLE_OAUTH_SERVICES_ID"),
            client_secret=_configured_value("APPLE_OAUTH_PRIVATE_KEY"),
            redirect_uri=_configured_value("APPLE_OAUTH_REDIRECT_URI"),
        )
        if not all(
            (
                config.client_id,
                config.client_secret,
                config.redirect_uri,
                _configured_value("APPLE_OAUTH_TEAM_ID"),
                _configured_value("APPLE_OAUTH_KEY_ID"),
            )
        ):
            raise OAuthConfigurationError("Apple sign-in is not configured.")
        return config
    else:
        raise OAuthConfigurationError("This sign-in provider is not supported.")
    if not all((config.client_id, config.client_secret, config.redirect_uri)):
        raise OAuthConfigurationError(f"{provider.title()} sign-in is not configured.")
    return config


def oauth_provider_status() -> dict[str, bool]:
    status: dict[str, bool] = {}
    for provider in (SocialIdentity.Provider.GOOGLE, SocialIdentity.Provider.APPLE):
        try:
            provider_config(provider)
        except OAuthConfigurationError:
            status[str(provider)] = False
        else:
            status[str(provider)] = True
    return status


def _flow_digest(value: str) -> str:
    return salted_hmac(
        "lockin.accounts.oauth-flow",
        value,
        secret=settings.SECRET_KEY,
        algorithm="sha256",
    ).hexdigest()


def new_oauth_browser_binding() -> str:
    return secrets.token_urlsafe(32)


def oauth_browser_cookie_name() -> str:
    return "__Host-lockin_oauth_browser" if not settings.DEBUG else "lockin_oauth_browser"


@transaction.atomic
def begin_oauth_flow(
    *,
    provider: str,
    intent: str,
    preferred_language: str,
    remember_me: bool,
    policy_accepted: bool,
    browser_binding: str,
) -> str:
    config = provider_config(provider)
    state_secret = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    lifetime = int(getattr(settings, "OAUTH_FLOW_TTL_SECONDS", 600))
    flow = OAuthFlow.objects.create(
        provider=provider,
        intent=intent,
        state_digest=_flow_digest(state_secret),
        nonce_digest=_flow_digest(nonce),
        browser_binding_digest=_flow_digest(browser_binding),
        preferred_language=preferred_language,
        remember_me=remember_me,
        policy_accepted=policy_accepted,
        policy_version=settings.ACCOUNT_POLICY_VERSION if policy_accepted else "",
        expires_at=timezone.now() + timedelta(seconds=lifetime),
    )
    state = signing.dumps(
        {"flow_id": str(flow.id), "state_secret": state_secret, "nonce": nonce},
        salt=_STATE_SALT,
        compress=True,
    )
    if provider == SocialIdentity.Provider.GOOGLE:
        query = urlencode(
            {
                "client_id": config.client_id,
                "redirect_uri": config.redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "nonce": nonce,
                "prompt": "select_account",
            }
        )
        return f"{GOOGLE_AUTHORIZATION_ENDPOINT}?{query}"
    query = urlencode(
        {
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "response_type": "code",
            "response_mode": "form_post",
            "scope": "name email",
            "state": state,
            "nonce": nonce,
        }
    )
    return f"{APPLE_AUTHORIZATION_ENDPOINT}?{query}"


@transaction.atomic
def consume_oauth_flow(
    *, provider: str, state: str, browser_binding: str
) -> tuple[OAuthFlow, str]:
    try:
        payload = signing.loads(
            state,
            salt=_STATE_SALT,
            max_age=int(getattr(settings, "OAUTH_FLOW_TTL_SECONDS", 600)),
        )
        flow_id = payload["flow_id"]
        state_secret = payload["state_secret"]
        nonce = payload["nonce"]
        if not all(isinstance(value, str) and value for value in (flow_id, state_secret, nonce)):
            raise OAuthFlowError("The sign-in request is invalid or expired.")
        flow = OAuthFlow.objects.select_for_update().get(id=flow_id, provider=provider)
    except (KeyError, TypeError, signing.BadSignature, OAuthFlow.DoesNotExist) as error:
        raise OAuthFlowError("The sign-in request is invalid or expired.") from error
    if not flow.is_usable:
        raise OAuthFlowError("The sign-in request is invalid or expired.")
    if not secrets.compare_digest(flow.state_digest, _flow_digest(state_secret)):
        raise OAuthFlowError("The sign-in request is invalid or expired.")
    if not secrets.compare_digest(flow.nonce_digest, _flow_digest(nonce)):
        raise OAuthFlowError("The sign-in request is invalid or expired.")
    if not browser_binding or not secrets.compare_digest(
        flow.browser_binding_digest,
        _flow_digest(browser_binding),
    ):
        raise OAuthFlowError("The sign-in request is invalid or expired.")
    flow.used_at = timezone.now()
    flow.save(update_fields=("used_at",))
    return flow, nonce


def _post_form_json(url: str, body: dict[str, str]) -> dict[str, Any]:
    if url not in {GOOGLE_TOKEN_ENDPOINT, APPLE_TOKEN_ENDPOINT}:
        raise OAuthProviderError("The identity-provider endpoint is not permitted.")
    request = Request(  # noqa: S310 - URL is restricted to the allowlist above.
        url,
        data=urlencode(body).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urlopen(  # noqa: S310 - Request URL was restricted to the allowlist above.
            request,
            timeout=int(getattr(settings, "OAUTH_HTTP_TIMEOUT_SECONDS", 10)),
        ) as response:
            raw = response.read(_MAX_PROVIDER_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise OAuthProviderError("The identity provider could not complete sign-in.") from error
    if len(raw) > _MAX_PROVIDER_RESPONSE_BYTES:
        raise OAuthProviderError("The identity provider returned an invalid response.")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OAuthProviderError("The identity provider returned an invalid response.") from error
    if not isinstance(payload, dict):
        raise OAuthProviderError("The identity provider returned an invalid response.")
    return payload


def _apple_client_secret(config: ProviderConfig) -> str:
    private_key = config.client_secret
    if "\\n" in private_key and "\n" not in private_key:
        private_key = private_key.replace("\\n", "\n")
    now = timezone.now()
    try:
        return jwt.encode(
            {
                "iss": _configured_value("APPLE_OAUTH_TEAM_ID"),
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(minutes=5)).timestamp()),
                "aud": "https://appleid.apple.com",
                "sub": config.client_id,
            },
            private_key,
            algorithm="ES256",
            headers={"kid": _configured_value("APPLE_OAUTH_KEY_ID")},
        )
    except (ValueError, TypeError, jwt.PyJWTError) as error:
        raise OAuthConfigurationError("Apple sign-in credentials are invalid.") from error


def _token_payload(*, provider: str, code: str) -> dict[str, Any]:
    config = provider_config(provider)
    body = {
        "client_id": config.client_id,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": config.redirect_uri,
    }
    if provider == SocialIdentity.Provider.GOOGLE:
        body["client_secret"] = config.client_secret
        endpoint = GOOGLE_TOKEN_ENDPOINT
    else:
        body["client_secret"] = _apple_client_secret(config)
        endpoint = APPLE_TOKEN_ENDPOINT
    payload = _post_form_json(endpoint, body)
    if payload.get("error") or not isinstance(payload.get("id_token"), str):
        raise OAuthProviderError("The identity provider could not complete sign-in.")
    return payload


def _verified_claims(*, provider: str, id_token: str, nonce: str) -> dict[str, Any]:
    config = provider_config(provider)
    jwks_url = (
        GOOGLE_JWKS_ENDPOINT
        if provider == SocialIdentity.Provider.GOOGLE
        else APPLE_JWKS_ENDPOINT
    )
    issuer: str | list[str] = (
        ["https://accounts.google.com", "accounts.google.com"]
        if provider == SocialIdentity.Provider.GOOGLE
        else "https://appleid.apple.com"
    )
    try:
        signing_key = jwt.PyJWKClient(
            jwks_url,
            timeout=int(getattr(settings, "OAUTH_HTTP_TIMEOUT_SECONDS", 10)),
        ).get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.client_id,
            issuer=issuer,
            leeway=30,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]},
        )
    except (jwt.PyJWTError, ValueError, TypeError) as error:
        raise OAuthProviderError(
            "The identity provider returned an invalid identity token."
        ) from error
    if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise OAuthProviderError("The identity provider returned an invalid identity token.")
    return claims


def _truthy_claim(value: object) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true")


def _apple_name(user_payload: str) -> str:
    if not user_payload or len(user_payload) > 10_000:
        return ""
    try:
        payload = json.loads(user_payload)
    except json.JSONDecodeError:
        return ""
    if not isinstance(payload, dict) or not isinstance(payload.get("name"), dict):
        return ""
    name = payload["name"]
    parts = [name.get("firstName"), name.get("lastName")]
    return " ".join(part.strip() for part in parts if isinstance(part, str) and part.strip())[:150]


def exchange_oauth_code(
    *, provider: str, code: str, nonce: str, apple_user_payload: str = ""
) -> ProviderProfile:
    token_payload = _token_payload(provider=provider, code=code)
    claims = _verified_claims(
        provider=provider,
        id_token=str(token_payload["id_token"]),
        nonce=nonce,
    )
    subject = str(claims.get("sub", "")).strip()
    email = str(claims.get("email", "")).strip()
    email_verified = _truthy_claim(claims.get("email_verified"))
    full_name = (
        str(claims.get("name", "")).strip()[:150]
        if provider == SocialIdentity.Provider.GOOGLE
        else _apple_name(apple_user_payload)
    )
    if not subject:
        raise OAuthProviderError("The identity provider returned an invalid identity token.")
    if email:
        try:
            validate_email(email)
        except ValidationError as error:
            raise OAuthProviderError("The identity provider returned an invalid email.") from error
        email = normalize_email(email)
    domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    return ProviderProfile(
        provider=provider,
        subject=subject,
        email=email,
        email_verified=email_verified,
        full_name=full_name,
        is_private_relay=(
            _truthy_claim(claims.get("is_private_email"))
            or domain in APPLE_PRIVATE_RELAY_DOMAINS
        ),
    )


def _registration_enabled() -> bool:
    return bool(get_configuration_value("registration.enabled"))


@transaction.atomic
def resolve_social_user(*, profile: ProviderProfile, flow: OAuthFlow) -> User:
    identity = (
        SocialIdentity.objects.select_for_update()
        .select_related("user")
        .filter(provider=profile.provider, subject=profile.subject)
        .first()
    )
    if identity is not None:
        user = identity.user
        if user.status != User.Status.ACTIVE or not user.is_active:
            raise OAuthAccountLinkError("This account cannot sign in.")
        identity.provider_email = profile.email
        identity.email_verified = profile.email_verified
        identity.is_private_relay = profile.is_private_relay
        identity.last_used_at = timezone.now()
        identity.save(
            update_fields=(
                "provider_email",
                "email_verified",
                "is_private_relay",
                "last_used_at",
            )
        )
        return user

    if not profile.email or not profile.email_verified:
        raise OAuthAccountLinkError(
            "A verified email is required before this social account can be linked."
        )
    matched_user = User.objects.select_for_update().filter(email=profile.email).first()
    created = False
    if matched_user is not None:
        user = matched_user
        if not user.is_email_verified:
            raise OAuthAccountLinkError(
                "Verify the existing Lock-in account before using social sign-in."
            )
        if user.status != User.Status.ACTIVE or not user.is_active:
            raise OAuthAccountLinkError("This account cannot sign in.")
        if SocialIdentity.objects.filter(user=user, provider=profile.provider).exists():
            raise OAuthAccountLinkError(
                "A different account from this provider is already linked."
            )
    else:
        if not _registration_enabled():
            raise OAuthRegistrationUnavailable("New registrations are temporarily unavailable.")
        if not flow.policy_accepted:
            raise OAuthRegistrationUnavailable(
                "Accept the current platform policies before creating an account."
            )
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    email=profile.email,
                    full_name=profile.full_name,
                    password=None,
                    preferred_language=flow.preferred_language,
                    email_verified_at=timezone.now(),
                    policy_accepted_at=timezone.now(),
                    policy_version=flow.policy_version,
                    profile_completion_required=True,
                )
        except IntegrityError as error:
            raise OAuthAccountLinkError(
                "This email was registered while social sign-in was completing; try again."
            ) from error
        created = True
        AccountSecurityEvent.objects.create(
            user=user,
            actor=user,
            event_type=AccountSecurityEvent.EventType.REGISTERED,
            metadata={
                "policy_version": flow.policy_version,
                "provider": profile.provider,
            },
        )
    try:
        SocialIdentity.objects.create(
            user=user,
            provider=profile.provider,
            subject=profile.subject,
            provider_email=profile.email,
            email_verified=profile.email_verified,
            is_private_relay=profile.is_private_relay,
        )
    except IntegrityError as error:
        raise OAuthAccountLinkError("This social account could not be linked safely.") from error
    AccountSecurityEvent.objects.create(
        user=user,
        actor=user,
        event_type=AccountSecurityEvent.EventType.SOCIAL_IDENTITY_LINKED,
        metadata={"provider": profile.provider},
    )
    if created:
        publish_after_commit(UserRegistered(user_id=user.id, actor_id=user.id))
        publish_after_commit(UserEmailVerified(user_id=user.id, actor_id=user.id))
    return user


def complete_oauth_callback(
    *,
    request: HttpRequest,
    provider: str,
    state: str,
    code: str,
    apple_user_payload: str = "",
) -> User:
    flow, nonce = consume_oauth_flow(
        provider=provider,
        state=state,
        browser_binding=request.COOKIES.get(oauth_browser_cookie_name(), ""),
    )
    profile = exchange_oauth_code(
        provider=provider,
        code=code,
        nonce=nonce,
        apple_user_payload=apple_user_payload,
    )
    user = resolve_social_user(profile=profile, flow=flow)
    establish_account_session(
        request=request,
        user=user,
        remember_me=flow.remember_me,
        event_type=AccountSecurityEvent.EventType.SOCIAL_LOGIN_SUCCEEDED,
        metadata={"provider": provider},
    )
    return user


def oauth_frontend_redirect(*, provider: str, outcome: str, error: str = "") -> str:
    allowed_outcomes = {"success", "cancelled", "error"}
    allowed_errors = {
        "",
        "account_link_required",
        "configuration",
        "flow_invalid",
        "provider_error",
        "registration_unavailable",
    }
    safe_outcome = outcome if outcome in allowed_outcomes else "error"
    safe_error = error if error in allowed_errors else "provider_error"
    base = urlsplit(str(settings.PUBLIC_APP_URL))
    query = urlencode(
        {
            "oauth": safe_outcome,
            "provider": provider,
            **({"oauth_error": safe_error} if safe_error else {}),
        }
    )
    return urlunsplit((base.scheme, base.netloc, base.path or "/", query, ""))
