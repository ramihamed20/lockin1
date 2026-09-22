import hashlib
import json
from typing import Any, cast
from uuid import UUID

from django.conf import settings
from django.db import models, transaction
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
from apps.education.policies import is_content_administrator
from apps.entitlements.services import require_entitlement
from apps.files.models import ManagedFile
from apps.files.services import (
    managed_file_delivery_ready,
    managed_file_delivery_size,
)
from apps.focus.selectors import annotation_collection_revision
from apps.focus.services import touch_reading_session
from apps.questions.answering import XP_BY_DIFFICULTY, AnswerRejected, answer_question
from apps.questions.models import Question, QuestionAnswer, QuestionVersion
from apps.xp.models import XpBalance

from .active_study_readiness import readiness_payload
from .admin_services import archive_catalog_learning_object, publish_catalog_learning_object
from .edition_documents import edition_asset
from .editions import (
    STUDY,
    UNIVERSITY,
    UnknownEditionError,
    annotation_document_id,
    edition_label,
    normalize_view,
    primary_role,
    summary_role,
)
from .models import (
    CatalogDocument,
    CatalogSubject,
    CatalogWorkspaceReceipt,
    CatalogWorkspaceSnapshot,
    LearningObject,
    LearningObjectVersion,
)
from .policies import can_view_learning_object
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
    create_learning_object,
    reject_learning_object,
    revise_learning_object,
    submit_for_review,
    transfer_learning_object,
)


class ContentConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This content changed. Reload it and try again."
    default_code = "revision_conflict"


class AnswerInvalid(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "answer_rejected"


class ContentRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "content_rule_rejected"


class CatalogWorkspaceConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Catalog workspace changed. Reload and merge before saving."
    default_code = "catalog_workspace_conflict"


class CatalogFileUnavailable(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This sheet is published, but its file is currently unavailable."
    default_code = "file_unavailable"


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


def _catalog_document(*, user: User, material_slug: str, sheet_slug: str) -> CatalogDocument:
    require_entitlement(user=user, entitlement_code="focus.workspace")
    try:
        document = CatalogDocument.objects.select_related(
            "version__learning_object", "managed_file"
        ).get(material_slug=material_slug, sheet_slug=sheet_slug, is_active=True)
    except CatalogDocument.DoesNotExist as error:
        raise NotFound("Catalog document not found.") from error
    version = document.version
    if (
        version.content_type != version.ContentType.PDF
        or document.managed_file_id
        not in version.assets.filter(role=primary_role(document.edition)).values_list(
            "managed_file_id", flat=True
        )
        or version.learning_object.published_version_id != version.id
        or not can_view_learning_object(user=user, learning_object=version.learning_object)
    ):
        raise PermissionDenied("You cannot access this catalog document.")
    if managed_file_delivery_size(document.managed_file) is None:
        raise CatalogFileUnavailable()
    return document


class CatalogDocumentResolveView(APIView):
    """Resolve one reader address to the exact file behind it.

    ``view=summary`` resolves the Sheet Summary of the same edition. It is the
    same reader, the same delivery path and the same annotation storage; only
    the file differs, so it resolves here rather than through a second endpoint.
    """

    def get(self, request: Request, material_slug: str, sheet_slug: str) -> Response:
        document = _catalog_document(
            user=_user(request), material_slug=material_slug, sheet_slug=sheet_slug
        )
        try:
            view = normalize_view(request.query_params.get("view"))
        except UnknownEditionError as error:
            raise ContentRejected(str(error)) from error
        if view == STUDY:
            return Response(
                {
                    "document": {
                        "id": str(document.id),
                        "document_version_id": str(document.version_id),
                        "file_id": str(document.managed_file_id),
                        "view_url": f"/api/v1/files/{document.managed_file_id}/view",
                    }
                }
            )
        asset, owning_edition = edition_asset(
            version=document.version, edition=document.edition, view=view
        )
        if asset is None:
            raise NotFound("This sheet has no summary.")
        if managed_file_delivery_size(asset.managed_file) is None:
            raise CatalogFileUnavailable()
        return Response(
            {
                "document": {
                    # The identity the server stores this document's marks
                    # under, so the reader's local cache is scoped to the same
                    # document the server is.
                    "id": str(
                        annotation_document_id(
                            learning_object_id=document.version.learning_object_id,
                            edition=owning_edition,
                            view=view,
                        )
                    ),
                    "document_version_id": str(document.version_id),
                    "file_id": str(asset.managed_file_id),
                    "view_url": f"/api/v1/files/{asset.managed_file_id}/view",
                }
            }
        )


def _published_documents_by_subject(
    subjects: list[CatalogSubject],
) -> dict[UUID, list[CatalogDocument]]:
    """Fetch every branch's published sheets in one query, grouped by subject.

    This used to be one query per subject inside the response loop. A founder is
    not cohort-scoped and so receives every branch in the deployment, which made
    the directory's cost grow with the curriculum -- and this endpoint is
    re-fetched on each step from Materials to a sheet.

    The pairing is on both ``material_slug`` and the subject's source node, which
    is what the per-subject query compared, so a document filed under a route key
    that no longer belongs to its node is still excluded rather than attributed
    to the wrong branch.
    """

    if not subjects:
        return {}
    scoped_subjects = [
        (subject, subject.source_node) for subject in subjects if subject.source_node is not None
    ]
    if not scoped_subjects:
        return {subject.id: [] for subject in subjects}
    condition = models.Q()
    for subject, source_node in scoped_subjects:
        condition |= models.Q(
            material_slug=subject.material_slug,
            version__academic_node__path__startswith=source_node.path,
        )
    documents = (
        CatalogDocument.objects.filter(condition)
        .filter(
            is_active=True,
            version__learning_object__published_version_id=models.F("version_id"),
            version__learning_object__archived_at__isnull=True,
        )
        .select_related(
            "managed_file",
            "version__academic_node",
        )
        .prefetch_related("version__learning_object__active_study_settings_set")
        .prefetch_related("version__learning_object__active_study_question_content")
        .prefetch_related("version__assets__managed_file")
        .order_by("version__learning_object__position", "sheet_slug", "id")
    )
    grouped: dict[UUID, list[CatalogDocument]] = {subject.id: [] for subject in subjects}
    for document in documents:
        subject_id = next(
            (
                subject.id
                for subject, source_node in scoped_subjects
                if subject.material_slug == document.material_slug
                and document.version.academic_node.path.startswith(source_node.path)
            ),
            None,
        )
        if subject_id is not None:
            grouped[subject_id].append(document)
    return grouped


def _sheet_edition(*, document: CatalogDocument) -> dict[str, object]:
    """One edition of one sheet, in the shape the sheet itself already had.

    Both editions are described by the same function, which is what keeps the
    Lock-in edition identical in capability to the university edition without a
    second code path for any of it.
    """

    version = document.version
    edition = document.edition
    summary_asset = next(
        (asset for asset in version.assets.all() if asset.role == summary_role(edition)),
        None,
    )
    if summary_asset is None and edition != UNIVERSITY:
        # An edition without its own summary falls back to the sheet's, which is
        # prose about the same material rather than page-indexed content.
        summary_asset = next(
            (asset for asset in version.assets.all() if asset.role == summary_role(UNIVERSITY)),
            None,
        )
    primary_asset = next(
        (asset for asset in version.assets.all() if asset.role == primary_role(edition)),
        None,
    )
    readiness = readiness_payload(sheet=version.learning_object, edition=edition)
    active_ready = any(
        cast(dict[str, object], item["readiness"])["ready"] is True
        for item in cast(list[dict[str, object]], readiness["difficulties"])
    )
    summary_deliverable = summary_asset is not None and managed_file_delivery_ready(
        summary_asset.managed_file
    )
    page_count = (
        version.page_count
        if edition == UNIVERSITY
        else (primary_asset.managed_file.pdf_page_count if primary_asset else None)
    )
    return {
        "edition": edition,
        "label": edition_label(edition),
        "slug": document.sheet_slug,
        "summaryPdf": (
            {
                "viewUrl": f"/api/v1/files/{summary_asset.managed_file_id}/view",
                "pageCount": summary_asset.managed_file.pdf_page_count,
            }
            if summary_asset is not None and summary_deliverable
            else None
        ),
        # "Not uploaded" and "uploaded but not deliverable yet" are different
        # problems, and the student is told which.
        "summaryStatus": (
            "available"
            if summary_deliverable
            else "processing"
            if summary_asset is not None
            else "missing"
        ),
        "pageCount": page_count if isinstance(page_count, int) and page_count > 0 else None,
        # ``enabled`` already accounts for a Lock-in edition that shares the
        # University Sheet's settings and question bank.
        "hasActiveStudy": bool(readiness["enabled"] and active_ready),
        "deliverable": managed_file_delivery_ready(document.managed_file),
    }


class CatalogMaterialListView(APIView):
    """The one student-facing Materials directory.

    The response is built from CatalogSubject, not display-name matching or a
    browsed education tree.  The current cohort is the only ordinary-student
    scope; content operators deliberately see every branch for management.
    """

    def get(self, request: Request) -> Response:
        user = _user(request)
        subjects = CatalogSubject.objects.filter(is_active=True).select_related(
            "cohort__program", "source_node"
        )
        if not is_content_administrator(user):
            cohort = user.cohort
            if cohort is None or not cohort.is_active:
                return Response({"count": 0, "results": []})
            subjects = subjects.filter(cohort_id=cohort.id)
        branches = list(
            subjects.order_by(
                "cohort__program__position", "cohort__position", "position", "title", "id"
            )
        )
        documents_by_subject = _published_documents_by_subject(branches)
        results = []
        for subject in branches:
            documents = documents_by_subject.get(subject.id, [])
            # Third Year is intentionally unavailable until its curriculum is
            # configured.  Keep any real legacy material visible for review;
            # only suppress an empty placeholder branch.
            #
            # Every other branch is returned whether or not it holds a sheet. A
            # subject exists because the student's cohort owns it, never because
            # something has been published into it.
            if subject.cohort.code == "year-3" and not documents:
                continue
            # One sheet can be published in two editions. They are grouped so a
            # student sees one sheet and chooses which PDF to open, instead of
            # the same material appearing twice in the directory.
            by_sheet: dict[UUID, list[CatalogDocument]] = {}
            for document in documents:
                by_sheet.setdefault(document.version.learning_object_id, []).append(document)
            sheets = []
            for number, (_, editions) in enumerate(by_sheet.items(), start=1):
                university = next(
                    (item for item in editions if item.edition == UNIVERSITY), editions[0]
                )
                rows = [_sheet_edition(document=item) for item in editions]
                rows.sort(key=lambda row: 0 if row["edition"] == UNIVERSITY else 1)
                primary = next(
                    (row for row in rows if row["edition"] == university.edition), rows[0]
                )
                sheets.append(
                    {
                        "slug": university.sheet_slug,
                        "learningObjectId": str(university.version.learning_object_id),
                        "number": number,
                        "title": university.version.title,
                        # The university edition stays the shape every existing
                        # client reads; ``editions`` adds the choice beside it.
                        "summaryPdf": primary["summaryPdf"],
                        "summaryStatus": primary["summaryStatus"],
                        "pageCount": primary["pageCount"],
                        "hasActiveStudy": primary["hasActiveStudy"],
                        "deliverable": primary["deliverable"],
                        "editions": rows,
                    }
                )
            results.append(
                {
                    "slug": subject.material_slug,
                    "title": subject.title,
                    "sheets": sheets,
                    "cohort": {
                        "program_code": subject.cohort.program.code,
                        "cohort_code": subject.cohort.code,
                        "name": subject.cohort.name_en,
                    },
                }
            )
        return Response({"count": len(results), "results": results})


def _catalog_subjects_for(user: User) -> list[CatalogSubject]:
    """The Catalog branches this reader owns, in directory order.

    This is the same scope Materials resolves, which is the point: Questions is
    a second view of one catalog, not a catalog of its own. A sheet appears in
    Questions because the reader's cohort owns the subject it already sits
    under, so there is never a separate question sheet to keep in step.
    """

    subjects = CatalogSubject.objects.filter(is_active=True).select_related(
        "cohort__program", "source_node"
    )
    if not is_content_administrator(user):
        cohort = user.cohort
        if cohort is None or not cohort.is_active:
            return []
        subjects = subjects.filter(cohort_id=cohort.id)
    return list(
        subjects.exclude(source_node__isnull=True).order_by(
            "cohort__program__position", "cohort__position", "position", "title", "id"
        )
    )


def _subject_for_path(subjects: list[CatalogSubject], path: str) -> CatalogSubject | None:
    """The one branch containing this academic path.

    The longest matching prefix wins, so a subject nested under another branch
    is attributed to itself rather than to its ancestor.
    """

    best: CatalogSubject | None = None
    best_depth = -1
    for subject in subjects:
        source_node = subject.source_node
        if source_node is None or not path.startswith(source_node.path):
            continue
        depth = len(source_node.path)
        if depth > best_depth:
            best, best_depth = subject, depth
    return best


def _published_question_counts(subjects: list[CatalogSubject]) -> dict[UUID, int]:
    """Published, unretired question counts per sheet, for these branches only.

    One query for the whole directory: a reader who is not cohort-scoped
    receives every branch in the deployment, and a count per sheet would
    otherwise make this endpoint's cost grow with the curriculum.
    """

    if not subjects:
        return {}
    condition = models.Q()
    for subject in subjects:
        source_node = subject.source_node
        if source_node is not None:
            condition |= models.Q(
                published_version__academic_node__path__startswith=source_node.path
            )
    rows = (
        Question.objects.filter(condition)
        .filter(
            published_version__isnull=False,
            retired_at__isnull=True,
            published_version__source_learning_object__isnull=False,
        )
        .values("published_version__source_learning_object")
        .annotate(total=models.Count("id"))
    )
    return {
        cast(UUID, row["published_version__source_learning_object"]): int(row["total"])
        for row in rows
    }


def _question_sheets_by_subject(
    subjects: list[CatalogSubject],
) -> dict[UUID, list[LearningObject]]:
    """Every live sheet under these branches, grouped by branch.

    Grouping is by the sheet's own academic path, so a sheet is attributed to
    the one branch that contains it. A year's questions therefore cannot reach
    another year: a sheet belongs to exactly one subject, and a subject to
    exactly one cohort.
    """

    if not subjects:
        return {}
    condition = models.Q()
    for subject in subjects:
        source_node = subject.source_node
        if source_node is not None:
            condition |= models.Q(current_version__academic_node__path__startswith=source_node.path)
    sheets = (
        LearningObject.objects.filter(condition)
        .filter(current_version__isnull=False, archived_at__isnull=True)
        .select_related("current_version__academic_node")
        .order_by("position", "current_version__title", "id")
    )
    grouped: dict[UUID, list[LearningObject]] = {subject.id: [] for subject in subjects}
    for sheet in sheets:
        version = sheet.current_version
        if version is None:
            continue
        owner = _subject_for_path(subjects, version.academic_node.path)
        if owner is not None:
            grouped[owner.id].append(sheet)
    return grouped


class CatalogQuestionMaterialListView(APIView):
    """The Questions directory: the reader's own subjects and their sheets.

    A sheet is listed once it has at least one published question, because a
    sheet with none is a Materials entry rather than a question set. The names
    are the sheet's own, so a student and an administrator always see the same
    sheet under the same title.
    """

    def get(self, request: Request) -> Response:
        user = _user(request)
        subjects = _catalog_subjects_for(user)
        counts = _published_question_counts(subjects)
        sheets_by_subject = _question_sheets_by_subject(subjects)
        results = []
        for subject in subjects:
            sheets: list[dict[str, object]] = []
            subject_total = 0
            for number, sheet in enumerate(sheets_by_subject.get(subject.id, []), start=1):
                total = counts.get(sheet.id, 0)
                if not total:
                    continue
                version = sheet.current_version
                subject_total += total
                sheets.append(
                    {
                        "id": str(sheet.id),
                        "slug": str(sheet.id),
                        "number": number,
                        "title": version.title if version is not None else "Sheet",
                        "questionCount": total,
                    }
                )
            if not sheets:
                continue
            results.append(
                {
                    "slug": subject.material_slug,
                    "title": subject.title,
                    "sheets": sheets,
                    "questionCount": subject_total,
                }
            )
        return Response({"count": len(results), "results": results})


def _owned_question_sheet(user: User, sheet_id: UUID) -> tuple[LearningObject, CatalogSubject]:
    """The sheet, if the reader's own cohort owns the subject it sits under."""

    sheet = get_object_or_404(
        LearningObject.objects.select_related("current_version__academic_node"),
        id=sheet_id,
        archived_at__isnull=True,
    )
    version = sheet.current_version
    if version is None:
        raise NotFound("This sheet has no current version.")
    subject = _subject_for_path(_catalog_subjects_for(user), version.academic_node.path)
    # Not "no questions": a sheet outside the reader's own cohort is a sheet
    # they were never offered, and answering with an empty list would hide a
    # misconfiguration behind something that looks normal.
    if subject is None:
        raise PermissionDenied("You cannot access this sheet's questions.")
    return sheet, subject


def _sheet_questions(sheet: LearningObject) -> models.QuerySet[Question]:
    """Published, unretired questions only: a draft never reaches a student."""

    return (
        Question.objects.filter(
            published_version__source_learning_object=sheet,
            published_version__isnull=False,
            retired_at__isnull=True,
        )
        .select_related("published_version")
        .prefetch_related("published_version__options")
        .order_by("published_version__source_page", "created_at", "id")
    )


def _answer_payload(answer: QuestionAnswer) -> dict[str, object]:
    """The graded result, revealed from the version the student answered."""

    options = list(answer.version.options.all())
    return {
        "selected_choice_ids": [str(item) for item in answer.selected_option_ids],
        "correct_choice_ids": [str(option.id) for option in options if option.is_correct],
        "is_correct": answer.is_correct,
        "explanation": answer.version.explanation,
        "xp_awarded": answer.xp_awarded,
        "answered_at": answer.answered_at.isoformat(),
    }


def _student_question(question: Question, answer: QuestionAnswer | None) -> dict[str, object]:
    """A question as a student sees it.

    Correctness and the explanation are withheld until the server has graded
    the student's own answer: the answer is decided here, so the payload must
    not carry it to a client that could read it first.
    """

    published = cast(QuestionVersion, question.published_version)
    return {
        "id": str(question.id),
        "question_type": published.question_type,
        "prompt": published.prompt,
        "topic": published.topic,
        "difficulty": published.difficulty,
        "xp_value": XP_BY_DIFFICULTY.get(published.difficulty, 0),
        "source_page": published.source_page,
        "choices": [
            {"id": str(option.id), "text": option.text, "position": option.position}
            for option in published.options.all()
        ],
        "answer": _answer_payload(answer) if answer is not None else None,
    }


class CatalogSheetQuestionListView(APIView):
    """One Material sheet's published questions, for the reader who owns it."""

    def get(self, request: Request, sheet_id: UUID) -> Response:
        # Subscription access is not checked here on purpose: every route in
        # this app already passes through SubscriptionProtectedPermission, which
        # gates the whole content domain on ``content.premium`` and reconciles
        # the trial a newly verified account should hold. A second check here
        # would be the same test written twice, and the weaker of the two.
        user = _user(request)
        sheet, subject = _owned_question_sheet(user, sheet_id)
        questions = [
            question
            for question in _sheet_questions(sheet)
            if question.published_version is not None
        ]
        answers = {
            answer.question_id: answer
            for answer in QuestionAnswer.objects.filter(
                user=user, question__in=questions
            ).prefetch_related("version__options")
        }
        results = [_student_question(question, answers.get(question.id)) for question in questions]
        version = cast(LearningObjectVersion, sheet.current_version)
        return Response(
            {
                "sheet": {
                    "id": str(sheet.id),
                    "title": version.title,
                    "material_slug": subject.material_slug,
                    "subject_title": subject.title,
                },
                "count": len(results),
                "answered": len(answers),
                "results": results,
            }
        )


class CatalogSheetQuestionAnswerView(APIView):
    """Grade one answer, once, and award its XP on the server.

    Repeating the request is safe by construction: the recorded answer is
    returned with ``created`` false and no second award is made.
    """

    def post(self, request: Request, sheet_id: UUID, question_id: UUID) -> Response:
        user = _user(request)
        sheet, _ = _owned_question_sheet(user, sheet_id)
        question = get_object_or_404(_sheet_questions(sheet), id=question_id)
        raw = request.data.get("choice_ids") if isinstance(request.data, dict) else None
        if not isinstance(raw, list) or not raw:
            raise AnswerInvalid("Choose an answer.")
        try:
            choice_ids = [UUID(str(item)) for item in raw]
        except ValueError as error:
            raise AnswerInvalid("That choice does not belong to this question.") from error
        try:
            answer, created = answer_question(user=user, question=question, choice_ids=choice_ids)
        except AnswerRejected as error:
            raise AnswerInvalid(str(error)) from error
        balance = XpBalance.objects.filter(user=user).first()
        return Response(
            {
                "question_id": str(question.id),
                "created": created,
                "answer": _answer_payload(answer),
                "xp_total": balance.total_points if balance is not None else 0,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CatalogWorkspaceView(APIView):
    def get(self, request: Request, document_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        # The revision of this edition's own collection: a Lock-in reader must
        # not be told the University document changed, or the other way round.
        collection_revision = annotation_collection_revision(
            user_id=user.id,
            document_id=annotation_document_id(
                learning_object_id=document.version.learning_object_id,
                edition=document.edition,
                view=STUDY,
            ),
        )
        if request.query_params.get("probe") == "1":
            workspace_revision = (
                CatalogWorkspaceSnapshot.objects.filter(user=user, document=document)
                .values_list("revision", flat=True)
                .first()
                or 0
            )
            return Response(
                {
                    "revision": workspace_revision,
                    "collection_revision": collection_revision,
                    "document_version_id": str(document.version_id),
                    "checksum_sha256": document.managed_file.checksum_sha256,
                }
            )
        workspace, _ = CatalogWorkspaceSnapshot.objects.get_or_create(user=user, document=document)
        return Response(
            {
                "revision": workspace.revision,
                "collection_revision": collection_revision,
                "document_version_id": str(document.version_id),
                "checksum_sha256": document.managed_file.checksum_sha256,
                "state": workspace.state,
            }
        )

    def patch(self, request: Request, document_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        expected = request.data.get("expected_revision")
        key = request.data.get("idempotency_key")
        state = request.data.get("state")
        if (
            not isinstance(expected, int)
            or expected < 0
            or not isinstance(key, str)
            or not isinstance(state, dict)
        ):
            raise ContentRejected("A revision, idempotency key, and workspace state are required.")
        try:
            key_uuid = UUID(key)
        except ValueError as error:
            raise ContentRejected("The idempotency key is invalid.") from error
        encoded = json.dumps(
            {"expected": expected, "state": state}, sort_keys=True, separators=(",", ":")
        ).encode()
        digest = hashlib.sha256(encoded).hexdigest()
        with transaction.atomic():
            workspace, _ = CatalogWorkspaceSnapshot.objects.select_for_update().get_or_create(
                user=user, document=document
            )
            receipt = CatalogWorkspaceReceipt.objects.filter(
                workspace=workspace, idempotency_key=key_uuid
            ).first()
            if receipt:
                if receipt.request_digest != digest:
                    raise ContentRejected("The idempotency key was reused for another request.")
                return Response({**receipt.response_payload, "replayed": True})
            if workspace.revision != expected:
                raise CatalogWorkspaceConflict()
            workspace.state = state
            workspace.revision += 1
            workspace.save(update_fields=("state", "revision", "updated_at"))
            payload = {"revision": workspace.revision, "state": workspace.state, "replayed": False}
            CatalogWorkspaceReceipt.objects.create(
                workspace=workspace,
                idempotency_key=key_uuid,
                request_digest=digest,
                response_payload=payload,
            )
        # The reader is demonstrably still on this document. Carrying that onto
        # its Focus session is what lets a sitting be measured if the reader
        # never closes the tab, and it is the only continuous evidence of
        # reading the server receives.
        touch_reading_session(user=user, document_version_id=document.version_id)
        return Response(payload)


def _catalog_document_by_id(*, user: User, document_id: UUID) -> CatalogDocument:
    try:
        document = CatalogDocument.objects.get(id=document_id)
    except CatalogDocument.DoesNotExist as error:
        raise NotFound("Catalog document not found.") from error
    return _catalog_document(
        user=user, material_slug=document.material_slug, sheet_slug=document.sheet_slug
    )


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
        position=int(data.get("position", 0)),
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
        # Querying another cohort's node must not expose sheet titles, files or
        # question-bearing metadata.  File delivery has its own gate, but the
        # catalogue itself is an access surface too.
        user = _user(self.request)
        candidates = published_learning_objects(node_id=node_id, content_type=content_type)
        if not getattr(settings, "COHORT_CONTENT_ENFORCEMENT", False):
            return candidates
        allowed_ids = [
            item.id
            for item in candidates
            if can_view_learning_object(user=user, learning_object=item)
        ]
        return candidates.filter(id__in=allowed_ids)

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
        if not can_view_learning_object(user=_user(request), learning_object=learning_object):
            raise PermissionDenied("You do not have access to this learning content.")
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
    service_action = staticmethod(submit_for_review)

    def post(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = RevisionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = self.service_action(
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
    service_action = staticmethod(submit_for_review)


class PublishLearningObjectView(_RevisionActionView):
    service_action = staticmethod(publish_catalog_learning_object)


class ArchiveLearningObjectView(_RevisionActionView):
    service_action = staticmethod(archive_catalog_learning_object)


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
