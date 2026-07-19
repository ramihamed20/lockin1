from typing import cast
from uuid import UUID

from django.conf import settings
from django.contrib.auth import authenticate, login, update_session_auth_hash
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import HttpRequest
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import APIException, AuthenticationFailed, NotFound
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AccountSecurityEvent, AccountSession, User
from .permissions import IsAdministrator
from .roles import Role, RoleChangeError, replace_managed_roles
from .selectors import dashboard_summary
from .serializers import (
    AccountSessionSerializer,
    EmailChangeRequestSerializer,
    EmailSerializer,
    LoginSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    ProfileUpdateSerializer,
    RegistrationSerializer,
    RoleUpdateSerializer,
    TokenSerializer,
    UserSerializer,
)
from .services import (
    AccountStateError,
    AccountTokenError,
    auth_attempt_fingerprint,
    auth_attempt_is_limited,
    build_account_link,
    change_password,
    clear_login_failures,
    confirm_email_change,
    confirm_password_reset,
    invalidate_sessions,
    login_fingerprint,
    login_is_limited,
    logout_current_session,
    record_auth_attempt,
    record_login_failure,
    register_account_session,
    register_user,
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


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise AuthenticationFailed()
    return request.user


def _http_request(request: Request) -> HttpRequest:
    return request._request


def _enforce_sensitive_request_limit(*, request: Request, scope: str, identifier: str) -> None:
    key_hash = auth_attempt_fingerprint(
        scope=scope,
        identifier=identifier,
        remote_address=request.META.get("REMOTE_ADDR", "unknown"),
    )
    if auth_attempt_is_limited(
        key_hash=key_hash,
        scope=scope,
        window_seconds=int(settings.ACCOUNT_SENSITIVE_WINDOW_SECONDS),
        limit=int(settings.ACCOUNT_SENSITIVE_REQUEST_LIMIT),
    ):
        raise TooManyAccountRequests()
    record_auth_attempt(key_hash=key_hash, scope=scope)


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
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        _enforce_sensitive_request_limit(
            request=request, scope="registration", identifier=str(data["email"])
        )
        try:
            user, token = register_user(
                email=str(data["email"]),
                full_name=str(data["full_name"]),
                password=str(data["password"]),
                preferred_language=str(data["preferred_language"]),
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
            verify_email(raw_token=str(serializer.validated_data["token"]))
        except AccountTokenError as error:
            raise InvalidAccountToken() from error
        return Response({"status": "verified"})


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
        fingerprint = login_fingerprint(
            email=email,
            remote_address=request.META.get("REMOTE_ADDR", "unknown"),
        )
        if login_is_limited(key_hash=fingerprint):
            raise TooManyAccountRequests()
        user = authenticate(_http_request(request), username=email, password=str(data["password"]))
        if not isinstance(user, User) or not user.is_email_verified:
            record_login_failure(key_hash=fingerprint)
            raise AuthenticationFailed(
                "The email or password is incorrect.", code="invalid_credentials"
            )
        clear_login_failures(key_hash=fingerprint)
        login(_http_request(request), user)
        session_age = (
            int(settings.ACCOUNT_REMEMBER_SESSION_AGE_SECONDS)
            if bool(data["remember_me"])
            else int(settings.ACCOUNT_SESSION_AGE_SECONDS)
        )
        request.session.set_expiry(session_age)
        request.session.save()
        register_account_session(request=_http_request(request), user=user)
        AccountSecurityEvent.objects.create(
            user=user,
            actor=user,
            event_type=AccountSecurityEvent.EventType.LOGIN_SUCCEEDED,
        )
        return Response({"user": UserSerializer(user).data})


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
        serializer = ProfileUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(user, field, value)
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
