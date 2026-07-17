from typing import Any
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.education.permissions import IsCreatorOrAdministrator
from apps.files.models import ManagedFile

from .models import LearningObject
from .selectors import (
    manageable_learning_objects,
    published_learning_object,
    published_learning_objects,
)
from .serializers import (
    LearningObjectUpdateSerializer,
    LearningObjectWriteSerializer,
    ManagementLearningObjectSerializer,
    PublicLearningObjectSerializer,
    RejectActionSerializer,
    RevisionActionSerializer,
    TransferActionSerializer,
)
from .services import (
    ContentConflictError,
    ContentRuleError,
    LearningObjectInput,
    archive_learning_object,
    create_learning_object,
    publish_learning_object,
    reject_learning_object,
    revise_learning_object,
    submit_for_review,
    transfer_learning_object,
)


class ContentConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This content changed. Reload it and try again."
    default_code = "revision_conflict"


class ContentRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "content_rule_rejected"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rule_error(error: ContentRuleError) -> APIException:
    message = str(error)
    lowered = message.lower()
    if lowered.startswith("you cannot") or lowered.startswith("only administrators"):
        return PermissionDenied(message)
    return ContentRejected(message)


def _write_input(*, actor: User, data: dict[str, Any]) -> LearningObjectInput:
    node = get_object_or_404(EducationNode, id=data["academic_node_id"])
    file_id = data.get("primary_file_id")
    primary_file = get_object_or_404(ManagedFile, id=file_id) if file_id is not None else None
    return LearningObjectInput(
        academic_node=node,
        content_type=str(data["content_type"]),
        title=str(data["title"]),
        summary=str(data.get("summary", "")),
        language=str(data.get("language", "en")),
        allow_download=bool(data.get("allow_download", False)),
        metadata=dict(data.get("metadata", {})),
        available_from=data.get("available_from"),
        available_until=data.get("available_until"),
        primary_file=primary_file,
    )


def _public_context(*, user: User, learning_objects: list[LearningObject]) -> dict[str, object]:
    from apps.progress.models import Bookmark, LearningProgress

    ids = [item.id for item in learning_objects]
    bookmarked_ids = set(
        Bookmark.objects.filter(user=user, learning_object_id__in=ids).values_list(
            "learning_object_id", flat=True
        )
    )
    progress_by_content = {
        progress.learning_object_id: progress
        for progress in LearningProgress.objects.filter(user=user, learning_object_id__in=ids)
    }
    return {"bookmarked_ids": bookmarked_ids, "progress_by_content": progress_by_content}


class PublicLearningObjectListView(ListAPIView[LearningObject]):
    serializer_class = PublicLearningObjectSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        raw_node = self.request.query_params.get("node")
        node_id = None
        if raw_node:
            try:
                node_id = UUID(raw_node)
            except ValueError as error:
                raise NotFound("Education node not found.") from error
        content_type = self.request.query_params.get("content_type") or None
        return published_learning_objects(node_id=node_id, content_type=content_type)

    def get_serializer_context(self) -> dict[str, object]:
        context = super().get_serializer_context()
        page_items = list(getattr(self, "_phase4_page_items", []))
        if page_items:
            context.update(_public_context(user=_user(self.request), learning_objects=page_items))
        return context

    def paginate_queryset(self, queryset):  # type: ignore[no-untyped-def]
        page = super().paginate_queryset(queryset)
        self._phase4_page_items = page or []
        return page


class PublicLearningObjectDetailView(APIView):
    def get(self, request: Request, learning_object_id: UUID) -> Response:
        try:
            learning_object = published_learning_object(learning_object_id=learning_object_id)
        except LearningObject.DoesNotExist as error:
            raise NotFound("Learning content not found.") from error
        context = _public_context(user=_user(request), learning_objects=[learning_object])
        return Response(PublicLearningObjectSerializer(learning_object, context=context).data)


class ManagementLearningObjectListView(ListAPIView[LearningObject]):
    permission_classes = [IsCreatorOrAdministrator]
    serializer_class = ManagementLearningObjectSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        queryset = manageable_learning_objects(user=_user(self.request))
        workflow_status = self.request.query_params.get("status")
        if workflow_status:
            queryset = queryset.filter(workflow_status=workflow_status)
        return queryset

    def post(self, request: Request) -> Response:
        serializer = LearningObjectWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = create_learning_object(
                actor=_user(request),
                data=_write_input(actor=_user(request), data=serializer.validated_data),
            )
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(
            ManagementLearningObjectSerializer(learning_object).data,
            status=status.HTTP_201_CREATED,
        )


class ManagementLearningObjectDetailView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def get(self, request: Request, learning_object_id: UUID) -> Response:
        learning_object = get_object_or_404(
            manageable_learning_objects(user=_user(request)), id=learning_object_id
        )
        return Response(ManagementLearningObjectSerializer(learning_object).data)

    def patch(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = LearningObjectUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_revision = int(data.pop("expected_revision"))
        try:
            learning_object = revise_learning_object(
                actor=_user(request),
                learning_object_id=learning_object_id,
                expected_revision=expected_revision,
                data=_write_input(actor=_user(request), data=data),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)


class _RevisionActionView(APIView):
    permission_classes = [IsCreatorOrAdministrator]
    action = staticmethod(submit_for_review)

    def post(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = RevisionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = self.action(
                actor=_user(request),
                learning_object_id=learning_object_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)


class SubmitLearningObjectView(_RevisionActionView):
    action = staticmethod(submit_for_review)


class PublishLearningObjectView(_RevisionActionView):
    action = staticmethod(publish_learning_object)


class ArchiveLearningObjectView(_RevisionActionView):
    action = staticmethod(archive_learning_object)


class RejectLearningObjectView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = RejectActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = reject_learning_object(
                actor=_user(request),
                learning_object_id=learning_object_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
                review_note=str(serializer.validated_data["review_note"]),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)


class TransferLearningObjectView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = TransferActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = transfer_learning_object(
                actor=_user(request),
                learning_object_id=learning_object_id,
                new_owner=get_object_or_404(User, id=serializer.validated_data["owner_id"]),
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)
