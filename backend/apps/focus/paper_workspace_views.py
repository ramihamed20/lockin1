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


class PaperWorkspaceMediaRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "paper_workspace_media_rejected"


class PaperWorkspaceMediaStale(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "paper_workspace_media_conflict"


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
