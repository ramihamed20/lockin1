import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, cast
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.content.models import ActiveStudyQuestionContent, CatalogDocument
from apps.content.views import _catalog_document_by_id
from apps.focus.models import ActiveStudyAnswer
from apps.review.models import ReviewAnswerLog

from .models import (
    ArtifactReceipt,
    ConceptSource,
    ExplainAttempt,
    ExplainQuestion,
    McqConceptLink,
    StudentArtifact,
    StudyToolSettings,
)


class KnowledgeConflict(APIException):
    status_code = 409
    default_code = "knowledge_conflict"
    default_detail = "A newer copy exists. Your local work has been kept."


def document_for(user: User, document_id: UUID) -> CatalogDocument:
    # Reuse the reader's cohort/publication/file/entitlement policy.
    return _catalog_document_by_id(user=user, document_id=document_id)


def require_enabled() -> None:
    if not settings.KNOWLEDGE_ENABLED:
        raise PermissionDenied("Study tools are not enabled.")


def tool_flags(document: CatalogDocument) -> dict[str, bool]:
    config = StudyToolSettings.objects.filter(sheet_id=document.version.learning_object_id).first()
    return {
        "summary": config.summary_enabled if config else True,
        "map": config.map_enabled if config else True,
        "explain": config.explain_enabled if config else True,
        "ai_evaluation": False,
        "ai_maps": False,
    }


def sources_for(document: CatalogDocument) -> QuerySet[ConceptSource]:
    return ConceptSource.objects.filter(
        document=document,
        source_version_id=document.version_id,
        source_file_id=document.managed_file_id,
        concept__published=True,
        concept__sheet_id=document.version.learning_object_id,
    ).select_related("concept")


def artifact_payload(
    item: StudentArtifact, document: CatalogDocument, *, include_content: bool = True
) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "kind": item.kind,
        "title": item.title,
        "document_id": str(item.document_id),
        "source_version_id": str(item.source_version_id),
        "source_file_id": str(item.source_file_id),
        "source_title": item.source_version.title,
        "source_version_number": item.source_version.version_number,
        "source_edition": item.document.edition,
        "page_start": item.page_start,
        "page_end": item.page_end,
        "content": item.content if include_content else None,
        "linked_concept_ids": item.linked_concept_ids,
        "revision": item.revision,
        "deleted": item.deleted,
        "updated_at": item.updated_at.isoformat(),
        "stale": item.document_id != document.id
        or item.source_version_id != document.version_id
        or item.source_file_id != document.managed_file_id,
    }


def own_artifacts(user: User, document: CatalogDocument) -> QuerySet[StudentArtifact]:
    return StudentArtifact.objects.filter(
        owner=user,
        source_version__learning_object_id=document.version.learning_object_id,
    ).order_by("-updated_at")


@transaction.atomic
def save_artifact(
    user: User, document: CatalogDocument, artifact_id: UUID, data: dict[str, Any]
) -> dict[str, Any]:
    require_enabled()
    if data["account_id"] != user.id:
        raise PermissionDenied("This save belongs to another signed-in account.")
    if not tool_flags(document)[data["kind"]]:
        raise PermissionDenied("This tool is disabled for this sheet.")
    # Lock a row which exists even for the first save. Also serializes account quotas and receipts.
    User.objects.select_for_update().get(pk=user.pk)
    # Publication can replace the catalog alias while a request is in flight.
    document.refresh_from_db()
    digest = hashlib.sha256(
        json.dumps(
            {"artifact_id": str(artifact_id), "document_id": str(document.id), **data},
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()
    receipt = ArtifactReceipt.objects.filter(owner=user, mutation_id=data["mutation_id"]).first()
    if receipt:
        if receipt.digest != digest:
            raise KnowledgeConflict("This save identifier was already used for different content.")
        response = dict(cast(dict[str, Any], receipt.response))
        response["content"] = {} if response["deleted"] else data["content"]
        return response
    item = StudentArtifact.objects.filter(pk=artifact_id).first()
    if item and (
        item.owner_id != user.pk
        or item.source_version.learning_object_id != document.version.learning_object_id
    ):
        raise NotFound()
    if item:
        if item.revision != data["expected_revision"] or item.kind != data["kind"]:
            raise KnowledgeConflict()
        if item.deleted and not data["deleted"]:
            raise KnowledgeConflict("This document was deleted. Export or save a new copy.")
        if item.source_version_id != data["source_version_id"] or (
            item.source_file_id != data["source_file_id"]
        ):
            raise KnowledgeConflict("The source of this work cannot be changed.")
    else:
        if data["expected_revision"] != 0:
            raise KnowledgeConflict()
        if data["source_version_id"] != document.version_id or (
            data["source_file_id"] != document.managed_file_id
        ):
            raise KnowledgeConflict(
                "The PDF changed. Your draft still refers to its earlier version."
            )
        if own_artifacts(user, document).count() >= 100:
            raise ValidationError("This notebook has reached its 100 document limit.")
        if StudentArtifact.objects.filter(owner=user).count() >= 500:
            raise ValidationError("The account document limit has been reached.")
        item = StudentArtifact(
            id=artifact_id,
            owner=user,
            document=document,
            source_version_id=document.version_id,
            source_file_id=document.managed_file_id,
            kind=data["kind"],
            revision=0,
        )
    count = item.source_file.pdf_page_count
    if count and data["page_end"] > count:
        raise ValidationError("The page range exceeds this source version.")
    linked = set(data["content"].get("concept_ids", []))
    linked.update(
        node.get("concept_id")
        for node in data["content"].get("nodes", [])
        if (node.get("concept_id"))
    )
    allowed = {str(value) for value in sources_for(document).values_list("concept_id", flat=True)}
    # Existing historical links remain valid, but cannot be used to add foreign concepts.
    previous = set(item.content.get("concept_ids", []))
    previous.update(
        node.get("concept_id") for node in item.content.get("nodes", []) if (node.get("concept_id"))
    )
    if linked - allowed - previous:
        raise ValidationError("Concept links must belong to this sheet.")
    for field in ("title", "page_start", "page_end", "content", "deleted"):
        setattr(item, field, data[field])
    item.linked_concept_ids = sorted(linked)
    if item.deleted:
        item.content = {}
        item.title = ""
        item.linked_concept_ids = []
        ArtifactReceipt.objects.filter(owner=user, response__id=str(item.id)).delete()
    item.revision += 1
    item.save()
    response = artifact_payload(item, document)
    ArtifactReceipt.objects.create(
        owner=user,
        mutation_id=data["mutation_id"],
        digest=digest,
        response={**response, "content": None},
    )
    return response


def question_payload(question: ExplainQuestion) -> dict[str, Any]:
    source = question.source
    return {
        "id": str(question.id),
        "revision": question.revision,
        "prompt": question.prompt,
        "difficulty": question.difficulty,
        "concept_id": str(source.concept_id),
        "concept_ids": sorted(
            {str(source.concept_id), *[str(item.id) for item in question.concepts.all()]}
        ),
        "page_start": source.page_start,
        "page_end": source.page_end,
    }


def attempt_payload(item: ExplainAttempt) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "question_id": str(item.question_id),
        "question_revision": item.question_revision,
        "answer": item.answer,
        "feedback": item.feedback,
        "evaluation_status": item.evaluation_status,
        "self_rating": item.self_rating,
        "created_at": item.created_at.isoformat(),
    }


@transaction.atomic
def save_attempt(
    user: User, document: CatalogDocument, attempt_id: UUID, data: dict[str, Any]
) -> dict[str, Any]:
    require_enabled()
    if data["account_id"] != user.id:
        raise PermissionDenied("This save belongs to another signed-in account.")
    if not tool_flags(document)["explain"]:
        raise PermissionDenied("Explain is disabled for this sheet.")
    User.objects.select_for_update().get(pk=user.pk)
    existing = ExplainAttempt.objects.filter(pk=attempt_id).first()
    if existing:
        if existing.owner_id != user.pk:
            raise NotFound()
        if (
            existing.question_id != data["question_id"]
            or existing.answer != data["answer"]
            or (
                existing.question_revision != data["question_revision"]
                or existing.self_rating != data["self_rating"]
            )
        ):
            raise KnowledgeConflict("An attempt identifier cannot be reused for another answer.")
        return attempt_payload(existing)
    question = (
        ExplainQuestion.objects.filter(
            pk=data["question_id"],
            published=True,
            source__in=sources_for(document),
        )
        .select_related("source")
        .prefetch_related("concepts")
        .first()
    )
    if not question:
        raise NotFound()
    if question.revision != data["question_revision"]:
        raise KnowledgeConflict("The question changed. Review it before submitting.")
    if (
        ExplainAttempt.objects.filter(
            owner=user,
            question__source__concept__sheet_id=document.version.learning_object_id,
        ).count()
        >= 2000
    ):
        raise ValidationError("This sheet has reached its explanation attempt limit.")
    item = ExplainAttempt.objects.create(
        id=attempt_id,
        owner=user,
        question=question,
        source=question.source,
        answer=data["answer"],
        question_revision=question.revision,
        self_rating=data["self_rating"],
        feedback={
            "prompt": question.prompt,
            "source_id": str(question.source_id),
            "source": {
                "document_id": str(question.source.document_id),
                "source_version_id": str(question.source.source_version_id),
                "source_file_id": str(question.source.source_file_id),
                "page_start": question.source.page_start,
                "page_end": question.source.page_end,
            },
            "concept_ids": question_payload(question)["concept_ids"],
            "reference_answer": question.reference_answer,
            "essential_points": question.essential_points,
            "alternatives": question.alternatives,
            "follow_ups": question.follow_ups[:2],
        },
        evaluation_status="self_review",
    )
    return attempt_payload(item)


def knowledge_projection(user: User, document: CatalogDocument) -> list[dict[str, Any]]:
    """Read existing authoritative answer events once; never copy or schedule them."""
    sources = list(sources_for(document)[:200])
    ids = {source.concept_id for source in sources}
    banks = {
        bank.difficulty: bank
        for bank in ActiveStudyQuestionContent.objects.filter(
            sheet_id=document.version.learning_object_id,
            source_version_id=document.version_id,
        )
    }
    links = list(McqConceptLink.objects.filter(concept_id__in=ids))
    current_links: dict[str, list[tuple[UUID, datetime]]] = {}
    for link in links:
        parts = link.canonical_key.split(":")
        bank = banks.get(parts[2]) if len(parts) == 6 else None
        if bank and bank.revision == link.bank_revision:
            current_links.setdefault(link.canonical_key, []).append(
                (link.concept_id, bank.updated_at)
            )
    events: dict[UUID, list[tuple[datetime, bool]]] = {identifier: [] for identifier in ids}
    if current_links:
        answers = (
            ActiveStudyAnswer.objects.filter(
                attempt__run__user=user,
                attempt__run__sheet_id=document.version.learning_object_id,
                attempt__submitted_at__isnull=False,
            )
            .select_related("attempt__run")
            .order_by("-answered_at")[:2000]
        )
        for answer in answers:
            attempt, run = answer.attempt, answer.attempt.run
            key = (
                f"active-study:{run.sheet_id}:{run.difficulty}:{attempt.kind}:"
                f"{attempt.part_number}:{answer.question_position}"
            )
            for matched in current_links.get(key, []):
                if answer.answered_at >= matched[1]:
                    events[matched[0]].append((answer.answered_at, answer.was_correct))
        logs = (
            ReviewAnswerLog.objects.filter(
                user=user,
                review_item__canonical_key__in=current_links,
            )
            .select_related("review_item")
            .order_by("-answered_at")[:1000]
        )
        for log in logs:
            for matched_log in current_links[log.review_item.canonical_key]:
                if log.answered_at >= matched_log[1]:
                    events[matched_log[0]].append((log.answered_at, log.was_correct))
    attempts = (
        ExplainAttempt.objects.filter(
            owner=user,
            source__concept_id__in=ids,
            source__in=sources_for(document),
        )
        .select_related("source")
        .order_by("-created_at")[:500]
    )
    self_ratings: dict[UUID, tuple[datetime, str]] = {}
    for explain_attempt in attempts:
        if explain_attempt.source is None:
            continue
        linked_ids = explain_attempt.feedback.get(
            "concept_ids", [str(explain_attempt.source.concept_id)]
        )
        for linked_id in linked_ids:
            identifier = UUID(linked_id)
            if identifier in ids:
                self_ratings.setdefault(
                    identifier, (explain_attempt.created_at, explain_attempt.self_rating)
                )
    result = []
    seen = set()
    for source in sources:
        identifier = source.concept_id
        if identifier in seen:
            continue
        seen.add(identifier)
        history = sorted(events[identifier], reverse=True)
        rating = self_ratings.get(identifier)
        status = "not_practiced"
        if history:
            latest = history[:3]
            if not latest[0][1]:
                status = "needs_review"
            elif (
                len(latest) == 3
                and all(
                    event[1] and event[0] >= timezone.now() - timedelta(days=30) for event in latest
                )
                and len({event[0].date() for event in latest}) >= 3
            ):
                status = "strong_evidence"
            elif any(not event[1] for event in history):
                status = "improving"
            else:
                status = "practicing"
        elif rating and rating[1] in ("needs_review", "partial"):
            status = "needs_review"
        elif rating is not None:
            status = "practicing"
        self_reported = not history and rating is not None
        if (
            rating
            and rating[1] in ("needs_review", "partial")
            and (not history or rating[0] > history[0][0])
        ):
            status = "needs_review"
            self_reported = True
        if history and history[0][0] < timezone.now() - timedelta(days=30):
            status = "needs_review"
        result.append(
            {
                "id": str(identifier),
                "title": source.concept.title,
                "status": status,
                "page_start": source.page_start,
                "page_end": source.page_end,
                "verified_events": len(history),
                "self_reported": self_reported,
            }
        )
    return result
