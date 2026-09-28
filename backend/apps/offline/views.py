"""Offline discovery follows the same cohort and publication scope as Materials."""

import hashlib
import logging
from typing import cast
from uuid import UUID

import jwt
from django.db.models import F
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.content.editions import (
    SUMMARY,
    UNIVERSITY,
    UnknownEditionError,
    annotation_document_id,
    normalize_edition,
    primary_role,
    summary_role,
)
from apps.content.models import CatalogDocument, CatalogSubject, LearningObject, LearningObjectAsset
from apps.content.views import _owned_question_sheet, _sheet_questions, _student_question
from apps.education.policies import is_content_administrator
from apps.entitlements.access_permissions import require_subscription_access
from apps.entitlements.offline_lease import issue_offline_lease, verify_offline_lease
from apps.entitlements.services import require_entitlement
from apps.files.services import managed_file_delivery_size
from apps.focus.managed_active_study import ManagedActiveStudyRuleError, offline_bundle
from apps.questions.models import Question, QuestionAnswer

from .content_versions import active_study_enabled, active_study_rows, active_study_version
from .review import review_snapshot
from .sync import replay_batch

logger = logging.getLogger("lockin.offline")
# How long after a lease ends the work recorded under it may still upload. A
# student whose subscription lapsed keeps this window to bring their progress
# back without receiving any new offline access.
SYNC_GRACE_SECONDS = 30 * 24 * 60 * 60


def _user(request: Request) -> User:
    user = request.user
    if not isinstance(user, User):
        from rest_framework.exceptions import NotAuthenticated

        raise NotAuthenticated()
    return user


def _within_subject(document: CatalogDocument, subject: CatalogSubject) -> bool:
    """A document belongs to a subject only below the subject's own node."""

    node = subject.source_node
    academic = document.version.academic_node
    return node is not None and academic is not None and academic.path.startswith(node.path)


class OfflineLeaseView(APIView):
    def get(self, request: Request) -> Response:
        return Response({"lease": issue_offline_lease(user=_user(request))})


class OfflineSyncView(APIView):
    def post(self, request: Request) -> Response:
        from rest_framework.exceptions import PermissionDenied, ValidationError

        data = request.data
        if not isinstance(data, dict) or not isinstance(data.get("operations"), list):
            raise ValidationError({"operations": ["A list is required."]})
        user = _user(request)
        try:
            claims = verify_offline_lease(
                str(data.get("lease_token") or ""), user=user, allow_expired=True
            )
        except jwt.InvalidTokenError as error:
            raise PermissionDenied(
                "A valid offline access lease is required to sync saved work."
            ) from error
        # Work can only be done offline while a lease is valid, so a lease that
        # ended long ago no longer proves anything about pending work.
        if int(cast(int, claims["exp"])) + SYNC_GRACE_SECONDS < timezone.now().timestamp():
            raise PermissionDenied("This offline access lease is too old to sync saved work.")
        result = replay_batch(user=user, operations=data["operations"])
        result["cursor"] = timezone.now().isoformat()
        return Response(result)


class OfflineQuestionsView(APIView):
    def get(self, request: Request, sheet_id: UUID) -> Response:
        from rest_framework.exceptions import ValidationError

        user = _user(request)
        require_subscription_access(user=user, entitlement_code="content.premium")
        source = request.query_params.get("source", "")
        if source not in {"exam", "ai-sheet"}:
            raise ValidationError({"source": ["Choose a published question bank."]})
        sheet, subject = _owned_question_sheet(user, sheet_id)
        questions = list(
            _sheet_questions(sheet, source)
            .select_related("published_version")
            .prefetch_related("published_version__options")
        )
        answers = {
            answer.question_id: answer
            for answer in QuestionAnswer.objects.filter(
                user=user, question__in=questions
            ).prefetch_related("version__options")
        }
        results = [_student_question(question, answers.get(question.id)) for question in questions]
        keys = {
            str(question.id): {
                "correct_choice_ids": [
                    str(option.id) for option in version.options.all() if option.is_correct
                ],
                "explanation": version.explanation,
            }
            for question in questions
            if (version := question.published_version) is not None
        }
        digest = hashlib.sha256(
            "|".join(sorted(str(question.published_version_id) for question in questions)).encode()
        ).hexdigest()
        return Response(
            {
                "sheet": {
                    "id": str(sheet.id),
                    "title": sheet.current_version.title if sheet.current_version else "",
                    "material_slug": subject.material_slug,
                    "subject_title": subject.title,
                },
                "source": source,
                "count": len(results),
                "results": results,
                "answer_keys": keys,
                "content_version": digest,
            }
        )


class OfflineActiveStudyView(APIView):
    """One edition's complete Active Study, including its answer keys."""

    def get(self, request: Request, sheet_id: UUID) -> Response:
        from rest_framework.exceptions import NotFound, ValidationError

        user = _user(request)
        require_subscription_access(user=user, entitlement_code="content.premium")
        require_entitlement(user=user, entitlement_code="focus.workspace")
        try:
            edition = normalize_edition(request.query_params.get("edition"))
        except UnknownEditionError as error:
            raise ValidationError({"edition": [str(error)]}) from error
        try:
            bundle = offline_bundle(user=user, sheet_id=sheet_id, edition=edition)
        except ManagedActiveStudyRuleError as error:
            raise NotFound(str(error)) from error
        if not bundle["difficulties"]:
            raise NotFound("Active Study is not ready for offline use.")
        published_version_id = (
            LearningObject.objects.filter(id=sheet_id)
            .values_list("published_version_id", flat=True)
            .first()
        )
        bundle["content_version"] = active_study_version(
            published_version_id=published_version_id,
            edition=edition,
            rows=active_study_rows([sheet_id]).get(sheet_id, {}),
        )
        logger.info(
            "Offline Active Study bundle read",
            extra={"user_id": str(user.pk), "difficulties": len(bundle["difficulties"])},
        )
        return Response(bundle)


class OfflineReviewView(APIView):
    """The student's Review Bank, Weekly Recall and their answer keys."""

    def get(self, request: Request) -> Response:
        user = _user(request)
        require_subscription_access(user=user, entitlement_code="content.premium")
        return Response(review_snapshot(user=user))


class OfflineManifestView(APIView):
    def get(self, request: Request) -> Response:
        user = _user(request)
        require_subscription_access(user=user, entitlement_code="content.premium")
        subjects = CatalogSubject.objects.filter(is_active=True).select_related(
            "cohort__program", "source_node"
        )
        if not is_content_administrator(user):
            if user.cohort is None or not user.cohort.is_active:
                return Response({"version": 1, "subjects": [], "items": []})
            subjects = subjects.filter(cohort_id=user.cohort_id)
        subject_list = list(subjects.order_by("cohort__position", "position", "id"))
        slugs = [subject.material_slug for subject in subject_list]
        documents = list(
            CatalogDocument.objects.filter(
                material_slug__in=slugs,
                is_active=True,
                version__learning_object__published_version_id=F("version_id"),
                version__learning_object__archived_at__isnull=True,
            ).select_related("version__academic_node", "version__learning_object", "managed_file")
        )
        assets = LearningObjectAsset.objects.filter(
            version_id__in=[d.version_id for d in documents]
        ).select_related("managed_file")
        asset_index = {(asset.version_id, asset.role): asset for asset in assets}
        subject_index = {subject.material_slug: subject for subject in subject_list}
        items = []
        sheet_items: dict[tuple[UUID, str], tuple[CatalogDocument, CatalogSubject, str]] = {}
        for document in documents:
            subject = subject_index.get(document.material_slug)
            if subject is None or not _within_subject(document, subject):
                continue
            for kind, role in (
                ("sheet", primary_role(document.edition)),
                ("summary", summary_role(document.edition)),
            ):
                asset = asset_index.get((document.version_id, role))
                if asset is None and kind == "summary" and document.edition != UNIVERSITY:
                    asset = asset_index.get((document.version_id, summary_role(UNIVERSITY)))
                file = (
                    document.managed_file
                    if kind == "sheet"
                    else asset.managed_file
                    if asset
                    else None
                )
                if file is None or managed_file_delivery_size(file) is None:
                    continue
                items.append(
                    {
                        "id": f"{document.id}:{kind}",
                        "type": kind,
                        "document_id": str(document.id)
                        if kind == "sheet"
                        else str(
                            annotation_document_id(
                                learning_object_id=document.version.learning_object_id,
                                edition=UNIVERSITY
                                if asset and asset.role == summary_role(UNIVERSITY)
                                else document.edition,
                                view=SUMMARY,
                            )
                        ),
                        "document_version_id": str(document.version_id),
                        "material_slug": document.material_slug,
                        "sheet_slug": document.sheet_slug,
                        "subject_id": str(subject.id),
                        "sheet_id": str(document.version.learning_object_id),
                        "edition": document.edition,
                        "title": document.version.title,
                        "version": document.version.version_number,
                        "updated_at": document.updated_at.isoformat(),
                        "size": file.size_bytes,
                        "checksum": file.checksum_sha256,
                        "download_url": f"/api/v1/files/{file.id}/view",
                        "dependencies": [],
                        "available": True,
                    }
                )
                if kind == "sheet":
                    sheet_items[(document.version.learning_object_id, document.edition)] = (
                        document,
                        subject,
                        f"{document.id}:sheet",
                    )
        sheet_subjects = {
            document.version.learning_object_id: subject_index[document.material_slug]
            for document in documents
            if document.material_slug in subject_index
            and _within_subject(document, subject_index[document.material_slug])
        }
        question_rows = Question.objects.filter(
            published_version__source_learning_object_id__in=sheet_subjects,
            published_version__isnull=False,
            retired_at__isnull=True,
        ).values(
            "published_version__source_learning_object_id",
            "published_version_id",
            "published_version__metadata",
        )
        banks: dict[tuple[UUID, str], list[str]] = {}
        for row in question_rows:
            source = (
                "exam" if row["published_version__metadata"].get("source") == "exam" else "ai-sheet"
            )
            key = (row["published_version__source_learning_object_id"], source)
            banks.setdefault(key, []).append(str(row["published_version_id"]))
        for (sheet_id, source), version_ids in banks.items():
            digest = hashlib.sha256("|".join(sorted(version_ids)).encode()).hexdigest()
            subject = sheet_subjects[sheet_id]
            items.append(
                {
                    "id": f"questions:{sheet_id}:{source}",
                    "type": "questions",
                    "subject_id": str(subject.id),
                    "sheet_id": str(sheet_id),
                    "source": source,
                    "title": source,
                    "version": digest,
                    "updated_at": None,
                    "size": None,
                    "checksum": digest,
                    "download_url": f"/api/v1/offline/questions/{sheet_id}/?source={source}",
                    "dependencies": [],
                    "available": True,
                }
            )
        # Active Study depends on the edition's PDF: the device marks it offline
        # ready only when both the bundle and that exact PDF are stored.
        study_rows = active_study_rows({sheet_id for sheet_id, _ in sheet_items})
        for (sheet_id, edition), (document, subject, pdf_item) in sheet_items.items():
            rows = study_rows.get(sheet_id)
            if rows is None or not active_study_enabled(rows, edition):
                continue
            version = active_study_version(
                published_version_id=document.version_id, edition=edition, rows=rows
            )
            items.append(
                {
                    "id": f"active_study:{sheet_id}:{edition}",
                    "type": "active_study",
                    "subject_id": str(subject.id),
                    "sheet_id": str(sheet_id),
                    "material_slug": document.material_slug,
                    "sheet_slug": document.sheet_slug,
                    "edition": edition,
                    "title": document.version.title,
                    "version": version,
                    "updated_at": None,
                    "size": None,
                    "checksum": version,
                    "download_url": f"/api/v1/offline/active-study/{sheet_id}/?edition={edition}",
                    "dependencies": [pdf_item],
                    "available": True,
                }
            )
        logger.info("Offline manifest read", extra={"user_id": str(user.pk), "items": len(items)})
        return Response(
            {
                "version": 1,
                "subjects": [
                    {
                        "id": str(s.id),
                        "title": s.title,
                        "material_slug": s.material_slug,
                        "cohort": s.cohort.code,
                        "program": s.cohort.program.code,
                    }
                    for s in subject_list
                ],
                "items": items,
            }
        )
