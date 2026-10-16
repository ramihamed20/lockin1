"""Read-only links from server-scored MCQ mistakes to reviewed, current Explain content."""

from typing import Any
from uuid import UUID

from rest_framework.exceptions import NotFound

from apps.accounts.models import User
from apps.content.models import ActiveStudyQuestionContent, CatalogDocument
from apps.focus.models import ActiveStudyAttempt

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
    prefix = (
        f"active-study:{attempt.run.sheet_id}:{attempt.run.difficulty}:"
        f"{attempt.kind}:{attempt.part_number}:"
    )
    mappings: dict[str, list[str]] = {}
    for link in McqConceptLink.objects.filter(
        concept_id__in=concept_ids,
        bank_revision=bank.revision,
        canonical_key__startswith=prefix,
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
        ids = mappings.get(f"{prefix}{answer.question_position}", [])
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
