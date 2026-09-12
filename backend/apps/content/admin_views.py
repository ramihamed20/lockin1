from __future__ import annotations

from uuid import UUID

from django.db.models import Q, QuerySet
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

from .active_study_questions import ActiveStudyQuestionValidationError
from .admin_serializers import (
    AdminActiveStudyQuestionDeleteSerializer,
    AdminActiveStudyQuestionSaveSerializer,
    AdminActiveStudyQuestionValidateSerializer,
    AdminActiveStudySettingsSerializer,
    AdminSheetActionSerializer,
    AdminSheetCreateSerializer,
    AdminSheetDeletePdfSerializer,
    AdminSheetReorderSerializer,
    AdminSheetReplacePdfSerializer,
    AdminSheetUpdateSerializer,
)
from .admin_services import (
    active_study_payload,
    active_study_question_content_payload,
    change_sheet_status,
    create_sheet,
    delete_active_study_question_content,
    delete_pdf,
    has_publication_history,
    is_student_visible,
    permanently_delete_sheet,
    reorder_sheet,
    replace_pdf,
    save_active_study_question_content,
    update_active_study_settings,
    update_sheet,
    validate_active_study_question_content,
)
from .models import CatalogSubject, LearningObject, LearningObjectAsset, LearningObjectVersion
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
            Capability.CONTENT_VIEW
            if self.request.method in {"GET", "HEAD", "OPTIONS"}
            else Capability.CONTENT_MANAGE
        )
        return super().get_permissions()


def _sheets(subject: EducationNode) -> QuerySet[LearningObject]:
    return (
        LearningObject.objects.filter(
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
            current_version__academic_node__path__startswith=subject.path,
        )
        .select_related("owner", "current_version__academic_node", "published_version")
        .select_related("active_study_settings")
        .prefetch_related("current_version__assets__managed_file")
        .order_by("position", "current_version__title", "id")
    )


def _catalog_subject_node(subject_id: UUID) -> tuple[CatalogSubject | None, EducationNode]:
    """Resolve the Catalog identifier, while keeping pre-Catalog content operable."""
    catalog_subject = (
        CatalogSubject.objects.filter(id=subject_id, is_active=True)
        .select_related("source_node")
        .first()
    )
    if catalog_subject is not None:
        if catalog_subject.source_node is None:
            raise NotFound("Catalog subject is not linked to content yet.")
        return catalog_subject, catalog_subject.source_node
    return None, get_object_or_404(EducationNode, id=subject_id, kind=EducationNode.Kind.SUBJECT)


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
        or sheet.active_study_question_content.exists()
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
        # Published in Content Studio and reachable by a student are not the same
        # fact: a sheet outside every cohort's Catalog branch is published and
        # invisible. Saying which is which here is what stops that being
        # discovered by the students who cannot find the sheet.
        "student_visible": is_student_visible(sheet),
        "revision": sheet.revision,
        "published_at": sheet.published_at,
        "archived_at": sheet.archived_at,
        "question_count": question_count,
        "active_study_enabled": getattr(sheet, "active_study_settings", None) is not None
        and sheet.active_study_settings.enabled,
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
        subjects = (
            CatalogSubject.objects.select_related("cohort__program", "source_node")
            .filter(is_active=True, source_node__isnull=False)
            .order_by("cohort__position", "position", "title", "id")
        )
        query = request.query_params.get("q", "").strip()[:100]
        if query:
            subjects = subjects.filter(title__icontains=query)
        results = []
        for subject in subjects:
            source_node = subject.source_node
            if source_node is None:
                continue
            sheets = _sheets(source_node)
            # Do not offer an empty Third Year placeholder to content staff.
            # If legacy content exists, retain access so it can be reviewed
            # rather than silently deleting or concealing real work.
            if subject.cohort.code == "year-3" and not sheets.exists():
                continue
            program = subject.cohort.program
            college = (
                "Tripoli" if program.code == "human-medicine" else program.name_en.split(" — ")[-1]
            )
            specialty = "Human Medicine" if program.code == "human-medicine" else "Dentistry"
            year = (
                f"Batch {subject.cohort.code}"
                if program.code == "human-medicine"
                else subject.cohort.name_en.split(" — ")[-1]
            )
            results.append(
                {
                    "id": str(subject.id),
                    "title": subject.title,
                    "path": f"catalog/{subject.material_slug}",
                    "status": "published",
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
                    "specialty_title": specialty,
                    "college_title": college,
                    "academic_year_title": year,
                }
            )
        return Response({"count": len(results), "results": results})


class AdminSubjectSheetListView(_ContentPermissionView):
    def get(self, request: Request, subject_id: UUID) -> Response:
        catalog_subject, subject = _catalog_subject_node(subject_id)
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
                "subject": {
                    "id": str(catalog_subject.id if catalog_subject is not None else subject.id),
                    "title": (
                        catalog_subject.title if catalog_subject is not None else subject.title
                    ),
                },
                "count": len(results),
                "results": results,
            }
        )

    def post(self, request: Request, subject_id: UUID) -> Response:
        _, subject = _catalog_subject_node(subject_id)
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


class AdminSheetReorderView(_ContentPermissionView):
    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            sheet = reorder_sheet(
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(data["expected_revision"]),
                target_sheet_id=data["target_sheet_id"],
                placement=str(data["placement"]),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))


class AdminSheetActiveStudyView(_ContentPermissionView):
    def _sheet(self, sheet_id: UUID) -> LearningObject:
        return get_object_or_404(
            LearningObject.objects.select_related("active_study_settings"),
            id=sheet_id,
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
        )

    def get(self, request: Request, sheet_id: UUID) -> Response:
        return Response(active_study_payload(sheet=self._sheet(sheet_id)))

    def patch(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminActiveStudySettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            sheet = update_active_study_settings(
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(data["expected_revision"]),
                enabled=bool(data["enabled"]),
                total_pdf_pages=data.get("total_pdf_pages"),
                excluded_start_pages=int(data["excluded_start_pages"]),
                excluded_end_pages=int(data["excluded_end_pages"]),
                confirm_boundary_change=bool(data["confirm_boundary_change"]),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        sheet = self._sheet(sheet.id)
        return Response(active_study_payload(sheet=sheet))


class AdminSheetActiveStudyQuestionsView(_ContentPermissionView):
    def _sheet(self, sheet_id: UUID) -> LearningObject:
        return get_object_or_404(
            LearningObject.objects.select_related("active_study_settings"),
            id=sheet_id,
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
        )

    def get(self, request: Request, sheet_id: UUID, difficulty: str) -> Response:
        try:
            return Response(
                active_study_question_content_payload(
                    sheet=self._sheet(sheet_id), difficulty_key=difficulty
                )
            )
        except ContentRuleError as error:
            _raise_rule(error)
        raise AssertionError("Content rejection must raise an API exception.")

    def post(self, request: Request, sheet_id: UUID, difficulty: str) -> Response:
        serializer = AdminActiveStudyQuestionValidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            validation = validate_active_study_question_content(
                sheet=self._sheet(sheet_id),
                difficulty_key=difficulty,
                payload=serializer.validated_data["payload"],
            )
        except ActiveStudyQuestionValidationError as error:
            return Response(
                {"valid": False, "errors": error.errors}, status=status.HTTP_400_BAD_REQUEST
            )
        except ContentRuleError as error:
            _raise_rule(error)
        return Response(validation.as_dict())

    def put(self, request: Request, sheet_id: UUID, difficulty: str) -> Response:
        serializer = AdminActiveStudyQuestionSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            content = save_active_study_question_content(
                actor=_user(request),
                sheet_id=sheet_id,
                difficulty_key=difficulty,
                payload=serializer.validated_data["payload"],
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except ActiveStudyQuestionValidationError as error:
            return Response(
                {"valid": False, "errors": error.errors}, status=status.HTTP_400_BAD_REQUEST
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(
            active_study_question_content_payload(
                sheet=self._sheet(sheet_id), difficulty_key=content.difficulty
            )
        )

    def delete(self, request: Request, sheet_id: UUID, difficulty: str) -> Response:
        serializer = AdminActiveStudyQuestionDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            delete_active_study_question_content(
                actor=_user(request),
                sheet_id=sheet_id,
                difficulty_key=difficulty,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(status=status.HTTP_204_NO_CONTENT)
