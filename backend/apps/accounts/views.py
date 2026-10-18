import logging
import smtplib
from collections.abc import Mapping
from datetime import timedelta
from typing import cast
from uuid import UUID

from django.conf import settings
from django.contrib.auth import authenticate, update_session_auth_hash
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import UploadedFile
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Q
from django.http import HttpRequest, HttpResponseRedirect
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
from rest_framework import status
from rest_framework.exceptions import APIException, AuthenticationFailed, NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.education.models import StudentCohort
from apps.education.serializers import StudentCohortSerializer
from apps.files.models import ManagedFile
from apps.files.services import FileValidationError, create_managed_file
from apps.system_configuration.services import get_configuration_value
from platform_core.network import client_ip

from .email_delivery import account_email_delivery_state, enqueue_account_email, failure_code
from .models import AccountDeletionRequest, AccountSession, OneTimeToken, SocialIdentity, User
from .oauth import (
    OAUTH_BROWSER_COOKIE_PATH,
    OAuthAccountLinkError,
    OAuthConfigurationError,
    OAuthFlowError,
    OAuthProviderError,
    OAuthRegistrationUnavailable,
    OAuthSignupRequired,
    begin_oauth_flow,
    complete_oauth_callback,
    consume_oauth_flow,
    new_oauth_browser_binding,
    oauth_browser_cookie_name,
    oauth_frontend_redirect,
    oauth_provider_status,
)
from .permissions import IsAdministrator
from .rate_limits import AttemptBudget, reserve_attempts
from .roles import Role, RoleChangeError, replace_managed_roles
from .selectors import dashboard_summary
from .serializers import (
    AccountDeletionPasswordSerializer,
    AccountSessionSerializer,
    EmailChangeRequestSerializer,
    EmailSerializer,
    LoginSerializer,
    OAuthStartSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    ProfileAvatarUploadSerializer,
    ProfileUpdateSerializer,
    RegistrationSerializer,
    RoleUpdateSerializer,
    TokenSerializer,
    UserSerializer,
    VerificationCodeSerializer,
    WelcomePreferencesSerializer,
)
from .services import (
    AccountStateError,
    AccountTokenError,
    _token_digest,
    account_deletion_status,
    auth_attempt_fingerprint,
    build_account_link,
    cancel_account_deletion,
    change_password,
    clear_login_failures,
    confirm_account_deletion,
    confirm_email_change,
    confirm_password_reset,
    establish_account_session,
    invalidate_sessions,
    login_fingerprint,
    logout_current_session,
    register_user,
    request_account_deletion,
    request_email_change,
    request_password_reset,
    resend_verification,
    send_account_email,
    touch_account_session,
    verification_code_failure_reason,
    verify_email_code,
)


class TooManyAccountRequests(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_detail = "Too many attempts. Try again later."
    default_code = "too_many_attempts"


class InvalidAccountToken(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This link is invalid or has expired."
    default_code = "invalid_or_expired_token"


class RequestRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "The request could not be completed."
    default_code = "request_rejected"


# A failed code or link names its reason only where AccountTokenError says it
# is safe to (see there); everything else keeps one answer per flow.
VERIFICATION_CODE_ERRORS = {
    "invalid": ("invalid_verification_code", "This verification code is incorrect."),
    "expired": ("verification_code_expired", "This verification code has expired."),
    "used": ("verification_code_replaced", "This code was replaced by a newer one."),
    "attempts_exceeded": (
        "verification_attempts_exceeded",
        "Too many incorrect attempts for this code.",
    ),
}
RESET_LINK_ERRORS = {
    "invalid": ("invalid_reset_token", "This reset link is invalid."),
    "expired": ("reset_link_expired", "This reset link has expired."),
    "used": ("reset_link_used", "This reset link has already been used."),
}
EMAIL_LINK_ERRORS = {
    "invalid": ("invalid_or_expired_token", "This link is invalid or has expired."),
    "expired": ("email_link_expired", "This link has expired."),
    "used": ("email_link_used", "This link has already been used."),
}


def _token_error(
    table: dict[str, tuple[str, str]], error: AccountTokenError
) -> "InvalidAccountToken":
    code, detail = table.get(getattr(error, "reason", "invalid"), table["invalid"])
    return InvalidAccountToken(detail=detail, code=code)


logger = logging.getLogger("lockin.email")


def _report_synchronous_email_failure(flow: str, error: BaseException) -> None:
    # The same privacy-safe shape the queue worker logs: no address, no link.
    logger.warning(
        "Account email failed",
        extra={"event": "account_email.failed", "flow": flow, "error_code": failure_code(error)},
    )


class EmailAlreadyVerified(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This email is already verified. Sign in to continue."
    default_code = "email_already_verified"


class EmailDeliveryUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The email could not be sent right now. Try again in a few minutes."
    default_code = "email_delivery_unavailable"


class RegistrationUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "New registrations are temporarily unavailable."
    default_code = "registration_unavailable"


class OAuthUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "This sign-in provider is not configured."
    default_code = "oauth_not_configured"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise AuthenticationFailed()
    return request.user


def _http_request(request: Request) -> HttpRequest:
    return request._request


def _enforce_sensitive_request_limit(*, request: Request, scope: str, identifier: str) -> None:
    remote_address = client_ip(request)
    key_hash = auth_attempt_fingerprint(
        scope=scope,
        identifier=identifier,
        remote_address=remote_address,
    )
    source_scope = f"{scope}_source"
    source_hash = auth_attempt_fingerprint(
        scope=source_scope,
        identifier="*",
        remote_address=remote_address,
    )
    window = int(settings.ACCOUNT_SENSITIVE_WINDOW_SECONDS)
    budgets = [
        AttemptBudget(scope, key_hash, window, int(settings.ACCOUNT_SENSITIVE_REQUEST_LIMIT)),
        AttemptBudget(
            source_scope, source_hash, window, int(settings.ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT)
        ),
    ]
    # A provider name is shared by every user; only account/token identifiers
    # receive a source-independent budget.
    if scope != "oauth_start":
        account_scope = f"{scope}_account"
        budgets.append(
            AttemptBudget(
                account_scope,
                auth_attempt_fingerprint(
                    scope=account_scope, identifier=identifier, remote_address="*"
                ),
                window,
                int(settings.ACCOUNT_SENSITIVE_REQUEST_LIMIT),
            )
        )
    if reserve_attempts(budgets) is None:
        raise TooManyAccountRequests()


def _send_verification_code_email(*, user: User, code: str) -> None:
    """Mail the six-digit code. Delivery is the existing durable queue, unchanged."""

    enqueue_account_email(
        user=user,
        token=OneTimeToken.objects.get(
            token_digest=_token_digest(code, scope=str(user.id)),
            kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        ),
        subject="Your Lock-in verification code",
        body=(
            f"Your Lock-in verification code is {code}\n\n"
            "Enter it in the app to finish creating your account. "
            "It expires in 10 minutes and can be used once.\n\n"
            "If you did not ask for this code, you can ignore this email."
        ),
    )


EXISTING_ACCOUNT_NOTICE_COOLDOWN = timedelta(minutes=15)


def _notify_existing_registration(*, email: str) -> None:
    """Answer a sign-up for an address that already has an account -- by email.

    The screen must look the same either way, so the truth goes to the
    mailbox: an account still waiting for its code is sent a fresh one (the
    resend cooldown still applies), and a verified account is sent a way back
    in instead of a code that would never come. Suspended accounts get
    nothing, exactly as a resend or a reset would.
    """

    try:
        user = User.objects.filter(email=email, status=User.Status.ACTIVE).first()
        if user is None:
            return
        if not user.is_email_verified:
            token = resend_verification(user=user)
            if token is not None:
                _send_verification_code_email(user=user, code=token.raw_token)
            return
        # A sign-up attempt must never cancel a reset link the owner is about
        # to use, and must not become a second way to fill their inbox: while
        # a recent or still-usable reset link exists, the mailbox already has
        # its way back in.
        now = timezone.now()
        if (
            OneTimeToken.objects.filter(user=user, kind=OneTimeToken.Kind.PASSWORD_RESET)
            .filter(
                Q(created_at__gte=now - EXISTING_ACCOUNT_NOTICE_COOLDOWN)
                | Q(used_at__isnull=True, expires_at__gt=now)
            )
            .exists()
        ):
            return
        result = request_password_reset(email=email)
        if result is not None:
            existing, reset = result
            link = build_account_link(path="/reset-password", raw_token=reset.raw_token)
            enqueue_account_email(
                user=existing,
                token=OneTimeToken.objects.get(token_digest=_token_digest(reset.raw_token)),
                subject="You already have a Lock-in account",
                body=(
                    "Someone, probably you, tried to create a Lock-in account with this email, "
                    "but it already has one.\n\n"
                    "Sign in with your password, or choose a new one with this single-use link:\n\n"
                    f"{link}\n\n"
                    "If this was not you, you can ignore this email."
                ),
            )
    except DatabaseError:
        # The reply is the same either way; the mailbox simply hears nothing.
        logger.exception("Could not notify an existing account about a sign-up")


def _send_password_reset_email(*, user: User, raw_token: str) -> None:
    link = build_account_link(path="/reset-password", raw_token=raw_token)
    enqueue_account_email(
        user=user,
        token=OneTimeToken.objects.get(token_digest=_token_digest(raw_token)),
        subject="Reset your Lock-in password",
        body=f"Reset your Lock-in password using this single-use link:\n\n{link}",
    )


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfTokenView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response({"csrf_token": get_token(_http_request(request))})


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        if not bool(get_configuration_value("registration.enabled")):
            raise RegistrationUnavailable()
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        _enforce_sensitive_request_limit(
            request=request, scope="registration", identifier=str(data["email"])
        )
        try:
            user, token = register_user(
                email=str(data["email"]),
                username=str(data["username"]) if data.get("username") else None,
                full_name=str(data["full_name"]),
                password=str(data["password"]),
                preferred_language=str(data["preferred_language"]),
                cohort=data["cohort"],
            )
        except (DjangoValidationError, IntegrityError) as error:
            if isinstance(error, DjangoValidationError) and "email" not in error.message_dict:
                raise
            if not User.objects.filter(email=str(data["email"])).exists():
                raise
            _notify_existing_registration(email=str(data["email"]))
        else:
            _send_verification_code_email(user=user, code=token.raw_token)
        return Response(
            {"status": "verification_required", "email_delivery": account_email_delivery_state()},
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = VerificationCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = str(serializer.validated_data["email"])
        # Two bounds, for two different abuses: this address (a guesser working
        # one account) and this source (a guesser working many). The per-code
        # attempt count in the token bounds the third -- guesses against one
        # issued code.
        _enforce_sensitive_request_limit(
            request=request,
            scope="email_verification",
            identifier=email,
        )
        code = str(serializer.validated_data["code"])
        user = User.objects.filter(email=email, email_verified_at__isnull=True).first()
        if user is None:
            # The code it was sent is the proof: only the person who received
            # it learns that the address is already verified.
            verified = User.objects.filter(email=email, email_verified_at__isnull=False).first()
            if verified is not None and verification_code_failure_reason(
                user=verified, code=code
            ) in {"used", "attempts_exceeded"}:
                raise EmailAlreadyVerified()
            raise _token_error(VERIFICATION_CODE_ERRORS, AccountTokenError("invalid"))
        try:
            user = verify_email_code(user=user, code=code)
        except AccountTokenError as error:
            raise _token_error(VERIFICATION_CODE_ERRORS, error) from error
        # Entering the code proves control of the mailbox, which is the same
        # evidence a sign-in asks for -- and it was single-use, unexpired and
        # checked on the server before reaching this line. So the reader
        # continues into the product rather than being sent to a login form for
        # an account they just proved is theirs. The session is the one every
        # other entry point creates, with a rotated key and a recorded event.
        # An account that may not sign in is verified without one.
        if user.status != User.Status.ACTIVE or not user.is_active:
            return Response({"status": "verified", "user": None})
        try:
            establish_account_session(
                request=_http_request(request),
                user=user,
                remember_me=False,
                metadata={"method": "email_verification"},
            )
        except AccountStateError:
            return Response({"status": "verified", "user": None})
        return Response({"status": "verified", "user": UserSerializer(user).data})


class ResendVerificationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _enforce_sensitive_request_limit(
            request=request,
            scope="verification_resend",
            identifier=str(serializer.validated_data["email"]),
        )
        user = User.objects.filter(
            email=serializer.validated_data["email"],
            status=User.Status.ACTIVE,
            email_verified_at__isnull=True,
        ).first()
        # The same minute the screen counts down is enforced here, so a held
        # button, a reload, or a direct call cannot turn one mailbox into a
        # flood. The answer stays the same either way: whether an address is
        # registered is not something this endpoint tells a stranger.
        if user is not None:
            token = resend_verification(user=user)
            if token is not None:
                _send_verification_code_email(user=user, code=token.raw_token)
        # A token's remaining lifetime reveals recent account activity. The
        # public countdown is identical for unknown, verified and known users.
        cooldown = int(getattr(settings, "ACCOUNT_VERIFICATION_RESEND_COOLDOWN_SECONDS", 60))
        return Response(
            {
                "status": "accepted",
                "retry_after_seconds": cooldown,
                "email_delivery": account_email_delivery_state(),
            }
        )


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _enforce_sensitive_request_limit(
            request=request,
            scope="password_reset_request",
            identifier=str(serializer.validated_data["email"]),
        )
        result = request_password_reset(email=str(serializer.validated_data["email"]))
        if result is not None:
            user, token = result
            _send_password_reset_email(user=user, raw_token=token.raw_token)
        return Response({"status": "accepted", "email_delivery": account_email_delivery_state()})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _enforce_sensitive_request_limit(
            request=request,
            scope="password_reset_confirm",
            identifier=str(serializer.validated_data["token"]),
        )
        try:
            confirm_password_reset(
                raw_token=str(serializer.validated_data["token"]),
                new_password=str(serializer.validated_data["new_password"]),
            )
        except AccountTokenError as error:
            raise _token_error(RESET_LINK_ERRORS, error) from error
        return Response({"status": "password_reset"})


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        email = str(data["email"])
        remote_address = client_ip(request)
        fingerprint = login_fingerprint(
            email=email,
            remote_address=remote_address,
        )
        source_scope = "login_source"
        source_fingerprint = auth_attempt_fingerprint(
            scope=source_scope,
            identifier="*",
            remote_address=remote_address,
        )
        account_scope = "login_account"
        account_fingerprint = auth_attempt_fingerprint(
            scope=account_scope,
            identifier=email,
            remote_address="*",
        )
        window = int(settings.ACCOUNT_LOGIN_WINDOW_SECONDS)
        attempts = reserve_attempts(
            [
                AttemptBudget(
                    "login", fingerprint, window, int(settings.ACCOUNT_LOGIN_ATTEMPT_LIMIT)
                ),
                AttemptBudget(
                    source_scope,
                    source_fingerprint,
                    window,
                    int(settings.ACCOUNT_LOGIN_SOURCE_ATTEMPT_LIMIT),
                ),
                AttemptBudget(
                    account_scope,
                    account_fingerprint,
                    window,
                    int(settings.ACCOUNT_LOGIN_ACCOUNT_ATTEMPT_LIMIT),
                ),
            ]
        )
        if attempts is None:
            raise TooManyAccountRequests()
        user = authenticate(_http_request(request), username=email, password=str(data["password"]))
        if not isinstance(user, User) or not user.is_email_verified:
            raise AuthenticationFailed(
                "The email or password is incorrect.", code="invalid_credentials"
            )
        try:
            establish_account_session(
                request=_http_request(request),
                user=user,
                remember_me=bool(data["remember_me"]),
            )
        except AccountStateError as error:
            raise AuthenticationFailed(
                "The email or password is incorrect.", code="invalid_credentials"
            ) from error
        clear_login_failures(key_hash=fingerprint)
        from .models import AuthAttempt

        AuthAttempt.objects.filter(pk__in=attempts).delete()
        return Response({"user": UserSerializer(user).data})


class CohortListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        # Third Year has no configured Catalog branch. Keep legacy records
        # intact for audit/history, but never offer an empty path at signup or
        # during a later study-path change.
        cohorts = (
            StudentCohort.objects.filter(is_active=True)
            .exclude(code="year-3")
            .select_related("program")
        )
        return Response({"cohorts": StudentCohortSerializer(cohorts, many=True).data})


class OAuthProviderStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response({"providers": oauth_provider_status()})


class OAuthStartView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request, provider: str) -> Response:
        if provider not in SocialIdentity.Provider.values:
            raise RequestRejected(
                "This sign-in provider is not supported.",
                code="unsupported_provider",
            )
        serializer = OAuthStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _enforce_sensitive_request_limit(
            request=request,
            scope="oauth_start",
            identifier=provider,
        )
        data = serializer.validated_data
        try:
            browser_binding = new_oauth_browser_binding()
            authorization_url = begin_oauth_flow(
                provider=provider,
                intent=str(data["intent"]),
                preferred_language=str(data["preferred_language"]),
                remember_me=bool(data["remember_me"]),
                policy_accepted=bool(data["accept_policies"]),
                browser_binding=browser_binding,
            )
        except OAuthConfigurationError as error:
            raise OAuthUnavailable() from error
        response = Response({"authorization_url": authorization_url})
        production_cookie = not settings.DEBUG
        response.set_cookie(
            oauth_browser_cookie_name(),
            browser_binding,
            max_age=int(settings.OAUTH_FLOW_TTL_SECONDS),
            httponly=True,
            secure=production_cookie,
            samesite="None" if production_cookie else "Lax",
            path=OAUTH_BROWSER_COOKIE_PATH,
        )
        return response


def _oauth_callback_redirect(
    *, request: HttpRequest, provider: str, payload: object
) -> HttpResponseRedirect:
    callback_scope = "oauth_callback_source"
    callback_fingerprint = auth_attempt_fingerprint(
        scope=callback_scope,
        identifier=provider,
        remote_address=client_ip(request),
    )
    if (
        reserve_attempts(
            [
                AttemptBudget(
                    callback_scope,
                    callback_fingerprint,
                    int(settings.ACCOUNT_SENSITIVE_WINDOW_SECONDS),
                    int(settings.ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT),
                )
            ]
        )
        is None
    ):
        return HttpResponseRedirect(
            oauth_frontend_redirect(provider=provider, outcome="error", error="rate_limited")
        )

    source = cast(Mapping[str, object], payload) if isinstance(payload, Mapping) else {}
    state_value = source.get("state", "")
    state = state_value if isinstance(state_value, str) else ""
    provider_error_value = source.get("error", "")
    provider_error = provider_error_value if isinstance(provider_error_value, str) else ""
    if not state:
        return HttpResponseRedirect(
            oauth_frontend_redirect(provider=provider, outcome="error", error="flow_invalid")
        )
    if provider_error:
        try:
            consume_oauth_flow(
                provider=provider,
                state=state,
                browser_binding=request.COOKIES.get(oauth_browser_cookie_name(), ""),
            )
        except OAuthFlowError:
            return HttpResponseRedirect(
                oauth_frontend_redirect(provider=provider, outcome="error", error="flow_invalid")
            )
        outcome = "cancelled" if provider_error == "access_denied" else "error"
        return HttpResponseRedirect(
            oauth_frontend_redirect(
                provider=provider,
                outcome=outcome,
                error="" if outcome == "cancelled" else "provider_error",
            )
        )
    code_value = source.get("code", "")
    code = code_value if isinstance(code_value, str) else ""
    if not code:
        return HttpResponseRedirect(
            oauth_frontend_redirect(provider=provider, outcome="error", error="provider_error")
        )
    apple_user_value = source.get("user", "")
    apple_user_payload = apple_user_value if isinstance(apple_user_value, str) else ""
    try:
        complete_oauth_callback(
            request=request,
            provider=provider,
            state=state,
            code=code,
            apple_user_payload=apple_user_payload,
        )
    except OAuthFlowError:
        error_code = "flow_invalid"
    except OAuthConfigurationError:
        error_code = "configuration"
    except OAuthAccountLinkError:
        error_code = "account_link_required"
    except OAuthSignupRequired:
        error_code = "signup_required"
    except OAuthRegistrationUnavailable:
        error_code = "registration_unavailable"
    except OAuthProviderError:
        error_code = "provider_error"
    else:
        return HttpResponseRedirect(oauth_frontend_redirect(provider=provider, outcome="success"))
    return HttpResponseRedirect(
        oauth_frontend_redirect(provider=provider, outcome="error", error=error_code)
    )


@require_GET
def google_oauth_callback(request: HttpRequest) -> HttpResponseRedirect:
    return _oauth_callback_redirect(
        request=request,
        provider=SocialIdentity.Provider.GOOGLE,
        payload=request.GET,
    )


@csrf_exempt
@require_POST
def apple_oauth_callback(request: HttpRequest) -> HttpResponseRedirect:
    """Apple uses form_post; signed one-time state and OIDC nonce protect this endpoint."""

    return _oauth_callback_redirect(
        request=request,
        provider=SocialIdentity.Provider.APPLE,
        payload=request.POST,
    )


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        logout_current_session(request=_http_request(request), user=_user(request))
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogoutAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = _user(request)
        invalidate_sessions(user=user)
        logout_current_session(request=_http_request(request), user=user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentSessionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        user = _user(request)
        touch_account_session(request=_http_request(request), user=user)
        return Response({"user": UserSerializer(user).data})


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response({"user": UserSerializer(_user(request)).data})

    def patch(self, request: Request) -> Response:
        user = _user(request)
        serializer = ProfileUpdateSerializer(
            data=request.data, partial=True, context={"user": user}
        )
        serializer.is_valid(raise_exception=True)
        previous_image = (
            user.profile_image if "avatar_default" in serializer.validated_data else None
        )
        previous_username = user.username or ""
        with transaction.atomic():
            next_cohort = serializer.validated_data.pop("cohort", None)
            if next_cohort is not None and next_cohort.id != user.cohort_id:
                from apps.education.cohort_transition import change_student_cohort

                try:
                    change_student_cohort(user=user, cohort=next_cohort)
                except Exception as error:
                    # The outer transaction rolls back both cleanup and the
                    # cohort assignment. Do not leave a student half-switched
                    # or leak an internal cleanup detail to the browser.
                    raise RequestRejected(
                        "Study path could not be changed. "
                        "Your current path and study data were kept.",
                        code="cohort_change_failed",
                    ) from error
            for field, value in serializer.validated_data.items():
                setattr(user, field, value)
            if previous_image is not None:
                user.profile_image = None
            # An account created through a provider arrives with no display
            # name, because the provider's name is not this profile's identity.
            # The username the reader chooses is the identity they picked, so it
            # is what the product shows -- and it keeps following a later
            # rename, right up until the reader edits the display name into
            # something of their own, which is then left alone.
            if "username" in serializer.validated_data and user.full_name.strip() in (
                "",
                previous_username,
            ):
                user.full_name = user.username or ""
            if user.profile_completion_required and user.full_name.strip() and user.cohort_id:
                user.profile_completion_required = False
            try:
                user.full_clean(exclude={"password"})
                user.save()
            except IntegrityError as error:
                raise ValidationError({"username": ["That username is unavailable."]}) from error
            _delete_replaced_avatar_after_commit(previous_image)
        return Response({"user": UserSerializer(user).data})


def _delete_replaced_avatar_after_commit(managed_file: ManagedFile | None) -> None:
    if managed_file is None or managed_file.kind != ManagedFile.Kind.AVATAR:
        return
    storage = managed_file.blob.storage
    name = managed_file.blob.name

    def delete() -> None:
        if name:
            storage.delete(name)
        managed_file.delete()

    transaction.on_commit(delete)


class ProfileAvatarView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request: Request) -> Response:
        serializer = ProfileAvatarUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        if not isinstance(upload, UploadedFile):
            raise ValidationError({"file": ["A valid image upload is required."]})
        user = _user(request)
        with transaction.atomic():
            try:
                profile_image = create_managed_file(
                    owner=user, upload=upload, kind=ManagedFile.Kind.AVATAR
                )
            except FileValidationError as error:
                raise ValidationError({"file": [str(error)]}) from error
            previous_image = user.profile_image
            user.profile_image = profile_image
            user.save(update_fields=("profile_image", "updated_at"))
            _delete_replaced_avatar_after_commit(previous_image)
        return Response({"user": UserSerializer(user).data}, status=status.HTTP_201_CREATED)


class WelcomeCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = _user(request)
        if not user.username or user.profile_completion_required:
            raise RequestRejected("Complete the required profile steps first.")
        serializer = WelcomePreferencesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(user, field, value)
        if user.welcome_completed_at is None:
            user.welcome_completed_at = timezone.now()
        user.full_clean(exclude={"password"})
        user.save()
        return Response({"user": UserSerializer(user).data})


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = _user(request)
        _enforce_sensitive_request_limit(
            request=request, scope="password_change", identifier=str(user.id)
        )
        serializer = PasswordChangeSerializer(data=request.data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        old_session_key = request.session.session_key
        try:
            # Keep the account lock until the rotated session is persisted and
            # tracked. Logout-all must see either the old key or the new key.
            with transaction.atomic():
                change_password(
                    user=user,
                    new_password=str(serializer.validated_data["new_password"]),
                    keep_session_key=old_session_key,
                )
                update_session_auth_hash(_http_request(request), user)
                new_session_key = request.session.session_key
                if old_session_key and new_session_key:
                    AccountSession.objects.filter(user=user, session_key=old_session_key).update(
                        session_key=new_session_key,
                        expires_at=request.session.get_expiry_date(),
                        last_seen_at=timezone.now(),
                    )
        except AccountStateError as error:
            raise RequestRejected(str(error), code="account_changed") from error
        return Response({"status": "password_changed"})


class EmailChangeRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = _user(request)
        _enforce_sensitive_request_limit(
            request=request, scope="email_change_request", identifier=str(user.id)
        )
        serializer = EmailChangeRequestSerializer(data=request.data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        try:
            token = request_email_change(
                user=user, new_email=str(serializer.validated_data["new_email"])
            )
        except AccountStateError as error:
            raise RequestRejected(str(error), code="email_unavailable") from error
        # SMTP runs after the token has committed, never inside the
        # transaction: a slow mail server must not hold the account's row lock
        # (other requests give up after 3s) or outlive the idle-transaction
        # limit and roll back a link that was already mailed. A send that
        # fails revokes the link it would have carried instead.
        link = build_account_link(path="/confirm-email", raw_token=token.raw_token)
        try:
            send_account_email(
                recipient=str(serializer.validated_data["new_email"]),
                subject="Confirm your new Lock-in email",
                body=f"Confirm your new email using this single-use link:\n\n{link}",
            )
        # SMTP refusals and socket timeouts only: a database failure is not an
        # email problem and keeps its own answer.
        except (smtplib.SMTPException, OSError) as error:
            OneTimeToken.objects.filter(
                token_digest=_token_digest(token.raw_token), used_at__isnull=True
            ).update(used_at=timezone.now())
            _report_synchronous_email_failure("email_change", error)
            raise EmailDeliveryUnavailable() from error
        return Response({"status": "confirmation_required"})


class EmailChangeConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _enforce_sensitive_request_limit(
            request=request,
            scope="email_change_confirm",
            identifier=str(serializer.validated_data["token"]),
        )
        try:
            confirm_email_change(raw_token=str(serializer.validated_data["token"]))
        except AccountTokenError as error:
            raise _token_error(EMAIL_LINK_ERRORS, error) from error
        except AccountStateError as error:
            raise RequestRejected(str(error), code="email_unavailable") from error
        return Response({"status": "email_changed"})


def _deletion_request_payload(
    deletion_request: AccountDeletionRequest | None,
) -> dict[str, object]:
    if deletion_request is None:
        return {"status": "not_requested", "request": None}
    return {
        "status": deletion_request.status,
        "request": {
            "id": deletion_request.id,
            "status": deletion_request.status,
            "requested_at": deletion_request.requested_at,
            "confirmed_at": deletion_request.confirmed_at,
            "processing_started_at": deletion_request.processing_started_at,
            "completed_at": deletion_request.completed_at,
            "cancelled_at": deletion_request.cancelled_at,
            "policy_version": deletion_request.policy_version,
            "processing_note": deletion_request.processing_note,
            "target_response_at": deletion_request.requested_at + timedelta(days=30),
        },
    }


class AccountDeletionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(_deletion_request_payload(account_deletion_status(user=_user(request))))

    def post(self, request: Request) -> Response:
        user = _user(request)
        _enforce_sensitive_request_limit(
            request=request, scope="account_deletion_request", identifier=str(user.id)
        )
        serializer = AccountDeletionPasswordSerializer(data=request.data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        try:
            deletion_request, token = request_account_deletion(user=user)
        except AccountStateError as error:
            raise RequestRejected(str(error), code="deletion_request_rejected") from error
        # Sent after commit for the same reasons as an email change. A request
        # whose confirmation could not be mailed is withdrawn, so it is never
        # left waiting for a link that will not arrive.
        link = build_account_link(path="/settings", raw_token=token.raw_token)
        try:
            send_account_email(
                recipient=user.email,
                subject="Confirm your Lock-in account deletion request",
                body=(
                    "Confirm your account deletion request using this single-use link:\n\n"
                    f"{link}\n\n"
                    "The request will not be processed until you confirm it."
                ),
            )
        except (smtplib.SMTPException, OSError) as error:
            now = timezone.now()
            AccountDeletionRequest.objects.filter(
                id=deletion_request.id,
                status=AccountDeletionRequest.Status.PENDING_CONFIRMATION,
            ).update(status=AccountDeletionRequest.Status.CANCELLED, cancelled_at=now)
            OneTimeToken.objects.filter(
                id=deletion_request.confirmation_token_id, used_at__isnull=True
            ).update(used_at=now)
            _report_synchronous_email_failure("account_deletion", error)
            raise EmailDeliveryUnavailable() from error
        return Response(_deletion_request_payload(deletion_request), status=status.HTTP_201_CREATED)

    def delete(self, request: Request) -> Response:
        user = _user(request)
        _enforce_sensitive_request_limit(
            request=request, scope="account_deletion_cancel", identifier=str(user.id)
        )
        serializer = AccountDeletionPasswordSerializer(data=request.data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        try:
            deletion_request = cancel_account_deletion(user=user)
        except AccountStateError as error:
            raise RequestRejected(str(error), code="deletion_cancel_rejected") from error
        return Response(_deletion_request_payload(deletion_request))


class AccountDeletionConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _enforce_sensitive_request_limit(
            request=request,
            scope="account_deletion_confirm",
            identifier=str(serializer.validated_data["token"]),
        )
        try:
            deletion_request = confirm_account_deletion(
                raw_token=str(serializer.validated_data["token"])
            )
        except AccountTokenError as error:
            raise InvalidAccountToken() from error
        return Response(_deletion_request_payload(deletion_request))


class SessionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        user = _user(request)
        sessions = AccountSession.objects.filter(user=user, expires_at__gt=timezone.now())
        serializer = AccountSessionSerializer(
            sessions,
            many=True,
            context={"current_session_key": request.session.session_key},
        )
        return Response({"sessions": serializer.data})


class SessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def delete(self, request: Request, session_id: UUID) -> Response:
        user = _user(request)
        User.objects.select_for_update().only("id").get(id=user.id)
        try:
            account_session = AccountSession.objects.get(id=session_id, user=user)
        except AccountSession.DoesNotExist as error:
            raise NotFound("Session not found.") from error
        if account_session.session_key == request.session.session_key:
            logout_current_session(request=_http_request(request), user=user)
        else:
            Session.objects.filter(session_key=account_session.session_key).delete()
            account_session.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(dashboard_summary(user=_user(request)))


class AdminUserListView(ListAPIView[User]):
    permission_classes = [IsAdministrator]
    serializer_class = UserSerializer
    queryset = User.objects.prefetch_related("groups").all()


class AdminUserRolesView(APIView):
    permission_classes = [IsAdministrator]

    def patch(self, request: Request, user_id: UUID) -> Response:
        try:
            target = User.objects.get(id=user_id)
        except User.DoesNotExist as error:
            raise NotFound("User not found.") from error
        serializer = RoleUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            roles = replace_managed_roles(
                target=target,
                actor=_user(request),
                roles=cast(set[Role], serializer.validated_data["roles"]),
            )
        except RoleChangeError as error:
            raise RequestRejected(str(error), code="role_change_rejected") from error
        return Response({"roles": roles})
