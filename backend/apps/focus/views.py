from decimal import Decimal
from typing import Any
from uuid import UUID

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.entitlements.services import require_entitlement

from .annotation_services import (
    FocusAnnotationConflictError,
    annotation_payload,
    sync_annotations,
)
from .domain_types import AnnotationMutation, WorkspaceStateInput
from .integrations import resolve_focus_document
from .selectors import (
    annotations_for_pages,
    focus_session_history,
    get_focus_summary,
    latest_workspace,
)
from .serializers import (
    AnnotationSyncSerializer,
    FocusSessionActionSerializer,
    FocusSessionSerializer,
    FocusSessionStartSerializer,
    FocusWorkspaceSerializer,
    WorkspaceStateSerializer,
)
from .services import (
    FocusSessionStateError,
    abandon_focus_session,
    complete_owned_focus_session,
    pause_focus_session,
    resume_focus_session,
    start_workspace_session,
)
from .validation import FocusValidationError
from .workspace_services import FocusWorkspaceConflictError, update_workspace_state


class FocusConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "focus_revision_conflict"
    default_detail = "Focus state changed. Reload it and try again."


class FocusRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "focus_rule_rejected"


class FocusAnnotationPagination(PageNumberPagination):
    page_size = 250
    page_size_query_param = "page_size"
    max_page_size = 1000


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _authorize(request: Request) -> User:
    user = _user(request)
    require_entitlement(user=user, entitlement_code="focus.workspace")
    return user


def _rule_error(error: ValueError) -> APIException:
    if isinstance(error, (FocusWorkspaceConflictError, FocusAnnotationConflictError)):
        return FocusConflict(str(error))
    return FocusRejected(str(error))


def _document_payload(document: Any) -> dict[str, object]:
    return {
        "document_id": str(document.document_id),
        "document_version_id": str(document.document_version_id),
        "file_id": str(document.file_id),
        "title": document.title,
        "language": document.language,
        "view_url": document.view_url,
        "size_bytes": document.size_bytes,
        "checksum_sha256": document.checksum_sha256,
        "page_count": document.page_count,
    }


class FocusDocumentView(APIView):
    @extend_schema(operation_id="focus_document_retrieve", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_version_id: UUID) -> Response:
        user = _authorize(request)
        document = resolve_focus_document(user=user, document_version_id=document_version_id)
        workspace = latest_workspace(
            user_id=user.id,
            document_version_id=document.document_version_id,
        )
        annotation_revision, _ = annotations_for_pages(
            user_id=user.id,
            document_version_id=document.document_version_id,
            page_numbers=(1,),
        )
        summary = get_focus_summary(user_id=user.id)
        return Response(
            {
                "document": _document_payload(document),
                "latest_workspace": (
                    FocusWorkspaceSerializer(workspace).data if workspace is not None else None
                ),
                "annotation_revision": annotation_revision,
                "summary": {
                    "completed_sessions": summary.completed_sessions,
                    "active_seconds": summary.active_seconds,
                    "last_completed_at": summary.last_completed_at,
                },
            }
        )


class FocusSessionListCreateView(ListAPIView[Any]):
    serializer_class = FocusSessionSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        return focus_session_history(user_id=_authorize(self.request).id)

    @extend_schema(
        operation_id="focus_session_start",
        request=FocusSessionStartSerializer,
        responses={200: FocusSessionSerializer, 201: FocusSessionSerializer},
    )
    def post(self, request: Request) -> Response:
        user = _authorize(request)
        serializer = FocusSessionStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        document = resolve_focus_document(
            user=user,
            document_version_id=data["document_version_id"],
        )
        try:
            session, _, created = start_workspace_session(
                user=user,
                document=document,
                client_instance_id=data["client_instance_id"],
                planned_duration_seconds=data.get("planned_duration_seconds"),
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(
            FocusSessionSerializer(session).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FocusSessionActionView(APIView):
    @extend_schema(
        operation_id="focus_session_action",
        request=FocusSessionActionSerializer,
        responses={200: FocusSessionSerializer},
    )
    def post(self, request: Request, session_id: UUID, action: str) -> Response:
        user = _authorize(request)
        serializer = FocusSessionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actions = {
            "pause": pause_focus_session,
            "resume": resume_focus_session,
            "complete": complete_owned_focus_session,
            "abandon": abandon_focus_session,
        }
        service = actions.get(action)
        if service is None:
            raise ValidationError("Focus session action is not supported.")
        try:
            session = service(user=user, session_id=session_id)
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(FocusSessionSerializer(session).data)


class FocusWorkspaceStateView(APIView):
    @extend_schema(
        operation_id="focus_workspace_update",
        request=WorkspaceStateSerializer,
        responses={200: FocusWorkspaceSerializer},
    )
    def patch(self, request: Request, session_id: UUID) -> Response:
        user = _authorize(request)
        serializer = WorkspaceStateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        state = WorkspaceStateInput(
            current_page=data["current_page"],
            page_count=data.get("page_count"),
            zoom=Decimal(data["zoom"]),
            sidebar=str(data["sidebar"]),
            active_tool=str(data["active_tool"]),
            layout=dict(data.get("layout", {})),
            open_tabs=[str(value) for value in data.get("open_tabs", [])],
        )
        try:
            workspace = update_workspace_state(
                user=user,
                session_id=session_id,
                expected_revision=data["expected_revision"],
                state=state,
            )
        except (FocusValidationError, FocusWorkspaceConflictError) as error:
            raise _rule_error(error) from error
        return Response(FocusWorkspaceSerializer(workspace).data)


def _page_numbers(value: str | None) -> tuple[int, ...]:
    if value is None:
        return (1,)
    try:
        pages = tuple(dict.fromkeys(int(item) for item in value.split(",")))
    except ValueError as error:
        raise ValidationError("Focus pages must be comma-separated positive integers.") from error
    if not pages or len(pages) > 10 or any(page < 1 or page > 10_000 for page in pages):
        raise ValidationError("Focus annotations can load at most ten valid pages at once.")
    return pages


class FocusAnnotationsView(APIView):
    @extend_schema(operation_id="focus_annotations_list", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_version_id: UUID) -> Response:
        user = _authorize(request)
        document = resolve_focus_document(user=user, document_version_id=document_version_id)
        pages = _page_numbers(request.query_params.get("pages"))
        previous_workspace = latest_workspace(
            user_id=user.id,
            document_version_id=document.document_version_id,
        )
        page_count = document.page_count or (
            previous_workspace.page_count if previous_workspace is not None else None
        )
        if page_count is not None and any(page > page_count for page in pages):
            raise ValidationError("A requested annotation page is outside the document.")
        revision, annotations = annotations_for_pages(
            user_id=user.id,
            document_version_id=document.document_version_id,
            page_numbers=pages,
        )
        paginator = FocusAnnotationPagination()
        page = paginator.paginate_queryset(annotations, request, view=self)
        response = paginator.get_paginated_response(
            [annotation_payload(item) for item in page or []]
        )
        response.data = {
            "collection_revision": revision,
            **dict(response.data),
        }
        return response

    @extend_schema(
        operation_id="focus_annotations_sync",
        request=AnnotationSyncSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request, document_version_id: UUID) -> Response:
        user = _authorize(request)
        document = resolve_focus_document(user=user, document_version_id=document_version_id)
        serializer = AnnotationSyncSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        previous_workspace = latest_workspace(
            user_id=user.id,
            document_version_id=document.document_version_id,
        )
        page_count = document.page_count or (
            previous_workspace.page_count if previous_workspace is not None else None
        )
        annotations = tuple(
            AnnotationMutation(
                annotation_id=item["id"],
                page_number=item["page_number"],
                tool=str(item["tool"]),
                layer_key=str(item["layer_key"]),
                bounds=dict(item["bounds"]),
                payload=dict(item["payload"]),
                color=str(item["color"]),
                thickness=Decimal(item["thickness"]),
                opacity=Decimal(item["opacity"]),
            )
            for item in data.get("annotations", [])
        )
        try:
            result = sync_annotations(
                user=user,
                document_id=document.document_id,
                document_version_id=document.document_version_id,
                page_count=page_count,
                expected_revision=data["expected_collection_revision"],
                idempotency_key=data["idempotency_key"],
                annotations=annotations,
                deleted_ids=tuple(data.get("deleted_ids", [])),
            )
        except (
            FocusValidationError,
            FocusAnnotationConflictError,
        ) as error:
            raise _rule_error(error) from error
        return Response(
            {
                "collection_revision": result.collection_revision,
                "saved_at": result.saved_at,
                "annotations": result.annotations,
                "deleted_ids": result.deleted_ids,
                "replayed": result.replayed,
            }
        )
