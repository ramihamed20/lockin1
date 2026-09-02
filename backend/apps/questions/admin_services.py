from __future__ import annotations

from collections import Counter
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.content.models import LearningObject
from apps.discovery.indexing import remove_search_entry

from .importing import ImportValidationResult, validate_question_import
from .models import Question, QuestionImportBatch
from .services import (
    QuestionInput,
    QuestionOptionInput,
    QuestionRuleError,
    create_question,
    publish_question,
    revise_question,
    submit_question_for_review,
)


def _audit(
    *,
    actor: User,
    action: str,
    target_type: str,
    target_id: str,
    metadata: dict[str, object] | None = None,
) -> None:
    record_audit(
        actor=actor,
        action=action,
        domain="questions",
        target_type=target_type,
        target_id=target_id,
        reason="Content management action.",
        source="content_management.api",
        metadata=metadata or {},
    )


def _sheet_node(sheet: LearningObject):  # type: ignore[no-untyped-def]
    version = sheet.current_version
    if version is None:
        raise QuestionRuleError("The selected sheet has no current version.")
    return version.academic_node


def _publish_current(*, actor: User, question: Question) -> Question:
    if question.workflow_status == Question.WorkflowStatus.PUBLISHED:
        return question
    if question.workflow_status == Question.WorkflowStatus.RETIRED:
        raise QuestionRuleError("Retired questions cannot be republished without a new revision.")
    if question.workflow_status != Question.WorkflowStatus.IN_REVIEW:
        question = submit_question_for_review(
            actor=actor,
            question_id=question.id,
            expected_revision=question.revision,
        )
    return publish_question(
        actor=actor,
        question_id=question.id,
        expected_revision=question.revision,
    )


@transaction.atomic
def import_questions(
    *, actor: User, sheet: LearningObject, payload: object, publish: bool
) -> tuple[QuestionImportBatch, ImportValidationResult]:
    validation = validate_question_import(payload)
    node = _sheet_node(sheet)
    batch = QuestionImportBatch.objects.create(
        actor=actor,
        academic_node=node,
        sheet=sheet,
        schema_version="lockin_questions_v1",
        status=(
            QuestionImportBatch.Status.PUBLISHED if publish else QuestionImportBatch.Status.DRAFT
        ),
        question_count=len(validation.questions),
        type_counts=validation.type_counts,
        warnings=list(validation.warnings),
    )
    for imported in validation.questions:
        question = create_question(
            actor=actor,
            data=QuestionInput(
                academic_node=node,
                source_learning_object=sheet,
                import_batch=batch,
                question_type=imported.question_type,
                prompt=imported.prompt,
                explanation=imported.explanation,
                difficulty=imported.difficulty,
                topic=imported.topic,
                source_page=imported.source_page,
                options=tuple(
                    QuestionOptionInput(
                        text=choice,
                        is_correct=choice in imported.correct_answers,
                    )
                    for choice in imported.choices
                ),
            ),
        )
        if publish:
            _publish_current(actor=actor, question=question)
    _audit(
        actor=actor,
        action="questions.imported",
        target_type="questions.question_import_batch",
        target_id=str(batch.id),
        metadata={
            "sheet_id": str(sheet.id),
            "question_count": batch.question_count,
            "type_counts": batch.type_counts,
            "published": publish,
        },
    )
    return batch, validation


def _unpublish(*, question: Question) -> Question:
    question.published_version = None
    question.workflow_status = Question.WorkflowStatus.DRAFT
    question.published_at = None
    question.revision += 1
    question.save(
        update_fields=(
            "published_version",
            "workflow_status",
            "published_at",
            "revision",
            "updated_at",
        )
    )
    remove_search_entry(resource_kind="question", resource_id=question.id)
    return question


def _retire(*, question: Question) -> Question:
    question.workflow_status = Question.WorkflowStatus.RETIRED
    question.retired_at = timezone.now()
    question.revision += 1
    question.save(update_fields=("workflow_status", "retired_at", "revision", "updated_at"))
    remove_search_entry(resource_kind="question", resource_id=question.id)
    return question


def _move(*, actor: User, question: Question, target_sheet: LearningObject) -> Question:
    version = question.current_version
    if version is None:
        raise QuestionRuleError("A selected question has no current version.")
    target_node = _sheet_node(target_sheet)
    was_published = question.workflow_status == Question.WorkflowStatus.PUBLISHED
    question = revise_question(
        actor=actor,
        question_id=question.id,
        expected_revision=question.revision,
        data=QuestionInput(
            academic_node=target_node,
            source_learning_object=target_sheet,
            question_type=version.question_type,
            prompt=version.prompt,
            explanation=version.explanation,
            difficulty=version.difficulty,
            language=version.language,
            metadata=dict(version.metadata),
            topic=version.topic,
            source_page=version.source_page,
            options=tuple(
                QuestionOptionInput(text=option.text, is_correct=option.is_correct)
                for option in version.options.all()
            ),
        ),
    )
    return _publish_current(actor=actor, question=question) if was_published else question


@transaction.atomic
def bulk_question_action(
    *,
    actor: User,
    question_ids: list[UUID],
    action: str,
    target_sheet: LearningObject | None = None,
) -> dict[str, object]:
    questions = list(
        Question.objects.select_for_update()
        .filter(id__in=question_ids)
        .select_related("current_version__academic_node")
        .prefetch_related("current_version__options")
    )
    if len(questions) != len(question_ids):
        raise QuestionRuleError("One or more selected questions were not found.")
    counts: Counter[str] = Counter()
    for question in questions:
        if action == "publish":
            _publish_current(actor=actor, question=question)
            counts["published"] += 1
        elif action == "unpublish":
            _unpublish(question=question)
            counts["unpublished"] += 1
        elif action in {"archive", "delete"}:
            _retire(question=question)
            counts["archived"] += 1
        elif action == "move" and target_sheet is not None:
            _move(actor=actor, question=question, target_sheet=target_sheet)
            counts["moved"] += 1
        else:
            raise QuestionRuleError("Unsupported bulk question action.")
    _audit(
        actor=actor,
        action=f"questions.bulk_{action}",
        target_type="questions.question_batch",
        target_id=str(question_ids[0]),
        metadata={"question_ids": [str(value) for value in question_ids], **dict(counts)},
    )
    return {"processed": len(questions), **dict(counts)}


@transaction.atomic
def undo_import(*, actor: User, batch_id: UUID) -> QuestionImportBatch:
    batch = QuestionImportBatch.objects.select_for_update().get(id=batch_id)
    if batch.status == QuestionImportBatch.Status.UNDONE:
        raise QuestionRuleError("This import has already been undone.")
    questions = list(Question.objects.select_for_update().filter(import_batch=batch))
    for question in questions:
        if question.workflow_status != Question.WorkflowStatus.RETIRED:
            _retire(question=question)
    batch.status = QuestionImportBatch.Status.UNDONE
    batch.undone_by = actor
    batch.undone_at = timezone.now()
    batch.save(update_fields=("status", "undone_by", "undone_at"))
    _audit(
        actor=actor,
        action="questions.import_undone",
        target_type="questions.question_import_batch",
        target_id=str(batch.id),
        metadata={"question_count": len(questions), "strategy": "soft_retire"},
    )
    return batch
