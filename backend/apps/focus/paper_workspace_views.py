from typing import Any

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from apps.entitlements.services import require_entitlement
from platform_core.api.serializers import StrictSerializer

from .paper_workspace import (
    PaperWorkspaceMediaConflict,
    PaperWorkspaceMediaError,
    admin_payload,
    remove_media,
    save_media,
    student_payload,
)
from .youtube_search import (
    MAX_QUERY_LENGTH,
    YouTubeQuotaExceeded,
    YouTubeSearchError,
    YouTubeSearchRateLimited,
    YouTubeSearchUnavailable,
    normalize_query,
    search_videos,
)


class PaperWorkspaceMediaRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "paper_workspace_media_rejected"


class PaperWorkspaceMediaStale(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "paper_workspace_media_conflict"


class YouTubeSearchNotConfigured(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "youtube_search_unavailable"
    default_detail = "YouTube search is not available right now. Paste a video link instead."


class YouTubeSearchQuota(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "youtube_quota_exceeded"
    default_detail = "YouTube search is busy right now. Try again later or paste a video link."


class YouTubeSearchTooOften(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_code = "youtube_search_rate_limited"
    default_detail = "Too many searches. Wait a few minutes and try again."


class YouTubeSearchUpstream(APIException):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_code = "youtube_search_failed"
    default_detail = "YouTube search failed. Try again."


class YouTubeSearchQuerySerializer(StrictSerializer):
    q = serializers.CharField(max_length=MAX_QUERY_LENGTH * 2, trim_whitespace=True)


def _actor(request: Request) -> User:
    user = request.user
    if not isinstance(user, User):
        raise PermissionDenied()
    return user


def _translate(error: PaperWorkspaceMediaError) -> APIException:
    if isinstance(error, PaperWorkspaceMediaConflict):
        return PaperWorkspaceMediaStale(str(error))
    return PaperWorkspaceMediaRejected(str(error))


class PaperWorkspaceMediaSaveSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    file_id = serializers.UUIDField(required=False, allow_null=True)
    enabled = serializers.BooleanField()
    focal_x = serializers.IntegerField(min_value=0, max_value=100)
    focal_y = serializers.IntegerField(min_value=0, max_value=100)


class PaperWorkspaceMediaRemoveSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)


class PaperWorkspaceMediaView(APIView):
    """The media a student's Paper Workspace player shows (``null`` = lofi scene)."""

    @extend_schema(operation_id="paper_workspace_media", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        require_entitlement(user=_actor(request), entitlement_code="focus.workspace")
        return Response(student_payload())


class PaperWorkspaceMediaAdminView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONTENT_VIEW

    def get_permissions(self):  # type: ignore[no-untyped-def]
        self.required_capability = (
            Capability.CONTENT_VIEW
            if self.request.method in {"GET", "HEAD", "OPTIONS"}
            else Capability.CONTENT_MANAGE
        )
        return super().get_permissions()

    @extend_schema(operation_id="paper_workspace_media_admin", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        return Response(admin_payload())

    @extend_schema(
        operation_id="paper_workspace_media_admin_save",
        request=PaperWorkspaceMediaSaveSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def put(self, request: Request) -> Response:
        serializer = PaperWorkspaceMediaSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: dict[str, Any] = serializer.validated_data
        try:
            return Response(
                save_media(
                    actor=_actor(request),
                    expected_revision=int(data["expected_revision"]),
                    file_id=data.get("file_id"),
                    enabled=bool(data["enabled"]),
                    focal_x=int(data["focal_x"]),
                    focal_y=int(data["focal_y"]),
                )
            )
        except PaperWorkspaceMediaError as error:
            raise _translate(error) from error

    @extend_schema(
        operation_id="paper_workspace_media_admin_remove",
        request=PaperWorkspaceMediaRemoveSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def delete(self, request: Request) -> Response:
        serializer = PaperWorkspaceMediaRemoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            return Response(
                remove_media(
                    actor=_actor(request),
                    expected_revision=int(serializer.validated_data["expected_revision"]),
                )
            )
        except PaperWorkspaceMediaError as error:
            raise _translate(error) from error


class PaperWorkspaceYouTubeSearchView(APIView):
    """Embeddable YouTube videos for the Paper Workspace player's search box."""

    @extend_schema(
        operation_id="paper_workspace_youtube_search",
        parameters=[YouTubeSearchQuerySerializer],
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: Request) -> Response:
        actor = _actor(request)
        require_entitlement(user=actor, entitlement_code="focus.workspace")
        serializer = YouTubeSearchQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        query = normalize_query(serializer.validated_data["q"])
        if not query:
            raise PaperWorkspaceMediaRejected("Type something to search for.")
        try:
            results = search_videos(query=query, user_id=actor.pk)
        except YouTubeSearchUnavailable as error:
            raise YouTubeSearchNotConfigured() from error
        except YouTubeQuotaExceeded as error:
            raise YouTubeSearchQuota() from error
        except YouTubeSearchRateLimited as error:
            raise YouTubeSearchTooOften() from error
        except YouTubeSearchError as error:
            raise YouTubeSearchUpstream() from error
        return Response({"query": query, "results": results})
