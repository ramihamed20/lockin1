from uuid import UUID

from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role

from .models import Notification
from .pagination import NotificationCursorPagination
from .selectors import notifications_for_user, preferences_for_user, unread_count
from .serializers import NotificationSerializer, PlatformNoticeSerializer, PreferenceSerializer
from .services import (
    NotificationTargetUnavailable,
    create_notification,
    mark_all_read,
    mark_read,
    resolve_target,
    set_preferences,
)


class NotificationTargetGone(APIException):
    status_code = status.HTTP_410_GONE
    default_code = "notification_target_unavailable"


class NotificationListView(ListAPIView[Notification]):
    serializer_class = NotificationSerializer
    pagination_class = NotificationCursorPagination

    def get_queryset(self):  # type: ignore[no-untyped-def]
        assert isinstance(self.request.user, User)
        return notifications_for_user(
            user=self.request.user, unread_only=self.request.query_params.get("unread") == "true"
        )


class NotificationSummaryView(APIView):
    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response({"unread_count": unread_count(user=request.user)})


class NotificationReadView(APIView):
    def post(self, request: Request, notification_id: UUID) -> Response:
        assert isinstance(request.user, User)
        try:
            notification = mark_read(user=request.user, notification_id=notification_id)
        except Notification.DoesNotExist as error:
            raise Http404 from error
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    def post(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response({"updated": mark_all_read(user=request.user)})


class NotificationOpenView(APIView):
    def post(self, request: Request, notification_id: UUID) -> Response:
        assert isinstance(request.user, User)
        try:
            notification = mark_read(user=request.user, notification_id=notification_id)
        except Notification.DoesNotExist as error:
            raise Http404 from error
        try:
            route = resolve_target(user=request.user, notification=notification)
        except NotificationTargetUnavailable as error:
            raise NotificationTargetGone(str(error)) from error
        return Response({"route": route})


class NotificationPreferenceView(APIView):
    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response(preferences_for_user(user=request.user))

    def put(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        serializer = PreferenceSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        try:
            set_preferences(user=request.user, preferences=serializer.validated_data)
        except ValueError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(preferences_for_user(user=request.user))


class PlatformNoticeView(APIView):
    def post(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        if not user_has_role(request.user, Role.ADMINISTRATOR):
            raise PermissionDenied()
        serializer = PlatformNoticeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        notification, _ = create_notification(
            recipient_id=data["recipient_id"],
            category=Notification.Category.PLATFORM,
            template_key="platform.notice",
            title=str(data["title"]),
            body=str(data["body"]),
            deduplication_key=f"platform:{data['notice_key']}",
            required=bool(data["is_required"]),
        )
        assert notification is not None
        return Response(NotificationSerializer(notification).data, status=status.HTTP_201_CREATED)
