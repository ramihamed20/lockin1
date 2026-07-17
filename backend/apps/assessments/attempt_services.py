import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TypeVar
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.progress.selectors import due_question_reviews
from apps.progress.services import record_question_outcome
from apps.questions.models import QuestionVersion
from apps.questions.selectors import published_questions
from platform_core.events import publish_after_commit

from .events import (
    AssessmentReportCreated,
    QuizAttemptAutosaved,
    QuizAttemptStarted,
    QuizAttemptSubmitted,
)
from .models import (
    Attempt,
    AttemptActivity,
    AttemptAnswer,
    AttemptQuestion,
    AttemptResult,
    AttemptSubmissionReceipt,
    QuestionIssueReport,
    Quiz,
    QuizVersion,
)

T = TypeVar("T")


class AttemptRuleError(ValueError):
    pass


class AttemptClosedError(AttemptRuleError):
    pass


class AttemptConflictError(AttemptRuleError):
    def __init__(self, message: str, *, current_answer: AttemptAnswer | None = None) -> None:
        super().__init__(message)
        self.current_answer = current_answer


@dataclass(frozen=True, slots=True)
class AttemptStart:
    attempt: Attempt
    resumed: bool


def _shuffle(items: list[T]) -> None:
    secrets.SystemRandom().shuffle(items)


def _sample(items: list[T], count: int) -> list[T]:
    return secrets.SystemRandom().sample(items, count)


def _active_quiz_for_update(*, quiz_id: UUID) -> tuple[Quiz, QuizVersion]:
    try:
        quiz = (
            Quiz.objects.select_for_update()
            .select_related("published_version__academic_node")
            .get(
                id=quiz_id,
                retired_at__isnull=True,
                published_version__isnull=False,
            )
        )
    except Quiz.DoesNotExist as error:
        raise AttemptRuleError("Quiz not found.") from error
    version = quiz.published_version
    if version is None or not version.academic_node.is_discoverable:
        raise AttemptRuleError("Quiz not found.")
    return quiz, version


def _validate_availability(*, version: QuizVersion, now: datetime) -> None:
    if version.available_from and now < version.available_from:
        raise AttemptRuleError("This assessment is not open yet.")
    if version.available_until and now >= version.available_until:
        raise AttemptRuleError("This assessment is closed.")


def _selected_versions(
    *,
    user: User,
    version: QuizVersion,
    requested_count: int,
    difficulties: tuple[str, ...],
    review_only: bool,
) -> list[QuestionVersion]:
    if version.selection_mode == QuizVersion.SelectionMode.FIXED:
        links = list(
            version.question_links.select_related(
                "question_version__question",
            ).prefetch_related("question_version__options")
        )
        selected = [link.question_version for link in links]
    elif review_only:
        reviews = due_question_reviews(
            user=user,
            academic_path=version.academic_node.path,
        )
        if difficulties:
            reviews = reviews.filter(question__published_version__difficulty__in=difficulties)
        selected = [
            review.question.published_version
            for review in reviews[:requested_count]
            if review.question.published_version is not None
        ]
        if not selected:
            raise AttemptRuleError("There are no due review questions in this scope.")
        selected_ids = [item.id for item in selected]
        hydrated = {
            item.id: item
            for item in QuestionVersion.objects.filter(id__in=selected_ids)
            .select_related("question")
            .prefetch_related("options")
        }
        selected = [hydrated[item.id] for item in selected]
    else:
        available_ids = list(
            published_questions(
                academic_path=version.academic_node.path,
                difficulties=difficulties,
            ).values_list("published_version_id", flat=True)
        )
        if len(available_ids) < requested_count:
            raise AttemptRuleError("The published question pool is smaller than this attempt.")
        selected_ids = _sample(available_ids, requested_count)
        hydrated = {
            item.id: item
            for item in QuestionVersion.objects.filter(id__in=selected_ids)
            .select_related("question")
            .prefetch_related("options")
        }
        selected = [hydrated[item_id] for item_id in selected_ids]

    if version.randomize_questions and not review_only:
        _shuffle(selected)
    return selected


def _snapshot_questions(
    *, attempt: Attempt, versions: list[QuestionVersion], randomize_options: bool
) -> None:
    snapshots: list[AttemptQuestion] = []
    for position, question_version in enumerate(versions, start=1):
        options = list(question_version.options.all())
        if randomize_options:
            _shuffle(options)
        option_snapshot = [{"id": str(option.id), "text": option.text} for option in options]
        correct_option_ids = [str(option.id) for option in options if option.is_correct]
        snapshots.append(
            AttemptQuestion(
                attempt=attempt,
                question_version=question_version,
                position=position,
                prompt=question_version.prompt,
                question_type=question_version.question_type,
                difficulty=question_version.difficulty,
                language=question_version.language,
                explanation=question_version.explanation,
                option_snapshot=option_snapshot,
                correct_option_ids=correct_option_ids,
            )
        )
    AttemptQuestion.objects.bulk_create(snapshots)


@transaction.atomic
def start_attempt(
    *,
    user: User,
    quiz_id: UUID,
    idempotency_key: UUID,
    requested_question_count: int | None = None,
    difficulties: tuple[str, ...] = (),
    review_only: bool = False,
    now: datetime | None = None,
) -> AttemptStart:
    started_at = now or timezone.now()
    User.objects.select_for_update().only("id").get(id=user.id)
    existing = Attempt.objects.filter(
        user=user,
        start_idempotency_key=idempotency_key,
    ).first()
    if existing is not None:
        if existing.quiz_id != quiz_id:
            raise AttemptConflictError("That idempotency key belongs to another attempt.")
        if existing.status == Attempt.Status.ACTIVE and (
            existing.deadline_at is None or started_at < existing.deadline_at
        ):
            return AttemptStart(attempt=existing, resumed=True)
        if existing.status == Attempt.Status.ACTIVE:
            _finalize_attempt(attempt=existing, submitted_at=started_at, expired=True)
        return AttemptStart(attempt=existing, resumed=True)

    quiz, version = _active_quiz_for_update(quiz_id=quiz_id)
    _validate_availability(version=version, now=started_at)
    active = Attempt.objects.filter(user=user, quiz=quiz, status=Attempt.Status.ACTIVE).first()
    if active is not None:
        if active.deadline_at is None or started_at < active.deadline_at:
            return AttemptStart(attempt=active, resumed=True)
        _finalize_attempt(attempt=active, submitted_at=started_at, expired=True)

    completed_attempts = (
        Attempt.objects.filter(user=user, quiz=quiz).exclude(status=Attempt.Status.ACTIVE).count()
    )
    if version.maximum_attempts and completed_attempts >= version.maximum_attempts:
        raise AttemptRuleError("The retry limit for this assessment has been reached.")

    count = requested_question_count or version.question_count
    allowed = tuple(version.allowed_difficulties) or tuple(QuestionVersion.Difficulty.values)
    if version.mode != QuizVersion.Mode.PRACTICE:
        if requested_question_count is not None or difficulties or review_only:
            raise AttemptRuleError("Only practice mode supports attempt-level question filters.")
        count = version.question_count
        difficulties = allowed
    else:
        if not 1 <= count <= version.question_count:
            raise AttemptRuleError("Practice size exceeds the configured question count.")
        if set(difficulties) - set(allowed):
            raise AttemptRuleError("The requested difficulty is outside this practice set.")
        difficulties = difficulties or allowed
        if review_only and version.selection_mode != QuizVersion.SelectionMode.POOL:
            raise AttemptRuleError("Review practice requires a question-pool assessment.")

    versions = _selected_versions(
        user=user,
        version=version,
        requested_count=count,
        difficulties=difficulties,
        review_only=review_only,
    )
    actual_count = len(versions)
    deadline = (
        started_at + timedelta(seconds=version.duration_seconds)
        if version.duration_seconds
        else None
    )
    attempt = Attempt.objects.create(
        user=user,
        quiz=quiz,
        quiz_version=version,
        start_idempotency_key=idempotency_key,
        requested_question_count=actual_count,
        review_only=review_only,
        started_at=started_at,
        deadline_at=deadline,
    )
    _snapshot_questions(
        attempt=attempt,
        versions=versions,
        randomize_options=version.randomize_options,
    )
    publish_after_commit(
        QuizAttemptStarted(
            attempt_id=attempt.id,
            user_id=user.id,
            quiz_id=quiz.id,
            quiz_version_id=version.id,
            mode=version.mode,
            actor_id=user.id,
        )
    )
    return AttemptStart(attempt=attempt, resumed=False)


def _answer_payload(answer: AttemptAnswer | None) -> tuple[list[str], int, int]:
    if answer is None:
        return [], 0, 0
    return (
        list(answer.selected_option_ids),
        answer.client_revision,
        answer.server_revision,
    )


@transaction.atomic
def save_answer(
    *,
    user: User,
    attempt_id: UUID,
    attempt_question_id: UUID,
    selected_option_ids: tuple[UUID, ...],
    client_revision: int,
    now: datetime | None = None,
) -> AttemptAnswer:
    saved_at = now or timezone.now()
    try:
        attempt = (
            Attempt.objects.select_for_update()
            .select_related("quiz_version")
            .get(
                id=attempt_id,
                user=user,
            )
        )
    except Attempt.DoesNotExist as error:
        raise AttemptRuleError("Attempt not found.") from error
    if attempt.status != Attempt.Status.ACTIVE:
        raise AttemptClosedError("This attempt is already closed.")
    if attempt.deadline_at and saved_at >= attempt.deadline_at:
        _finalize_attempt(attempt=attempt, submitted_at=saved_at, expired=True)
        raise AttemptClosedError("The server deadline has passed; the attempt was submitted.")
    try:
        attempt_question = AttemptQuestion.objects.get(
            id=attempt_question_id,
            attempt=attempt,
        )
    except AttemptQuestion.DoesNotExist as error:
        raise AttemptRuleError("Attempt question not found.") from error

    selected = [str(option_id) for option_id in selected_option_ids]
    if len(selected) > 1 or len(set(selected)) != len(selected):
        raise AttemptRuleError("This question accepts at most one selected option.")
    available_ids = {str(option["id"]) for option in attempt_question.option_snapshot}
    if set(selected) - available_ids:
        raise AttemptRuleError("The selected option does not belong to this question.")
    answer = (
        AttemptAnswer.objects.select_for_update().filter(attempt_question=attempt_question).first()
    )
    if answer is not None and client_revision <= answer.client_revision:
        if (
            client_revision == answer.client_revision
            and list(answer.selected_option_ids) == selected
        ):
            return answer
        raise AttemptConflictError(
            "A newer answer is already stored on the server.",
            current_answer=answer,
        )

    attempt.server_revision += 1
    attempt.save(update_fields=("server_revision", "updated_at"))
    if answer is None:
        answer = AttemptAnswer.objects.create(
            attempt_question=attempt_question,
            selected_option_ids=selected,
            client_revision=client_revision,
            server_revision=attempt.server_revision,
        )
    else:
        answer.selected_option_ids = selected
        answer.client_revision = client_revision
        answer.server_revision = attempt.server_revision
        answer.save(
            update_fields=(
                "selected_option_ids",
                "client_revision",
                "server_revision",
                "saved_at",
            )
        )
    publish_after_commit(
        QuizAttemptAutosaved(
            attempt_id=attempt.id,
            attempt_question_id=attempt_question.id,
            user_id=user.id,
            client_revision=answer.client_revision,
            server_revision=answer.server_revision,
            actor_id=user.id,
        )
    )
    return answer


def _finalize_attempt(*, attempt: Attempt, submitted_at: datetime, expired: bool) -> AttemptResult:
    existing = AttemptResult.objects.filter(attempt=attempt).first()
    if existing is not None:
        return existing
    questions = list(
        AttemptQuestion.objects.filter(attempt=attempt)
        .select_related("question_version__question")
        .prefetch_related("answer")
        .order_by("position")
    )
    score = Decimal("0.00")
    maximum = sum((item.max_points for item in questions), Decimal("0.00"))
    answered_count = 0
    outcomes: list[tuple[AttemptQuestion, bool]] = []
    for question in questions:
        answer = getattr(question, "answer", None)
        selected_ids, _, _ = _answer_payload(answer)
        if selected_ids:
            answered_count += 1
        correct = set(selected_ids) == set(question.correct_option_ids)
        if correct:
            score += question.max_points
        outcomes.append((question, correct))
    percentage = (
        (score * Decimal("100") / maximum).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if maximum
        else Decimal("0.00")
    )
    version = attempt.quiz_version
    attempt.status = Attempt.Status.EXPIRED if expired else Attempt.Status.SUBMITTED
    attempt.completed_at = submitted_at
    attempt.server_revision += 1
    attempt.save(update_fields=("status", "completed_at", "server_revision", "updated_at"))
    result = AttemptResult.objects.create(
        attempt=attempt,
        score_points=score,
        maximum_points=maximum,
        percentage=percentage,
        passed=percentage >= version.pass_percent,
        answered_count=answered_count,
        unanswered_count=len(questions) - answered_count,
        ranking_eligible=version.ranking_eligible,
        achievement_eligible=version.achievement_eligible,
        submitted_at=submitted_at,
    )
    for question, correct in outcomes:
        record_question_outcome(
            user=attempt.user,
            question_version=question.question_version,
            result_id=result.id,
            attempt_question_id=question.id,
            was_correct=correct,
            reviewed_at=submitted_at,
        )
    publish_after_commit(
        QuizAttemptSubmitted(
            attempt_id=attempt.id,
            result_id=result.id,
            user_id=attempt.user_id,
            quiz_id=attempt.quiz_id,
            quiz_version_id=version.id,
            mode=version.mode,
            percentage=str(result.percentage),
            passed=result.passed,
            ranking_eligible=result.ranking_eligible,
            achievement_eligible=result.achievement_eligible,
            actor_id=attempt.user_id,
        )
    )
    return result


@transaction.atomic
def submit_attempt(
    *,
    user: User,
    attempt_id: UUID,
    idempotency_key: UUID,
    now: datetime | None = None,
) -> AttemptResult:
    submitted_at = now or timezone.now()
    User.objects.select_for_update().only("id").get(id=user.id)
    receipt = (
        AttemptSubmissionReceipt.objects.select_related("result")
        .filter(
            user=user,
            idempotency_key=idempotency_key,
        )
        .first()
    )
    if receipt is not None:
        if receipt.attempt_id != attempt_id:
            raise AttemptConflictError("That idempotency key belongs to another submission.")
        return receipt.result
    try:
        attempt = (
            Attempt.objects.select_for_update()
            .select_related("quiz_version")
            .get(
                id=attempt_id,
                user=user,
            )
        )
    except Attempt.DoesNotExist as error:
        raise AttemptRuleError("Attempt not found.") from error
    result = AttemptResult.objects.filter(attempt=attempt).first()
    if result is None:
        expired = bool(attempt.deadline_at and submitted_at >= attempt.deadline_at)
        result = _finalize_attempt(
            attempt=attempt,
            submitted_at=submitted_at,
            expired=expired,
        )
    AttemptSubmissionReceipt.objects.create(
        user=user,
        attempt=attempt,
        result=result,
        idempotency_key=idempotency_key,
    )
    return result


@transaction.atomic
def refresh_attempt_state(*, user: User, attempt_id: UUID, now: datetime | None = None) -> Attempt:
    checked_at = now or timezone.now()
    try:
        attempt = (
            Attempt.objects.select_for_update()
            .select_related("quiz_version")
            .get(
                id=attempt_id,
                user=user,
            )
        )
    except Attempt.DoesNotExist as error:
        raise AttemptRuleError("Attempt not found.") from error
    if (
        attempt.status == Attempt.Status.ACTIVE
        and attempt.deadline_at
        and checked_at >= attempt.deadline_at
    ):
        _finalize_attempt(attempt=attempt, submitted_at=checked_at, expired=True)
        attempt.refresh_from_db()
    return attempt


def result_is_released(*, result: AttemptResult, now: datetime | None = None) -> bool:
    version = result.attempt.quiz_version
    if version.result_release == QuizVersion.ResultRelease.IMMEDIATE:
        return True
    checked_at = now or timezone.now()
    return bool(version.available_until and checked_at >= version.available_until)


@transaction.atomic
def record_attempt_activity(
    *,
    user: User,
    attempt_id: UUID,
    client_event_id: UUID,
    activity_type: str,
    client_occurred_at: datetime | None,
    metadata: dict[str, object],
) -> AttemptActivity:
    try:
        attempt = Attempt.objects.get(id=attempt_id, user=user)
    except Attempt.DoesNotExist as error:
        raise AttemptRuleError("Attempt not found.") from error
    if activity_type not in AttemptActivity.ActivityType.values:
        raise AttemptRuleError("Unsupported assessment activity type.")
    allowed_metadata = {"reason", "connection"}
    if set(metadata) - allowed_metadata:
        raise AttemptRuleError("Activity metadata contains unsupported fields.")
    if len(json.dumps(metadata, separators=(",", ":"), default=str)) > 1024:
        raise AttemptRuleError("Activity metadata is too large.")
    existing = AttemptActivity.objects.filter(
        attempt=attempt,
        client_event_id=client_event_id,
    ).first()
    if existing is not None:
        if existing.activity_type != activity_type or existing.metadata != metadata:
            raise AttemptConflictError("That activity event identifier is already in use.")
        return existing
    return AttemptActivity.objects.create(
        attempt=attempt,
        client_event_id=client_event_id,
        activity_type=activity_type,
        client_occurred_at=client_occurred_at,
        metadata=metadata,
    )


@transaction.atomic
def create_question_issue_report(
    *,
    user: User,
    result_id: UUID,
    attempt_question_id: UUID,
    category: str,
    details: str,
) -> QuestionIssueReport:
    if category not in QuestionIssueReport.Category.values:
        raise AttemptRuleError("Unsupported report category.")
    if not details.strip():
        raise AttemptRuleError("Report details are required.")
    try:
        result = AttemptResult.objects.select_related("attempt").get(
            id=result_id,
            attempt__user=user,
        )
        question = AttemptQuestion.objects.get(
            id=attempt_question_id,
            attempt=result.attempt,
        )
    except (AttemptResult.DoesNotExist, AttemptQuestion.DoesNotExist) as error:
        raise AttemptRuleError("Assessment result question not found.") from error
    answer = AttemptAnswer.objects.filter(attempt_question=question).first()
    evidence = {
        "question_version_id": str(question.question_version_id),
        "prompt": question.prompt,
        "options": question.option_snapshot,
        "correct_option_ids": question.correct_option_ids,
        "selected_option_ids": list(answer.selected_option_ids) if answer else [],
        "result_id": str(result.id),
    }
    existing = QuestionIssueReport.objects.filter(
        reporter=user,
        result=result,
        attempt_question=question,
    ).first()
    if existing is not None:
        return existing
    report = QuestionIssueReport.objects.create(
        reporter=user,
        result=result,
        attempt_question=question,
        category=category,
        details=details.strip(),
        evidence_snapshot=evidence,
    )
    publish_after_commit(
        AssessmentReportCreated(
            report_id=report.id,
            result_id=result.id,
            attempt_question_id=question.id,
            reporter_id=user.id,
            category=category,
            actor_id=user.id,
        )
    )
    return report
