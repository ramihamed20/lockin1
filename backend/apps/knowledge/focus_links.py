"""Read-only links from server-scored MCQ mistakes to reviewed, current Explain content."""

from typing import Any
from uuid import UUID

from rest_framework.exceptions import NotFound

from apps.accounts.models import User
from apps.content.models import ActiveStudyQuestionContent, CatalogDocument
from apps.focus.models import ActiveStudyAttempt
from apps.focus.question_identity import canonical_keys_for_attempt

from .models import ExplainQuestion, McqConceptLink
from .services import question_payload, require_enabled, sources_for, tool_flags


def explain_links(user: User, document: CatalogDocument, attempt_id: UUID) -> dict[str, Any]:
    require_enabled()
    attempt = (
        ActiveStudyAttempt.objects.filter(
            pk=attempt_id,
            run__user=user,
            run__sheet_id=document.version.learning_object_id,
            submitted_at__isnull=False,
        )
        .select_related("run")
        .prefetch_related("answers")
        .first()
    )
    if not attempt:
        raise NotFound()
    empty: dict[str, Any] = {"links": [], "availability": "unavailable"}
    if not tool_flags(document)["explain"]:
        return empty
    bank = ActiveStudyQuestionContent.objects.filter(
        sheet_id=attempt.run.sheet_id,
        difficulty=attempt.run.difficulty,
        source_version_id=document.version_id,
    ).first()
    if not bank:
        return {**empty, "availability": "stale"}
    if all(answer.was_correct for answer in attempt.answers.all()):
        return {"links": [], "availability": "no_mistakes"}
    sources = list(sources_for(document))
    concept_ids = {source.concept_id for source in sources}
    keys = canonical_keys_for_attempt(attempt, bank)
    mappings: dict[str, list[str]] = {}
    for link in McqConceptLink.objects.filter(
        concept_id__in=concept_ids,
        bank_revision=bank.revision,
        canonical_key__in=keys.values(),
    ):
        mappings.setdefault(link.canonical_key, []).append(str(link.concept_id))
    questions = list(
        ExplainQuestion.objects.filter(published=True, source__in=sources)
        .select_related("source")
        .prefetch_related("concepts")
        .order_by("id")[:100]
    )
    prepared = [question_payload(question) for question in questions]
    links = []
    for answer in attempt.answers.all():
        if answer.was_correct or answer.answered_at < bank.updated_at:
            continue
        ids = mappings.get(keys.get(answer.question_position, ""), [])
        matching = [question for question in prepared if set(ids) & set(question["concept_ids"])]
        matching.sort(key=lambda question: question["difficulty"] != attempt.run.difficulty)
        if matching:
            question = matching[0]
            links.append(
                {
                    "position": answer.question_position,
                    "question_id": question["id"],
                    "difficulty": question["difficulty"],
                    "concept_ids": question["concept_ids"],
                    "page_end": question["page_end"],
                }
            )
    return {"links": links, "availability": "available" if links else "unprepared"}


def resumed_explain_links(user: User, document: CatalogDocument, run_id: UUID) -> dict[str, Any]:
    from apps.focus.models import ActiveStudyRun

    run = ActiveStudyRun.objects.filter(
        pk=run_id,
        user=user,
        sheet_id=document.version.learning_object_id,
        stage__in=("checkpoint_result", "final_result"),
    ).first()
    if not run:
        raise NotFound()
    attempts = run.attempts.filter(
        submitted_at__isnull=False,
        kind="final" if run.stage == "final_result" else "checkpoint",
    )
    if run.stage == "checkpoint_result":
        attempts = attempts.filter(part_number=run.current_part)
    attempt = attempts.order_by("-submitted_at").first()
    if not attempt:
        raise NotFound()
    return explain_links(user, document, attempt.id)


def review_recovery_links(user: User, item_id: UUID) -> dict[str, Any]:
    from django.db.models import F, Q
    from rest_framework.exceptions import APIException

    from apps.review.models import ReviewItem

    from .models import ConceptSource
    from .services import document_for

    require_enabled()
    item = ReviewItem.objects.filter(pk=item_id, user=user).first()
    if item is None:
        raise NotFound()
    parts = item.canonical_key.split(":")
    if len(parts) < 3 or parts[0] != "active-study":
        return {"links": []}
    links = []
    seen = set()
    for mapping in (
        McqConceptLink.objects.filter(canonical_key=item.canonical_key)
        .select_related("concept")
        .order_by("id")[:20]
    ):
        for source in ConceptSource.objects.filter(
            concept=mapping.concept,
            concept__published=True,
            document__is_active=True,
            source_version_id=F("document__version_id"),
            source_file_id=F("document__managed_file_id"),
        ).select_related("document__version")[:20]:
            bank = ActiveStudyQuestionContent.objects.filter(
                sheet_id=mapping.concept.sheet_id,
                source_version_id=source.source_version_id,
                revision=mapping.bank_revision,
                difficulty=parts[2],
            ).first()
            if (
                bank is None
                or item.last_mistake_at is None
                or item.last_mistake_at < bank.updated_at
            ):
                continue
            try:
                document = document_for(user, source.document_id)
            except APIException:
                continue
            if not tool_flags(document)["explain"]:
                continue
            question = (
                ExplainQuestion.objects.filter(published=True, source__in=sources_for(document))
                .filter(Q(source__concept_id=mapping.concept_id) | Q(concepts=mapping.concept))
                .order_by("id")
                .first()
            )
            if question is None or question.pk in seen:
                continue
            seen.add(question.pk)
            links.append(
                {
                    "concept_id": str(mapping.concept_id),
                    "title": mapping.concept.title,
                    "start_url": (
                        f"/materials/catalog/{document.material_slug}/sheets/{document.sheet_slug}/workspace"
                        f"?studyPage={question.source.page_start}&studyVersion={document.version_id}"
                        f"&studyFile={document.managed_file_id}&studyQuestion={question.pk}"
                    ),
                }
            )
            if len(links) == 3:
                return {"links": links}
    return {"links": links}
