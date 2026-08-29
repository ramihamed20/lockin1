from __future__ import annotations

from uuid import UUID

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from apps.education.models import EducationNode
from apps.files.models import ManagedFile
from apps.questions.models import Question

from .admin_serializers import (
    AdminSheetActionSerializer,
    AdminSheetCreateSerializer,
    AdminSheetDeletePdfSerializer,
    AdminSheetReplacePdfSerializer,
    AdminSheetUpdateSerializer,
)
from .admin_services import (
    change_sheet_status,
    create_sheet,
    delete_pdf,
    has_publication_history,
    permanently_delete_sheet,
    replace_pdf,
    update_sheet,
)
from .models import LearningObject, LearningObjectAsset, LearningObjectVersion
from .services import ContentConflictError, ContentRuleError


class AdminContentRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "admin_content_rejected"


class AdminContentConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "revision_conflict"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _raise_rule(error: Exception) -> None:
    if isinstance(error, ContentConflictError):
        raise AdminContentConflict(str(error)) from error
    raise AdminContentRejected(str(error)) from error


class _ContentPermissionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONTENT_VIEW

    def get_permissions(self):  # type: ignore[no-untyped-def]
        self.required_capability = (
            Capability.CONTENT_VIEW if self.request.method in {"GET", "HEAD", "OPTIONS"}
            else Capability.CONTENT_MANAGE
        )
        return super().get_permissions()


def _sheets(subject: EducationNode):
    return (
        LearningObject.objects.filter(
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
            current_version__academic_node__path__startswith=subject.path,
        )
        .select_related("owner", "current_version__academic_node", "published_version")
        .prefetch_related("current_version__assets__managed_file")
        .order_by("position", "current_version__title", "id")
    )


def _primary_asset(sheet: LearningObject):  # type: ignore[no-untyped-def]
    version = sheet.current_version
    if version is None:
        return None
    return next(
        (asset for asset in version.assets.all() if asset.role == LearningObjectAsset.Role.PRIMARY),
        None,
    )


def serialize_sheet(sheet: LearningObject) -> dict[str, object]:
    version = sheet.current_version
    if version is None:
        raise AdminContentRejected("The sheet has no current version.")
    asset = _primary_asset(sheet)
    question_count = Question.objects.filter(
        current_version__source_learning_object=sheet,
    ).count()
    has_history = (
        sheet.progress_records.exists()
        or sheet.bookmarks.exists()
        or question_count > 0
        or sheet.question_import_batches.exists()
        or has_publication_history(sheet)
    )
    return {
        "id": str(sheet.id),
        "title": version.title,
        "summary": version.summary,
        "subject_id": str(version.academic_node_id),
        "subject_title": version.academic_node.title,
        "position": sheet.position,
        "workflow_status": sheet.workflow_status,
        "revision": sheet.revision,
        "published_at": sheet.published_at,
        "archived_at": sheet.archived_at,
        "question_count": question_count,
        "can_permanently_delete": not has_history,
        "pdf": (
            {
                "file_id": str(asset.managed_file_id),
                "original_name": asset.managed_file.original_name,
                "size_bytes": asset.managed_file.size_bytes,
                "content_type": asset.managed_file.content_type,
                "view_url": f"/api/v1/files/{asset.managed_file_id}/view",
            }
            if asset is not None
            else None
        ),
        "updated_at": sheet.updated_at,
    }


class AdminSubjectListView(_ContentPermissionView):
    def get(self, request: Request) -> Response:
        subjects = EducationNode.objects.filter(kind=EducationNode.Kind.SUBJECT).order_by(
            "position", "title", "id"
        )
        query = request.query_params.get("q", "").strip()[:100]
        if query:
            subjects = subjects.filter(title__icontains=query)
        results = []
        for subject in subjects:
            sheets = _sheets(subject)
            results.append(
                {
                    "id": str(subject.id),
                    "title": subject.title,
                    "path": subject.path,
                    "status": subject.status,
                    "sheet_count": sheets.count(),
                    "published_count": sheets.filter(
                        workflow_status=LearningObject.WorkflowStatus.PUBLISHED
                    ).count(),
                    "draft_count": sheets.filter(
                        workflow_status__in=(
                            LearningObject.WorkflowStatus.DRAFT,
                            LearningObject.WorkflowStatus.IN_REVIEW,
                            LearningObject.WorkflowStatus.REJECTED,
                        )
                    ).count(),
                }
            )
        return Response({"count": len(results), "results": results})


class AdminSubjectSheetListView(_ContentPermissionView):
    def get(self, request: Request, subject_id: UUID) -> Response:
        subject = get_object_or_404(EducationNode, id=subject_id, kind=EducationNode.Kind.SUBJECT)
        sheets = _sheets(subject)
        workflow_status = request.query_params.get("status", "").strip()
        if workflow_status:
            if workflow_status not in LearningObject.WorkflowStatus.values:
                raise AdminContentRejected("The sheet status filter is invalid.")
            sheets = sheets.filter(workflow_status=workflow_status)
        query = request.query_params.get("q", "").strip()[:100]
        if query:
            sheets = sheets.filter(
                Q(current_version__title__icontains=query)
                | Q(current_version__summary__icontains=query)
            )
        results = [serialize_sheet(sheet) for sheet in sheets]
        return Response(
            {
                "subject": {"id": str(subject.id), "title": subject.title},
                "count": len(results),
                "results": results,
            }
        )

    def post(self, request: Request, subject_id: UUID) -> Response:
        subject = get_object_or_404(EducationNode, id=subject_id, kind=EducationNode.Kind.SUBJECT)
        serializer = AdminSheetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        managed_file = get_object_or_404(ManagedFile, id=data["primary_file_id"])
        try:
            sheet = create_sheet(
                actor=_user(request),
                subject=subject,
                managed_file=managed_file,
                title=str(data["title"]),
                summary=str(data["summary"]),
                position=int(data["position"]),
                publish=bool(data["publish"]),
                notify_students=bool(data["notify_students"]),
                allow_download=bool(data["allow_download"]),
            )
        except ContentRuleError as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet), status=status.HTTP_201_CREATED)


class AdminSheetDetailView(_ContentPermissionView):
    def get(self, request: Request, sheet_id: UUID) -> Response:
        sheet = get_object_or_404(
            LearningObject.objects.select_related(
                "owner", "current_version__academic_node", "published_version"
            ).prefetch_related("current_version__assets__managed_file"),
            id=sheet_id,
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
        )
        return Response(serialize_sheet(sheet))

    def patch(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_revision = int(data.pop("expected_revision"))
        try:
            sheet = update_sheet(
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=expected_revision,
                changes=data,
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))

    def delete(self, request: Request, sheet_id: UUID) -> Response:
        try:
            permanently_delete_sheet(actor=_user(request), sheet_id=sheet_id)
        except LearningObject.DoesNotExist as error:
            raise NotFound("Sheet not found.") from error
        except ContentRuleError as error:
            _raise_rule(error)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminSheetActionView(_ContentPermissionView):
    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            sheet = change_sheet_status(
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(data["expected_revision"]),
                action=str(data["action"]),
                notify_students=bool(data["notify_students"]),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))


class AdminSheetPdfView(_ContentPermissionView):
    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetReplacePdfSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        managed_file = get_object_or_404(ManagedFile, id=data["primary_file_id"])
        try:
            sheet = replace_pdf(
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(data["expected_revision"]),
                managed_file=managed_file,
                notify_students=bool(data["notify_students"]),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))

    def delete(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetDeletePdfSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sheet = delete_pdf(
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))
