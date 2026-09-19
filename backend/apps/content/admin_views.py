from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from django.db.models import Count, Model, Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import (
    APIException,
    NotFound,
    PermissionDenied,
    ValidationError,
)
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from apps.audit.models import AuditRecord
from apps.education.models import EducationNode
from apps.files.models import ManagedFile
from apps.files.services import managed_file_delivery_size
from apps.progress.models import Bookmark, LearningProgress
from apps.questions.models import Question, QuestionImportBatch

from .active_study_questions import ActiveStudyQuestionValidationError
from .admin_serializers import (
    AdminActiveStudyPlanPreviewSerializer,
    AdminActiveStudyQuestionDeleteSerializer,
    AdminActiveStudyQuestionSaveSerializer,
    AdminActiveStudyQuestionValidateSerializer,
    AdminActiveStudySettingsSerializer,
    AdminSheetActionSerializer,
    AdminSheetCreateSerializer,
    AdminSheetDeletePdfSerializer,
    AdminSheetLockinPdfSerializer,
    AdminSheetReorderSerializer,
    AdminSheetReplacePdfSerializer,
    AdminSheetSummaryPdfSerializer,
    AdminSheetUpdateSerializer,
)
from .admin_services import (
    active_study_payload,
    active_study_plan_preview,
    active_study_question_content_payload,
    change_sheet_status,
    create_sheet,
    delete_active_study_question_content,
    delete_lockin_pdf,
    delete_pdf,
    delete_summary_pdf,
    has_publication_history,
    is_student_visible,
    permanently_delete_sheet,
    reorder_sheet,
    replace_lockin_pdf,
    replace_pdf,
    replace_summary_pdf,
    save_active_study_question_content,
    sheet_edition_summaries,
    update_active_study_settings,
    update_sheet,
    validate_active_study_question_content,
)
from .catalog_subjects import study_paths_for
from .editions import UnknownEditionError, normalize_edition
from .models import (
    ActiveStudyQuestionContent,
    CatalogSubject,
    LearningObject,
    LearningObjectAsset,
    LearningObjectVersion,
)
from .services import ContentConflictError, ContentFieldError, ContentRuleError


class AdminContentRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "admin_content_rejected"


class AdminContentConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "revision_conflict"


def _edition(request: Request) -> str:
    """The edition a request addresses; an absent one means the university edition."""

    try:
        return normalize_edition(request.query_params.get("edition"))
    except UnknownEditionError as error:
        raise ValidationError({"edition": [str(error)], "detail": str(error)}) from error


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _raise_rule(error: Exception) -> None:
    if isinstance(error, ContentConflictError):
        raise AdminContentConflict(str(error)) from error
    if isinstance(error, ContentFieldError):
        # Field-scoped rejections travel in the envelope's ``fields`` map so
        # Admin can mark the offending input rather than the whole form.
        raise ValidationError(error.fields) from error
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
        .prefetch_related("active_study_settings_set")
        .prefetch_related("current_version__assets__managed_file")
        .order_by("position", "current_version__title", "id")
    )


_DRAFT_LIKE_STATUSES = frozenset(
    {
        LearningObject.WorkflowStatus.DRAFT,
        LearningObject.WorkflowStatus.IN_REVIEW,
        LearningObject.WorkflowStatus.REJECTED,
    }
)


def _sheet_counts_by_subject_path(subject_paths: set[str]) -> dict[str, dict[str, int]]:
    """Count every subject's sheets in one query instead of three per subject.

    Membership is the same ``path startswith subject.path`` rule ``_sheets``
    applies, evaluated in Python against each distinct subject path length, so
    a nested subject still counts the sheets beneath it exactly as before.
    """
    counts = {path: {"total": 0, "published": 0, "draft": 0} for path in subject_paths}
    if not subject_paths:
        return counts
    lengths = sorted({len(path) for path in subject_paths})
    rows = LearningObject.objects.filter(
        current_version__content_type=LearningObjectVersion.ContentType.PDF,
        current_version__academic_node__isnull=False,
    ).values_list("current_version__academic_node__path", "workflow_status")
    for node_path, workflow_status in rows.iterator(chunk_size=2000):
        for length in lengths:
            # A slice past the end returns the whole path, which would count a
            # sheet against its own subject once per longer subject path.
            if length > len(node_path):
                break
            bucket = counts.get(node_path[:length])
            if bucket is None:
                continue
            bucket["total"] += 1
            if workflow_status == LearningObject.WorkflowStatus.PUBLISHED:
                bucket["published"] += 1
            elif workflow_status in _DRAFT_LIKE_STATUSES:
                bucket["draft"] += 1
    return counts


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


def _summary_asset(sheet: LearningObject):  # type: ignore[no-untyped-def]
    version = sheet.current_version
    if version is None:
        return None
    return next(
        (asset for asset in version.assets.all() if asset.role == LearningObjectAsset.Role.SUMMARY),
        None,
    )


def _summary_is_published(*, sheet: LearningObject, managed_file_id: UUID) -> bool:
    """Whether the published version carries this very summary file."""

    published = sheet.published_version
    if published is None:
        return False
    return LearningObjectAsset.objects.filter(
        version=published,
        role=LearningObjectAsset.Role.SUMMARY,
        managed_file_id=managed_file_id,
    ).exists()


@dataclass(frozen=True, slots=True)
class _SheetListFacts:
    """Per-sheet counts and history flags for a whole list, in a fixed number of queries.

    ``serialize_sheet`` asks the same questions one sheet at a time; a list of
    sheets used to repeat roughly ten queries per row. Each answer here is the
    same query with ``__in`` over the list, so the values are identical.
    """

    question_counts: dict[UUID, int]
    published_question_counts: dict[UUID, int]
    with_history: set[UUID]
    audited_published: set[str]
    published_summaries: set[tuple[UUID, UUID]]

    @classmethod
    def load(cls, sheets: list[LearningObject]) -> _SheetListFacts:
        ids = [sheet.id for sheet in sheets]

        def grouped(queryset: QuerySet[Question], key: str) -> dict[UUID, int]:
            return {
                row[key]: row["total"]
                for row in queryset.values(key).annotate(total=Count("id")).order_by()
            }

        def referenced(model: type[Model], field: str) -> set[UUID]:
            return set(
                model.objects.filter(**{f"{field}__in": ids})  # type: ignore[attr-defined]
                .values_list(field, flat=True)
                .distinct()
            )

        with_history = (
            referenced(LearningProgress, "learning_object_id")
            | referenced(Bookmark, "learning_object_id")
            | referenced(QuestionImportBatch, "sheet_id")
            | referenced(ActiveStudyQuestionContent, "sheet_id")
        )
        published_version_ids = [s.published_version_id for s in sheets if s.published_version_id]
        return cls(
            question_counts=grouped(
                Question.objects.filter(current_version__source_learning_object_id__in=ids),
                "current_version__source_learning_object_id",
            ),
            published_question_counts=grouped(
                Question.objects.filter(
                    published_version__source_learning_object_id__in=ids,
                    published_version__isnull=False,
                    retired_at__isnull=True,
                ),
                "published_version__source_learning_object_id",
            ),
            with_history=with_history,
            audited_published=set(
                AuditRecord.objects.filter(
                    target_type="content.learning_object",
                    target_id__in=[str(sheet_id) for sheet_id in ids],
                    new_state__workflow_status=LearningObject.WorkflowStatus.PUBLISHED,
                ).values_list("target_id", flat=True)
            ),
            published_summaries=set(
                LearningObjectAsset.objects.filter(
                    version_id__in=published_version_ids, role=LearningObjectAsset.Role.SUMMARY
                ).values_list("version_id", "managed_file_id")
            ),
        )


def serialize_sheet(
    sheet: LearningObject, *, facts: _SheetListFacts | None = None
) -> dict[str, object]:
    version = sheet.current_version
    if version is None:
        raise AdminContentRejected("The sheet has no current version.")
    asset = _primary_asset(sheet)
    summary_asset = _summary_asset(sheet)
    if facts is not None:
        question_count = facts.question_counts.get(sheet.id, 0)
        published_question_count = facts.published_question_counts.get(sheet.id, 0)
        has_history = (
            sheet.id in facts.with_history
            or question_count > 0
            or sheet.published_at is not None
            or sheet.published_version_id is not None
            or str(sheet.id) in facts.audited_published
        )
    else:
        question_count = Question.objects.filter(
            current_version__source_learning_object=sheet,
        ).count()
        # What a student in this sheet's cohort can actually open. Without it the
        # only count on screen was the drafted total, so an import saved as a
        # draft looked identical to one students can answer.
        published_question_count = Question.objects.filter(
            published_version__source_learning_object=sheet,
            published_version__isnull=False,
            retired_at__isnull=True,
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
        "published_question_count": published_question_count,
        "active_study_enabled": any(row.enabled for row in sheet.active_study_settings_set.all()),
        # Both editions in one place, so Content Studio offers the same
        # controls for each without a second serializer.
        "editions": sheet_edition_summaries(sheet=sheet),
        "can_permanently_delete": not has_history,
        "pdf": (
            {
                "file_id": str(asset.managed_file_id),
                "original_name": asset.managed_file.original_name,
                "size_bytes": asset.managed_file.size_bytes,
                "page_count": version.page_count,
                "content_type": asset.managed_file.content_type,
                "view_url": f"/api/v1/files/{asset.managed_file_id}/view",
            }
            if asset is not None
            else None
        ),
        "summary_pdf": (
            {
                "file_id": str(summary_asset.managed_file_id),
                "original_name": summary_asset.managed_file.original_name,
                "size_bytes": summary_asset.managed_file.size_bytes,
                "page_count": summary_asset.managed_file.pdf_page_count,
                "content_type": summary_asset.managed_file.content_type,
                "view_url": f"/api/v1/files/{summary_asset.managed_file_id}/view",
                # Content Studio shows the draft version; students only ever see
                # the published one.  These two say whether what is shown here is
                # the summary a student can actually open.
                "deliverable": managed_file_delivery_size(summary_asset.managed_file) is not None,
                "student_visible": (
                    (sheet.published_version_id, summary_asset.managed_file_id)
                    in facts.published_summaries
                    if facts is not None
                    else _summary_is_published(
                        sheet=sheet, managed_file_id=summary_asset.managed_file_id
                    )
                ),
            }
            if summary_asset is not None
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
        branches = list(subjects)
        study_paths = study_paths_for(branches)
        sheet_counts = _sheet_counts_by_subject_path(
            {subject.source_node.path for subject in branches if subject.source_node is not None}
        )
        results = []
        for subject in branches:
            source_node = subject.source_node
            if source_node is None:
                continue
            counts = sheet_counts[source_node.path]
            # Do not offer an empty Third Year placeholder to content staff.
            # If legacy content exists, retain access so it can be reviewed
            # rather than silently deleting or concealing real work.
            if subject.cohort.code == "year-3" and not counts["total"]:
                continue
            path = study_paths[subject.id]
            results.append(
                {
                    "id": str(subject.id),
                    "title": subject.title,
                    "path": f"catalog/{subject.material_slug}",
                    "status": "published",
                    "sheet_count": counts["total"],
                    "published_count": counts["published"],
                    "draft_count": counts["draft"],
                    "cohort_id": str(subject.cohort_id),
                    "cohort_code": subject.cohort.code,
                    "specialty_title": path.specialty_title,
                    "specialty_key": path.specialty_key,
                    "college_title": path.college_title,
                    "college_key": path.college_key,
                    "academic_year_title": path.academic_year_title,
                    "academic_year_key": path.academic_year_key,
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
        rows = list(sheets)
        facts = _SheetListFacts.load(rows)
        results = [serialize_sheet(sheet, facts=facts) for sheet in rows]
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
        summary_file = (
            get_object_or_404(ManagedFile, id=data["summary_file_id"])
            if data.get("summary_file_id") is not None
            else None
        )
        try:
            sheet = create_sheet(
                actor=_user(request),
                subject=subject,
                managed_file=managed_file,
                summary_file=summary_file,
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


class AdminSheetSummaryPdfView(_ContentPermissionView):
    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetSummaryPdfSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        managed_file = get_object_or_404(ManagedFile, id=data["summary_file_id"])
        try:
            sheet = replace_summary_pdf(
                edition=_edition(request),
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(data["expected_revision"]),
                managed_file=managed_file,
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))

    def delete(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetDeletePdfSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sheet = delete_summary_pdf(
                edition=_edition(request),
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))


class AdminSheetLockinPdfView(_ContentPermissionView):
    """The Lock-in edition's PDF, managed exactly like the university one."""

    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetLockinPdfSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        managed_file = get_object_or_404(ManagedFile, id=data["lockin_file_id"])
        try:
            sheet = replace_lockin_pdf(
                actor=_user(request),
                sheet_id=sheet_id,
                expected_revision=int(data["expected_revision"]),
                managed_file=managed_file,
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(serialize_sheet(sheet))

    def delete(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminSheetDeletePdfSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sheet = delete_lockin_pdf(
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
            LearningObject.objects.prefetch_related("active_study_settings_set"),
            id=sheet_id,
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
        )

    def get(self, request: Request, sheet_id: UUID) -> Response:
        return Response(
            active_study_payload(sheet=self._sheet(sheet_id), edition=_edition(request))
        )

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
                excluded_start_pages=data.get("excluded_start_pages"),
                excluded_end_pages=data.get("excluded_end_pages"),
                confirm_boundary_change=bool(data["confirm_boundary_change"]),
                edition=_edition(request),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        sheet = self._sheet(sheet.id)
        return Response(active_study_payload(sheet=sheet, edition=_edition(request)))


class AdminSheetActiveStudyPreviewView(_ContentPermissionView):
    """Plan unsaved page boundaries with the calculation that Save uses."""

    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = AdminActiveStudyPlanPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        sheet = get_object_or_404(
            LearningObject.objects.prefetch_related("active_study_settings_set"),
            id=sheet_id,
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
        )
        try:
            plan = active_study_plan_preview(
                sheet=sheet,
                total_pdf_pages=data.get("total_pdf_pages"),
                excluded_start_pages=data.get("excluded_start_pages"),
                excluded_end_pages=data.get("excluded_end_pages"),
                edition=_edition(request),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(plan)


class AdminSheetActiveStudyQuestionsView(_ContentPermissionView):
    def _sheet(self, sheet_id: UUID) -> LearningObject:
        return get_object_or_404(
            LearningObject.objects.prefetch_related("active_study_settings_set"),
            id=sheet_id,
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
        )

    def get(self, request: Request, sheet_id: UUID, difficulty: str) -> Response:
        try:
            return Response(
                active_study_question_content_payload(
                    sheet=self._sheet(sheet_id),
                    difficulty_key=difficulty,
                    edition=_edition(request),
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
                edition=_edition(request),
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
                edition=_edition(request),
            )
        except ActiveStudyQuestionValidationError as error:
            return Response(
                {"valid": False, "errors": error.errors}, status=status.HTTP_400_BAD_REQUEST
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(
            active_study_question_content_payload(
                sheet=self._sheet(sheet_id),
                difficulty_key=content.difficulty,
                edition=_edition(request),
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
