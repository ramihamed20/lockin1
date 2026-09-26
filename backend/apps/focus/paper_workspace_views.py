from typing import Any
from uuid import UUID

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

from .lofi_scenes import (
    LofiSceneConflict,
    LofiSceneError,
    LofiSceneNotFound,
    admin_payload,
    create_scene,
    delete_scene,
    reorder_scenes,
    student_payload,
    update_scene,
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


class LofiSceneRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "lofi_scene_rejected"


class LofiSceneStale(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "lofi_scene_conflict"


class LofiSceneMissing(APIException):
    status_code = status.HTTP_404_NOT_FOUND
    default_code = "lofi_scene_not_found"


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


def _translate(error: LofiSceneError) -> APIException:
    if isinstance(error, LofiSceneNotFound):
        return LofiSceneMissing(str(error))
    if isinstance(error, LofiSceneConflict):
        return LofiSceneStale(str(error))
    return LofiSceneRejected(str(error))


class LofiSceneCreateSerializer(StrictSerializer):
    title = serializers.CharField(max_length=200, allow_blank=True)
    media_file_id = serializers.UUIDField()
    cover_file_id = serializers.UUIDField(required=False, allow_null=True)
    enabled = serializers.BooleanField(default=True)
    focal_x = serializers.IntegerField(min_value=0, max_value=100, default=50)
    focal_y = serializers.IntegerField(min_value=0, max_value=100, default=50)


class LofiSceneUpdateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    title = serializers.CharField(max_length=200, allow_blank=True, required=False)
    media_file_id = serializers.UUIDField(required=False)
    cover_file_id = serializers.UUIDField(required=False, allow_null=True)
    enabled = serializers.BooleanField(required=False)
    focal_x = serializers.IntegerField(min_value=0, max_value=100, required=False)
    focal_y = serializers.IntegerField(min_value=0, max_value=100, required=False)


class LofiSceneDeleteSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)


class LofiSceneOrderSerializer(StrictSerializer):
    scene_ids = serializers.ListField(child=serializers.UUIDField(), max_length=100)


class LofiScenesView(APIView):
    """The Lo-Fi scenes a student can pick in Paper Workspace (empty = built-in scene)."""

    @extend_schema(operation_id="lofi_scenes", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        require_entitlement(user=_actor(request), entitlement_code="focus.workspace")
        return Response(student_payload())


class _LofiAdminView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONTENT_VIEW

    def get_permissions(self):  # type: ignore[no-untyped-def]
        self.required_capability = (
            Capability.CONTENT_VIEW
            if self.request.method in {"GET", "HEAD", "OPTIONS"}
            else Capability.CONTENT_MANAGE
        )
        return super().get_permissions()


class LofiScenesAdminView(_LofiAdminView):
    @extend_schema(operation_id="lofi_scenes_admin", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        return Response(admin_payload())

    @extend_schema(
        operation_id="lofi_scenes_admin_create",
        request=LofiSceneCreateSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request) -> Response:
        serializer = LofiSceneCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: dict[str, Any] = serializer.validated_data
        try:
            payload = create_scene(
                actor=_actor(request),
                title=str(data["title"]),
                media_file_id=data["media_file_id"],
                cover_file_id=data.get("cover_file_id"),
                enabled=bool(data["enabled"]),
                focal_x=int(data["focal_x"]),
                focal_y=int(data["focal_y"]),
            )
        except LofiSceneError as error:
            raise _translate(error) from error
        return Response(payload, status=status.HTTP_201_CREATED)


class LofiSceneAdminView(_LofiAdminView):
    @extend_schema(
        operation_id="lofi_scene_admin_update",
        request=LofiSceneUpdateSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def patch(self, request: Request, scene_id: UUID) -> Response:
        serializer = LofiSceneUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: dict[str, Any] = dict(serializer.validated_data)
        expected = int(data.pop("expected_revision"))
        try:
            return Response(
                update_scene(
                    actor=_actor(request),
                    scene_id=scene_id,
                    expected_revision=expected,
                    changes=data,
                )
            )
        except LofiSceneError as error:
            raise _translate(error) from error

    @extend_schema(
        operation_id="lofi_scene_admin_delete",
        request=LofiSceneDeleteSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def delete(self, request: Request, scene_id: UUID) -> Response:
        serializer = LofiSceneDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            return Response(
                delete_scene(
                    actor=_actor(request),
                    scene_id=scene_id,
                    expected_revision=int(serializer.validated_data["expected_revision"]),
                )
            )
        except LofiSceneError as error:
            raise _translate(error) from error


class LofiSceneOrderAdminView(_LofiAdminView):
    @extend_schema(
        operation_id="lofi_scenes_admin_reorder",
        request=LofiSceneOrderSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def put(self, request: Request) -> Response:
        serializer = LofiSceneOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            return Response(
                reorder_scenes(
                    actor=_actor(request), scene_ids=list(serializer.validated_data["scene_ids"])
                )
            )
        except LofiSceneError as error:
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
            raise LofiSceneRejected("Type something to search for.")
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
