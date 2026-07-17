import json
from dataclasses import dataclass, field
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.discovery.indexing import remove_search_entry, upsert_search_entry
from apps.education.models import EducationNode
from apps.education.policies import (
    can_create_assessments,
    can_publish_assessments,
    can_review_assessments,
)
from platform_core.events import publish_after_commit

from .events import QuestionPublished
from .models import Question, QuestionOption, QuestionVersion
from .policies import can_edit_question


class QuestionRuleError(ValueError):
    pass


class QuestionConflictError(QuestionRuleError):
    pass


@dataclass(frozen=True, slots=True)
class QuestionOptionInput:
    text: str
    is_correct: bool = False


@dataclass(frozen=True, slots=True)
class QuestionInput:
    academic_node: EducationNode
    question_type: str
    prompt: str
    options: tuple[QuestionOptionInput, ...]
    explanation: str = ""
    difficulty: str = QuestionVersion.Difficulty.MEDIUM
    language: str = "en"
    metadata: dict[str, object] = field(default_factory=dict)


def _validate_input(*, actor: User, data: QuestionInput) -> None:
    if not can_create_assessments(user=actor, node=data.academic_node):
        raise QuestionRuleError("You cannot create assessments in this education scope.")
    if data.question_type not in QuestionVersion.QuestionType.values:
        raise QuestionRuleError("Unsupported question type.")
    if data.difficulty not in QuestionVersion.Difficulty.values:
        raise QuestionRuleError("Unsupported question difficulty.")
    if not data.prompt.strip():
        raise QuestionRuleError("A question prompt is required.")
    if not 2 <= len(data.options) <= 12:
        raise QuestionRuleError("A question needs between 2 and 12 answer options.")
    normalized_options = [" ".join(option.text.split()).casefold() for option in data.options]
    if any(not option for option in normalized_options):
        raise QuestionRuleError("Answer options cannot be empty.")
    if len(set(normalized_options)) != len(normalized_options):
        raise QuestionRuleError("Answer options must be unique.")
    if sum(option.is_correct for option in data.options) != 1:
        raise QuestionRuleError("Exactly one answer option must be correct.")
    if data.question_type == QuestionVersion.QuestionType.TRUE_FALSE and len(data.options) != 2:
        raise QuestionRuleError("True or false questions require exactly two options.")
    if len(json.dumps(data.metadata, separators=(",", ":"), default=str)) > 4096:
        raise QuestionRuleError("Question metadata is too large.")


def _create_version(
    *,
    question: Question,
    actor: User,
    version_number: int,
    data: QuestionInput,
) -> QuestionVersion:
    version = QuestionVersion.objects.create(
        question=question,
        version_number=version_number,
        academic_node=data.academic_node,
        question_type=data.question_type,
        prompt=data.prompt.strip(),
        explanation=data.explanation.strip(),
        difficulty=data.difficulty,
        language=data.language.strip().lower(),
        metadata=data.metadata,
        created_by=actor,
    )
    QuestionOption.objects.bulk_create(
        [
            QuestionOption(
                version=version,
                text=option.text.strip(),
                position=position,
                is_correct=option.is_correct,
            )
            for position, option in enumerate(data.options, start=1)
        ]
    )
    return version


def _ensure_revision(*, question: Question, expected_revision: int) -> None:
    if question.revision != expected_revision:
        raise QuestionConflictError("This question changed. Reload it and try again.")


@transaction.atomic
def create_question(*, actor: User, data: QuestionInput) -> Question:
    _validate_input(actor=actor, data=data)
    question = Question.objects.create(owner=actor)
    version = _create_version(question=question, actor=actor, version_number=1, data=data)
    question.current_version = version
    question.save(update_fields=("current_version", "updated_at"))
    return (
        Question.objects.select_related("current_version__academic_node")
        .prefetch_related("current_version__options")
        .get(id=question.id)
    )


@transaction.atomic
def revise_question(
    *,
    actor: User,
    question_id: UUID,
    expected_revision: int,
    data: QuestionInput,
) -> Question:
    question = (
        Question.objects.select_for_update()
        .select_related("current_version", "published_version")
        .get(id=question_id)
    )
    if not can_edit_question(user=actor, question=question):
        raise QuestionRuleError("You cannot edit this question.")
    _ensure_revision(question=question, expected_revision=expected_revision)
    if question.workflow_status in {
        Question.WorkflowStatus.IN_REVIEW,
        Question.WorkflowStatus.RETIRED,
    }:
        raise QuestionRuleError("Questions in review or retired questions cannot be edited.")
    _validate_input(actor=actor, data=data)
    current = question.current_version
    if current is None:
        raise QuestionRuleError("The question has no current version.")
    version = _create_version(
        question=question,
        actor=actor,
        version_number=current.version_number + 1,
        data=data,
    )
    question.current_version = version
    question.workflow_status = Question.WorkflowStatus.DRAFT
    question.review_note = ""
    question.revision += 1
    question.save(
        update_fields=(
            "current_version",
            "workflow_status",
            "review_note",
            "revision",
            "updated_at",
        )
    )
    return question


@transaction.atomic
def submit_question_for_review(
    *, actor: User, question_id: UUID, expected_revision: int
) -> Question:
    question = (
        Question.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=question_id)
    )
    if not can_edit_question(user=actor, question=question):
        raise QuestionRuleError("You cannot submit this question.")
    _ensure_revision(question=question, expected_revision=expected_revision)
    if question.workflow_status not in {
        Question.WorkflowStatus.DRAFT,
        Question.WorkflowStatus.REJECTED,
    }:
        raise QuestionRuleError("Only draft or rejected questions can be submitted.")
    if question.current_version is None:
        raise QuestionRuleError("The question has no current version.")
    question.workflow_status = Question.WorkflowStatus.IN_REVIEW
    question.review_note = ""
    question.revision += 1
    question.save(update_fields=("workflow_status", "review_note", "revision", "updated_at"))
    return question


@transaction.atomic
def reject_question(
    *,
    actor: User,
    question_id: UUID,
    expected_revision: int,
    review_note: str,
) -> Question:
    question = (
        Question.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=question_id)
    )
    version = question.current_version
    if version is None or not can_review_assessments(user=actor, node=version.academic_node):
        raise QuestionRuleError("You cannot review this question.")
    _ensure_revision(question=question, expected_revision=expected_revision)
    if question.workflow_status != Question.WorkflowStatus.IN_REVIEW:
        raise QuestionRuleError("Only questions in review can be rejected.")
    if not review_note.strip():
        raise QuestionRuleError("Review feedback is required when rejecting a question.")
    question.workflow_status = Question.WorkflowStatus.REJECTED
    question.review_note = review_note.strip()
    question.revision += 1
    question.save(update_fields=("workflow_status", "review_note", "revision", "updated_at"))
    return question


@transaction.atomic
def publish_question(*, actor: User, question_id: UUID, expected_revision: int) -> Question:
    question = (
        Question.objects.select_for_update()
        .select_related("current_version__academic_node")
        .prefetch_related("current_version__options")
        .get(id=question_id)
    )
    version = question.current_version
    if version is None or not can_publish_assessments(user=actor, node=version.academic_node):
        raise QuestionRuleError("You cannot publish this question.")
    _ensure_revision(question=question, expected_revision=expected_revision)
    if question.workflow_status != Question.WorkflowStatus.IN_REVIEW:
        raise QuestionRuleError("Only reviewed questions can be published.")
    if not version.academic_node.is_discoverable:
        raise QuestionRuleError("Publish the education path before publishing this question.")
    now = timezone.now()
    question.published_version = version
    question.workflow_status = Question.WorkflowStatus.PUBLISHED
    question.published_at = now
    question.retired_at = None
    question.review_note = ""
    question.revision += 1
    question.save(
        update_fields=(
            "published_version",
            "workflow_status",
            "published_at",
            "retired_at",
            "review_note",
            "revision",
            "updated_at",
        )
    )
    upsert_search_entry(
        resource_kind="question",
        resource_id=question.id,
        title=version.prompt[:220],
        summary="",
        academic_path=version.academic_node.path,
        language=version.language,
        content_type=version.question_type,
        published_at=now,
    )
    publish_after_commit(
        QuestionPublished(
            question_id=question.id,
            version_id=version.id,
            academic_node_id=version.academic_node_id,
            actor_id=actor.id,
        )
    )
    return question


@transaction.atomic
def retire_question(*, actor: User, question_id: UUID, expected_revision: int) -> Question:
    question = (
        Question.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=question_id)
    )
    version = question.current_version
    if version is None or not can_publish_assessments(user=actor, node=version.academic_node):
        raise QuestionRuleError("You cannot retire this question.")
    _ensure_revision(question=question, expected_revision=expected_revision)
    question.workflow_status = Question.WorkflowStatus.RETIRED
    question.retired_at = timezone.now()
    question.revision += 1
    question.save(update_fields=("workflow_status", "retired_at", "revision", "updated_at"))
    remove_search_entry(resource_kind="question", resource_id=question.id)
    return question
