import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import logout
from django.contrib.sessions.models import Session
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.http import HttpRequest
from django.utils import timezone
from django.utils.crypto import salted_hmac

from platform_core.events import publish_after_commit

from .events import UserEmailVerified, UserRegistered, UserStatusChanged
from .models import (
    AccountSecurityEvent,
    AccountSession,
    AuthAttempt,
    OneTimeToken,
    User,
)


class AccountTokenError(ValueError):
    pass


class AccountStateError(ValueError):
    pass


@transaction.atomic
def set_account_status(*, target: User, actor: User, status: str, reason: str) -> User:
    from .roles import Role, user_has_role

    if status not in {User.Status.ACTIVE, User.Status.SUSPENDED}:
        raise AccountStateError(
            "Only active and suspended account states are operationally managed."
        )
    reason = reason.strip()
    if len(reason) < 8:
        raise AccountStateError("A reason of at least 8 characters is required.")
    target = User.objects.select_for_update().get(id=target.id)
    if target.status == User.Status.DELETED:
        raise AccountStateError("Deleted accounts cannot be reactivated operationally.")
    if target.status == status:
        return target
    if status == User.Status.SUSPENDED and user_has_role(target, Role.ADMINISTRATOR):
        other_admin_exists = (
            User.objects.filter(status=User.Status.ACTIVE, groups__name=Role.ADMINISTRATOR.value)
            .exclude(id=target.id)
            .exists()
            or User.objects.filter(status=User.Status.ACTIVE, is_superuser=True)
            .exclude(id=target.id)
            .exists()
        )
        if not other_admin_exists:
            raise AccountStateError("The final active administrator cannot be suspended.")
    previous = target.status
    target.status = status
    target.save(update_fields=("status", "is_active", "updated_at"))
    if status == User.Status.SUSPENDED:
        session_keys = list(target.account_sessions.values_list("session_key", flat=True))
        Session.objects.filter(session_key__in=session_keys).delete()
        target.account_sessions.all().delete()
    AccountSecurityEvent.objects.create(
        user=target,
        actor=actor,
        event_type=AccountSecurityEvent.EventType.STATUS_CHANGED,
        metadata={"from_status": previous, "to_status": status, "reason": reason},
    )
    publish_after_commit(
        UserStatusChanged(
            user_id=target.id,
            from_status=previous,
            to_status=status,
            reason=reason,
            actor_id=actor.id,
        )
    )
    return target


@dataclass(frozen=True, slots=True)
class IssuedToken:
    raw_token: str
    expires_at: datetime


def normalize_email(email: str) -> str:
    return User.objects.normalize_email(email).strip().lower()


def _token_digest(raw_token: str) -> str:
    return salted_hmac(
        "lockin.accounts.one-time-token",
        raw_token,
        secret=settings.SECRET_KEY,
        algorithm="sha256",
    ).hexdigest()


def _new_token_value() -> str:
    return secrets.token_urlsafe(32)


@transaction.atomic
def issue_token(
    *,
    user: User,
    kind: str,
    lifetime: timedelta,
    payload: dict[str, str] | None = None,
) -> IssuedToken:
    now = timezone.now()
    OneTimeToken.objects.filter(user=user, kind=kind, used_at__isnull=True).update(used_at=now)
    raw_token = _new_token_value()
    expires_at = now + lifetime
    OneTimeToken.objects.create(
        user=user,
        kind=kind,
        token_digest=_token_digest(raw_token),
        payload=payload or {},
        expires_at=expires_at,
    )
    return IssuedToken(raw_token=raw_token, expires_at=expires_at)


def _get_usable_token(*, raw_token: str, kind: str) -> OneTimeToken:
    try:
        token = (
            OneTimeToken.objects.select_for_update()
            .select_related("user")
            .get(token_digest=_token_digest(raw_token), kind=kind)
        )
    except OneTimeToken.DoesNotExist as error:
        raise AccountTokenError("This link is invalid or has expired.") from error
    if not token.is_usable:
        raise AccountTokenError("This link is invalid or has expired.")
    return token


def _token_lifetime(setting_name: str, default_seconds: int) -> timedelta:
    return timedelta(seconds=int(getattr(settings, setting_name, default_seconds)))


@transaction.atomic
def register_user(
    *,
    email: str,
    full_name: str,
    password: str,
    preferred_language: str,
) -> tuple[User, IssuedToken]:
    now = timezone.now()
    user = User.objects.create_user(
        email=email,
        full_name=full_name,
        password=password,
        preferred_language=preferred_language,
        policy_accepted_at=now,
        policy_version=settings.ACCOUNT_POLICY_VERSION,
    )
    AccountSecurityEvent.objects.create(
        user=user,
        actor=user,
        event_type=AccountSecurityEvent.EventType.REGISTERED,
        metadata={"policy_version": settings.ACCOUNT_POLICY_VERSION},
    )
    token = issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=_token_lifetime("ACCOUNT_EMAIL_VERIFICATION_TTL_SECONDS", 86_400),
    )
    publish_after_commit(UserRegistered(user_id=user.id, actor_id=user.id))
    return user, token


@transaction.atomic
def verify_email(*, raw_token: str) -> User:
    token = _get_usable_token(raw_token=raw_token, kind=OneTimeToken.Kind.EMAIL_VERIFICATION)
    now = timezone.now()
    user = token.user
    user.email_verified_at = now
    user.save(update_fields=("email_verified_at", "updated_at"))
    token.used_at = now
    token.save(update_fields=("used_at",))
    AccountSecurityEvent.objects.create(
        user=user,
        actor=user,
        event_type=AccountSecurityEvent.EventType.EMAIL_VERIFIED,
    )
    publish_after_commit(UserEmailVerified(user_id=user.id, actor_id=user.id))
    return user


def resend_verification(*, user: User) -> IssuedToken:
    if user.is_email_verified:
        raise AccountStateError("This account is already verified.")
    return issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=_token_lifetime("ACCOUNT_EMAIL_VERIFICATION_TTL_SECONDS", 86_400),
    )


def request_password_reset(*, email: str) -> tuple[User, IssuedToken] | None:
    user = User.objects.filter(
        email=normalize_email(email), status=User.Status.ACTIVE, email_verified_at__isnull=False
    ).first()
    if user is None:
        return None
    token = issue_token(
        user=user,
        kind=OneTimeToken.Kind.PASSWORD_RESET,
        lifetime=_token_lifetime("ACCOUNT_PASSWORD_RESET_TTL_SECONDS", 3_600),
    )
    return user, token


@transaction.atomic
def confirm_password_reset(*, raw_token: str, new_password: str) -> User:
    token = _get_usable_token(raw_token=raw_token, kind=OneTimeToken.Kind.PASSWORD_RESET)
    now = timezone.now()
    user = token.user
    user.set_password(new_password)
    user.save(update_fields=("password", "updated_at"))
    token.used_at = now
    token.save(update_fields=("used_at",))
    OneTimeToken.objects.filter(user=user, used_at__isnull=True).update(used_at=now)
    invalidate_sessions(user=user)
    AccountSecurityEvent.objects.create(
        user=user,
        actor=user,
        event_type=AccountSecurityEvent.EventType.PASSWORD_RESET,
    )
    return user


def request_email_change(*, user: User, new_email: str) -> IssuedToken:
    normalized = normalize_email(new_email)
    if User.objects.filter(email=normalized).exclude(id=user.id).exists():
        raise AccountStateError("That email address is already in use.")
    return issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_CHANGE,
        lifetime=_token_lifetime("ACCOUNT_EMAIL_CHANGE_TTL_SECONDS", 3_600),
        payload={"new_email": normalized},
    )


@transaction.atomic
def confirm_email_change(*, raw_token: str) -> User:
    token = _get_usable_token(raw_token=raw_token, kind=OneTimeToken.Kind.EMAIL_CHANGE)
    new_email = token.payload.get("new_email")
    if not isinstance(new_email, str) or not new_email:
        raise AccountTokenError("This link is invalid or has expired.")
    user = token.user
    try:
        user.email = normalize_email(new_email)
        user.email_verified_at = timezone.now()
        user.full_clean(exclude={"password"})
        user.save(update_fields=("email", "email_verified_at", "updated_at"))
    except IntegrityError as error:
        raise AccountStateError("That email address is already in use.") from error
    token.used_at = timezone.now()
    token.save(update_fields=("used_at",))
    AccountSecurityEvent.objects.create(
        user=user,
        actor=user,
        event_type=AccountSecurityEvent.EventType.EMAIL_CHANGED,
    )
    return user


@transaction.atomic
def change_password(*, user: User, new_password: str, keep_session_key: str | None) -> None:
    user.set_password(new_password)
    user.save(update_fields=("password", "updated_at"))
    invalidate_sessions(user=user, keep_session_key=keep_session_key)
    OneTimeToken.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
    AccountSecurityEvent.objects.create(
        user=user,
        actor=user,
        event_type=AccountSecurityEvent.EventType.PASSWORD_CHANGED,
    )


def _coarse_device_label(user_agent: str) -> str:
    value = user_agent.lower()
    device = (
        "Mobile device"
        if any(part in value for part in ("mobile", "android", "iphone"))
        else "Computer"
    )
    if "ipad" in value:
        device = "Tablet"
    browser = "Browser"
    for marker, label in (
        ("edg/", "Edge"),
        ("firefox/", "Firefox"),
        ("chrome/", "Chrome"),
        ("safari/", "Safari"),
    ):
        if marker in value:
            browser = label
            break
    return f"{browser} on {device}"


def register_account_session(*, request: HttpRequest, user: User) -> AccountSession:
    if request.session.session_key is None:
        request.session.save()
    session_key = request.session.session_key
    if session_key is None:
        raise AccountStateError("The session could not be created.")
    expires_at = request.session.get_expiry_date()
    return AccountSession.objects.update_or_create(
        session_key=session_key,
        defaults={
            "user": user,
            "device_label": _coarse_device_label(request.headers.get("User-Agent", "")),
            "last_seen_at": timezone.now(),
            "expires_at": expires_at,
        },
    )[0]


def touch_account_session(*, request: HttpRequest, user: User) -> None:
    session_key = request.session.session_key
    if session_key is None:
        return
    AccountSession.objects.filter(session_key=session_key, user=user).update(
        last_seen_at=timezone.now(), expires_at=request.session.get_expiry_date()
    )


def invalidate_sessions(*, user: User, keep_session_key: str | None = None) -> int:
    sessions = AccountSession.objects.filter(user=user)
    if keep_session_key:
        sessions = sessions.exclude(session_key=keep_session_key)
    keys = list(sessions.values_list("session_key", flat=True))
    if keys:
        Session.objects.filter(session_key__in=keys).delete()
        sessions.delete()
    return len(keys)


def logout_current_session(*, request: HttpRequest, user: User) -> None:
    session_key = request.session.session_key
    if session_key:
        AccountSession.objects.filter(user=user, session_key=session_key).delete()
    AccountSecurityEvent.objects.create(
        user=user,
        actor=user,
        event_type=AccountSecurityEvent.EventType.LOGOUT,
    )
    logout(request)


def auth_attempt_fingerprint(*, scope: str, identifier: str, remote_address: str) -> str:
    value = f"{scope}|{identifier.strip().lower()}|{remote_address}|{settings.SECRET_KEY}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def auth_attempt_is_limited(*, key_hash: str, scope: str, window_seconds: int, limit: int) -> bool:
    since = timezone.now() - timedelta(seconds=window_seconds)
    return (
        AuthAttempt.objects.filter(scope=scope, key_hash=key_hash, attempted_at__gte=since).count()
        >= limit
    )


def record_auth_attempt(*, key_hash: str, scope: str) -> None:
    AuthAttempt.objects.create(key_hash=key_hash, scope=scope)


def clear_auth_attempts(*, key_hash: str, scope: str) -> None:
    AuthAttempt.objects.filter(key_hash=key_hash, scope=scope).delete()


def login_fingerprint(*, email: str, remote_address: str) -> str:
    return auth_attempt_fingerprint(
        scope="login", identifier=normalize_email(email), remote_address=remote_address
    )


def login_is_limited(*, key_hash: str) -> bool:
    return auth_attempt_is_limited(
        key_hash=key_hash,
        scope="login",
        window_seconds=int(getattr(settings, "ACCOUNT_LOGIN_WINDOW_SECONDS", 900)),
        limit=int(getattr(settings, "ACCOUNT_LOGIN_ATTEMPT_LIMIT", 5)),
    )


def record_login_failure(*, key_hash: str) -> None:
    record_auth_attempt(key_hash=key_hash, scope="login")


def clear_login_failures(*, key_hash: str) -> None:
    clear_auth_attempts(key_hash=key_hash, scope="login")


def build_account_link(*, path: str, raw_token: str) -> str:
    base_url = str(settings.PUBLIC_APP_URL).rstrip("/")
    return f"{base_url}{path}?{urlencode({'token': raw_token})}"


def send_account_email(*, recipient: str, subject: str, body: str) -> None:
    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient],
        fail_silently=False,
    )
