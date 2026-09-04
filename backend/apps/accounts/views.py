from collections.abc import Mapping
from typing import cast
from uuid import UUID

from django.conf import settings
from django.contrib.auth import authenticate, update_session_auth_hash
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, transaction
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

from .models import AccountDeletionRequest, AccountSession, SocialIdentity, User
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
)
from .services import (
    AccountStateError,
    AccountTokenError,
    account_deletion_status,
    auth_attempt_fingerprint,
    auth_attempt_is_limited,
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
    login_is_limited,
    logout_current_session,
    record_auth_attempt,
    record_login_failure,
    register_user,
    request_account_deletion,
    request_email_change,
    request_password_reset,
    resend_verification,
    send_account_email,
    touch_account_session,
    verify_email,
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
    if auth_attempt_is_limited(
        key_hash=key_hash,
        scope=scope,
        window_seconds=int(settings.ACCOUNT_SENSITIVE_WINDOW_SECONDS),
        limit=int(settings.ACCOUNT_SENSITIVE_REQUEST_LIMIT),
    ) or auth_attempt_is_limited(
        key_hash=source_hash,
        scope=source_scope,
        window_seconds=int(settings.ACCOUNT_SENSITIVE_WINDOW_SECONDS),
        limit=int(settings.ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT),
    ):
        raise TooManyAccountRequests()
    record_auth_attempt(key_hash=key_hash, scope=scope)
    record_auth_attempt(key_hash=source_hash, scope=source_scope)


def _send_verification_email(*, user: User, raw_token: str) -> None:
    link = build_account_link(path="/verify-email", raw_token=raw_token)
    send_account_email(
        recipient=user.email,
        subject="Verify your Lock-in account",
        body=f"Verify your Lock-in account using this single-use link:\n\n{link}",
    )


def _send_password_reset_email(*, user: User, raw_token: str) -> None:
    link = build_account_link(path="/reset-password", raw_token=raw_token)
    send_account_email(
        recipient=user.email,
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
        else:
            _send_verification_email(user=user, raw_token=token.raw_token)
        return Response({"status": "verification_required"}, status=status.HTTP_201_CREATED)


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _enforce_sensitive_request_limit(
            request=request,
            scope="email_verification",
            identifier=str(serializer.validated_data["token"]),
        )
        try:
            user = verify_email(raw_token=str(serializer.validated_data["token"]))
        except AccountTokenError as error:
            raise InvalidAccountToken() from error
        # Spending the link proves control of the mailbox, which is the same
        # evidence a sign-in asks for -- and the token was single-use, unexpired
        # and checked on the server before reaching this line. So the reader
        # continues into the product rather than being sent to a login form for
        # an account they just proved is theirs. The session is the one every
        # other entry point creates, with a rotated key and a recorded event.
        # An account that may not sign in is verified without one.
        if user.status != User.Status.ACTIVE or not user.is_active:
            return Response({"status": "verified", "user": None})
        establish_account_session(
            request=_http_request(request),
            user=user,
            remember_me=False,
            metadata={"method": "email_verification"},
        )
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
        if user is not None:
            token = resend_verification(user=user)
            _send_verification_email(user=user, raw_token=token.raw_token)
        return Response({"status": "accepted"})


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
        return Response({"status": "accepted"})


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
            raise InvalidAccountToken() from error
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
        if login_is_limited(key_hash=fingerprint) or auth_attempt_is_limited(
            key_hash=source_fingerprint,
            scope=source_scope,
            window_seconds=int(settings.ACCOUNT_LOGIN_WINDOW_SECONDS),
            limit=int(settings.ACCOUNT_LOGIN_SOURCE_ATTEMPT_LIMIT),
        ):
            raise TooManyAccountRequests()
        user = authenticate(_http_request(request), username=email, password=str(data["password"]))
        if not isinstance(user, User) or not user.is_email_verified:
            record_login_failure(key_hash=fingerprint)
            record_auth_attempt(key_hash=source_fingerprint, scope=source_scope)
            raise AuthenticationFailed(
                "The email or password is incorrect.", code="invalid_credentials"
            )
        clear_login_failures(key_hash=fingerprint)
        establish_account_session(
            request=_http_request(request),
            user=user,
            remember_me=bool(data["remember_me"]),
        )
        return Response({"user": UserSerializer(user).data})


class CohortListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        cohorts = StudentCohort.objects.filter(is_active=True).select_related("program")
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
    if auth_attempt_is_limited(
        key_hash=callback_fingerprint,
        scope=callback_scope,
        window_seconds=int(settings.ACCOUNT_SENSITIVE_WINDOW_SECONDS),
        limit=int(settings.ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT),
    ):
        return HttpResponseRedirect(
            oauth_frontend_redirect(provider=provider, outcome="error", error="rate_limited")
        )
    record_auth_attempt(key_hash=callback_fingerprint, scope=callback_scope)

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
        if user.welcome_completed_at is None:
            user.welcome_completed_at = timezone.now()
            user.save(update_fields=("welcome_completed_at", "updated_at"))
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
        link = build_account_link(path="/confirm-email", raw_token=token.raw_token)
        send_account_email(
            recipient=str(serializer.validated_data["new_email"]),
            subject="Confirm your new Lock-in email",
            body=f"Confirm your new email using this single-use link:\n\n{link}",
        )
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
            raise InvalidAccountToken() from error
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
        link = build_account_link(path="/settings", raw_token=token.raw_token)
        send_account_email(
            recipient=user.email,
            subject="Confirm your Lock-in account deletion request",
            body=(
                "Confirm your account deletion request using this single-use link:\n\n"
                f"{link}\n\n"
                "The request will not be processed until you confirm it."
            ),
        )
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

    def delete(self, request: Request, session_id: UUID) -> Response:
        user = _user(request)
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
