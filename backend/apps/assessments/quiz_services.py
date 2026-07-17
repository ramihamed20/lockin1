import json
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
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
    is_administrator,
)
from apps.questions.models import Question, QuestionVersion
from apps.questions.selectors import published_questions
from platform_core.events import publish_after_commit

from .events import QuizPublished
from .models import Quiz, QuizVersion, QuizVersionQuestion
from .policies import can_edit_quiz


class QuizRuleError(ValueError):
    pass


class QuizConflictError(QuizRuleError):
    pass


@dataclass(frozen=True, slots=True)
class QuizInput:
    academic_node: EducationNode
    title: str
    instructions: str
    mode: str
    selection_mode: str
    question_count: int
    question_versions: tuple[QuestionVersion, ...] = ()
    duration_seconds: int | None = None
    maximum_attempts: int = 0
    available_from: datetime | None = None
    available_until: datetime | None = None
    randomize_questions: bool = True
    randomize_options: bool = True
    result_release: str = QuizVersion.ResultRelease.IMMEDIATE
    pass_percent: Decimal = Decimal("60.00")
    ranking_eligible: bool = False
    achievement_eligible: bool = False
    focus_required: bool = False
    allowed_difficulties: tuple[str, ...] = ()
    language: str = "en"
    metadata: dict[str, object] = field(default_factory=dict)


def resolve_question_versions(
    *, actor: User, question_ids: tuple[UUID, ...], academic_node: EducationNode
) -> tuple[QuestionVersion, ...]:
    questions = {
        question.id: question
        for question in Question.objects.filter(id__in=question_ids).select_related(
            "current_version__academic_node",
            "published_version",
        )
    }
    if len(questions) != len(set(question_ids)):
        raise QuizRuleError("One or more selected questions do not exist.")
    versions: list[QuestionVersion] = []
    for question_id in question_ids:
        question = questions[question_id]
        version = question.current_version
        if version is None:
            raise QuizRuleError("A selected question has no current version.")
        if (
            question.workflow_status != Question.WorkflowStatus.PUBLISHED
            and question.owner_id != actor.id
            and not is_administrator(actor)
        ):
            raise QuizRuleError("An unpublished question is not available to this creator.")
        if not version.academic_node.path.startswith(academic_node.path):
            raise QuizRuleError("Selected questions must belong to the quiz education scope.")
        versions.append(version)
    return tuple(versions)


def _validate_input(*, actor: User, data: QuizInput) -> None:
    if not can_create_assessments(user=actor, node=data.academic_node):
        raise QuizRuleError("You cannot create assessments in this education scope.")
    if data.mode not in QuizVersion.Mode.values:
        raise QuizRuleError("Unsupported assessment mode.")
    if data.selection_mode not in QuizVersion.SelectionMode.values:
        raise QuizRuleError("Unsupported question selection mode.")
    if not data.title.strip():
        raise QuizRuleError("A quiz title is required.")
    if not 1 <= data.question_count <= 100:
        raise QuizRuleError("Question count must be between 1 and 100.")
    if not 0 <= data.maximum_attempts <= 100:
        raise QuizRuleError("Maximum attempts must be between 0 and 100.")
    if data.duration_seconds is not None and not 60 <= data.duration_seconds <= 14_400:
        raise QuizRuleError("Timed assessments must last between 1 minute and 4 hours.")
    if data.mode in {QuizVersion.Mode.QUIZ, QuizVersion.Mode.MASTERY} and not data.duration_seconds:
        raise QuizRuleError("Quiz and mastery modes require a server-controlled duration.")
    if data.available_from and data.available_until and data.available_until <= data.available_from:
        raise QuizRuleError("Availability must end after it starts.")
    if data.result_release == QuizVersion.ResultRelease.AFTER_CLOSE and not data.available_until:
        raise QuizRuleError("Delayed results require an availability end time.")
    if data.result_release not in QuizVersion.ResultRelease.values:
        raise QuizRuleError("Unsupported result release policy.")
    if not Decimal("0") <= data.pass_percent <= Decimal("100"):
        raise QuizRuleError("Pass percentage must be between 0 and 100.")
    invalid_difficulties = set(data.allowed_difficulties) - set(QuestionVersion.Difficulty.values)
    if invalid_difficulties:
        raise QuizRuleError("Unsupported difficulty filter.")
    if len(set(data.allowed_difficulties)) != len(data.allowed_difficulties):
        raise QuizRuleError("Difficulty filters must be unique.")
    if data.selection_mode == QuizVersion.SelectionMode.FIXED:
        if len(data.question_versions) != data.question_count:
            raise QuizRuleError("Fixed quizzes require exactly the configured question count.")
        if len({item.id for item in data.question_versions}) != len(data.question_versions):
            raise QuizRuleError("A fixed quiz cannot contain a question twice.")
    elif data.question_versions:
        raise QuizRuleError("Pool-based quizzes cannot include fixed question identifiers.")
    if data.mode == QuizVersion.Mode.PRACTICE and data.ranking_eligible:
        raise QuizRuleError("Practice attempts cannot be ranking eligible.")
    if data.ranking_eligible and (
        data.selection_mode != QuizVersion.SelectionMode.FIXED
        or not data.duration_seconds
        or data.maximum_attempts == 0
    ):
        raise QuizRuleError(
            "Ranked assessments require fixed questions, a timer, and a finite retry limit."
        )
    if len(json.dumps(data.metadata, separators=(",", ":"), default=str)) > 4096:
        raise QuizRuleError("Quiz metadata is too large.")


def _create_version(
    *, quiz: Quiz, actor: User, version_number: int, data: QuizInput
) -> QuizVersion:
    version = QuizVersion.objects.create(
        quiz=quiz,
        version_number=version_number,
        academic_node=data.academic_node,
        title=data.title.strip(),
        instructions=data.instructions.strip(),
        mode=data.mode,
        selection_mode=data.selection_mode,
        question_count=data.question_count,
        duration_seconds=data.duration_seconds,
        maximum_attempts=data.maximum_attempts,
        available_from=data.available_from,
        available_until=data.available_until,
        randomize_questions=data.randomize_questions,
        randomize_options=data.randomize_options,
        result_release=data.result_release,
        pass_percent=data.pass_percent,
        ranking_eligible=data.ranking_eligible,
        achievement_eligible=data.achievement_eligible,
        focus_required=data.focus_required,
        allowed_difficulties=list(data.allowed_difficulties),
        language=data.language.strip().lower(),
        metadata=data.metadata,
        created_by=actor,
    )
    QuizVersionQuestion.objects.bulk_create(
        [
            QuizVersionQuestion(
                quiz_version=version,
                question_version=question_version,
                position=position,
            )
            for position, question_version in enumerate(data.question_versions, start=1)
        ]
    )
    return version


def _ensure_revision(*, quiz: Quiz, expected_revision: int) -> None:
    if quiz.revision != expected_revision:
        raise QuizConflictError("This quiz changed. Reload it and try again.")


@transaction.atomic
def create_quiz(*, actor: User, data: QuizInput) -> Quiz:
    _validate_input(actor=actor, data=data)
    quiz = Quiz.objects.create(owner=actor)
    version = _create_version(quiz=quiz, actor=actor, version_number=1, data=data)
    quiz.current_version = version
    quiz.save(update_fields=("current_version", "updated_at"))
    return (
        Quiz.objects.select_related("current_version__academic_node")
        .prefetch_related("current_version__question_links__question_version")
        .get(id=quiz.id)
    )


@transaction.atomic
def revise_quiz(*, actor: User, quiz_id: UUID, expected_revision: int, data: QuizInput) -> Quiz:
    quiz = (
        Quiz.objects.select_for_update()
        .select_related("current_version", "published_version")
        .get(id=quiz_id)
    )
    if not can_edit_quiz(user=actor, quiz=quiz):
        raise QuizRuleError("You cannot edit this quiz.")
    _ensure_revision(quiz=quiz, expected_revision=expected_revision)
    if quiz.workflow_status in {Quiz.WorkflowStatus.IN_REVIEW, Quiz.WorkflowStatus.RETIRED}:
        raise QuizRuleError("Quizzes in review or retired quizzes cannot be edited.")
    _validate_input(actor=actor, data=data)
    current = quiz.current_version
    if current is None:
        raise QuizRuleError("The quiz has no current version.")
    version = _create_version(
        quiz=quiz,
        actor=actor,
        version_number=current.version_number + 1,
        data=data,
    )
    quiz.current_version = version
    quiz.workflow_status = Quiz.WorkflowStatus.DRAFT
    quiz.review_note = ""
    quiz.revision += 1
    quiz.save(
        update_fields=(
            "current_version",
            "workflow_status",
            "review_note",
            "revision",
            "updated_at",
        )
    )
    return quiz


@transaction.atomic
def submit_quiz_for_review(*, actor: User, quiz_id: UUID, expected_revision: int) -> Quiz:
    quiz = (
        Quiz.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=quiz_id)
    )
    if not can_edit_quiz(user=actor, quiz=quiz):
        raise QuizRuleError("You cannot submit this quiz.")
    _ensure_revision(quiz=quiz, expected_revision=expected_revision)
    if quiz.workflow_status not in {Quiz.WorkflowStatus.DRAFT, Quiz.WorkflowStatus.REJECTED}:
        raise QuizRuleError("Only draft or rejected quizzes can be submitted.")
    if quiz.current_version is None:
        raise QuizRuleError("The quiz has no current version.")
    quiz.workflow_status = Quiz.WorkflowStatus.IN_REVIEW
    quiz.review_note = ""
    quiz.revision += 1
    quiz.save(update_fields=("workflow_status", "review_note", "revision", "updated_at"))
    return quiz


@transaction.atomic
def reject_quiz(*, actor: User, quiz_id: UUID, expected_revision: int, review_note: str) -> Quiz:
    quiz = (
        Quiz.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=quiz_id)
    )
    version = quiz.current_version
    if version is None or not can_review_assessments(user=actor, node=version.academic_node):
        raise QuizRuleError("You cannot review this quiz.")
    _ensure_revision(quiz=quiz, expected_revision=expected_revision)
    if quiz.workflow_status != Quiz.WorkflowStatus.IN_REVIEW:
        raise QuizRuleError("Only quizzes in review can be rejected.")
    if not review_note.strip():
        raise QuizRuleError("Review feedback is required when rejecting a quiz.")
    quiz.workflow_status = Quiz.WorkflowStatus.REJECTED
    quiz.review_note = review_note.strip()
    quiz.revision += 1
    quiz.save(update_fields=("workflow_status", "review_note", "revision", "updated_at"))
    return quiz


def _validate_publishable(version: QuizVersion) -> None:
    if not version.academic_node.is_discoverable:
        raise QuizRuleError("Publish the education path before publishing this quiz.")
    if version.selection_mode == QuizVersion.SelectionMode.FIXED:
        links = version.question_links.select_related(
            "question_version__question__published_version"
        )
        if links.count() != version.question_count:
            raise QuizRuleError("The fixed question set is incomplete.")
        for link in links:
            question = link.question_version.question
            if (
                question.retired_at is not None
                or question.published_version_id != link.question_version_id
            ):
                raise QuizRuleError(
                    "Every fixed question version must be published before the quiz."
                )
    else:
        available = published_questions(
            academic_path=version.academic_node.path,
            difficulties=tuple(version.allowed_difficulties),
        ).count()
        if available < version.question_count:
            raise QuizRuleError("The published question pool is smaller than the quiz size.")


@transaction.atomic
def publish_quiz(*, actor: User, quiz_id: UUID, expected_revision: int) -> Quiz:
    quiz = (
        Quiz.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=quiz_id)
    )
    version = quiz.current_version
    if version is None or not can_publish_assessments(user=actor, node=version.academic_node):
        raise QuizRuleError("You cannot publish this quiz.")
    _ensure_revision(quiz=quiz, expected_revision=expected_revision)
    if quiz.workflow_status != Quiz.WorkflowStatus.IN_REVIEW:
        raise QuizRuleError("Only reviewed quizzes can be published.")
    _validate_publishable(version)
    now = timezone.now()
    quiz.published_version = version
    quiz.workflow_status = Quiz.WorkflowStatus.PUBLISHED
    quiz.published_at = now
    quiz.retired_at = None
    quiz.review_note = ""
    quiz.revision += 1
    quiz.save(
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
        resource_kind="quiz",
        resource_id=quiz.id,
        title=version.title,
        summary=version.instructions,
        academic_path=version.academic_node.path,
        language=version.language,
        content_type=version.mode,
        published_at=now,
    )
    publish_after_commit(
        QuizPublished(
            quiz_id=quiz.id,
            version_id=version.id,
            academic_node_id=version.academic_node_id,
            mode=version.mode,
            actor_id=actor.id,
        )
    )
    return quiz


@transaction.atomic
def retire_quiz(*, actor: User, quiz_id: UUID, expected_revision: int) -> Quiz:
    quiz = (
        Quiz.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=quiz_id)
    )
    version = quiz.current_version
    if version is None or not can_publish_assessments(user=actor, node=version.academic_node):
        raise QuizRuleError("You cannot retire this quiz.")
    _ensure_revision(quiz=quiz, expected_revision=expected_revision)
    quiz.workflow_status = Quiz.WorkflowStatus.RETIRED
    quiz.retired_at = timezone.now()
    quiz.revision += 1
    quiz.save(update_fields=("workflow_status", "retired_at", "revision", "updated_at"))
    remove_search_entry(resource_kind="quiz", resource_id=quiz.id)
    return quiz
