import json
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.content.models import LearningObjectVersion
from apps.content.policies import can_view_learning_object
from apps.content.selectors import published_learning_object
from apps.education.models import EducationNode
from apps.questions.models import QuestionVersion
from platform_core.events import publish_after_commit

from .events import LessonCompleted
from .models import (
    Bookmark,
    LearningProgress,
    LessonProgress,
    QuestionReview,
    QuestionReviewLog,
)


class ProgressRuleError(ValueError):
    pass


class ProgressConflictError(ProgressRuleError):
    pass


def _validate_position(*, content_type: str, position: dict[str, object]) -> dict[str, object]:
    if len(json.dumps(position, separators=(",", ":"))) > 2048:
        raise ProgressRuleError("The resume position is too large.")
    if content_type == LearningObjectVersion.ContentType.PDF:
        allowed = {"page", "zoom"}
        page = position.get("page")
        if page is not None and (not isinstance(page, int) or isinstance(page, bool) or page < 1):
            raise ProgressRuleError("PDF page must be a positive integer.")
    elif content_type == LearningObjectVersion.ContentType.AUDIO:
        allowed = {"seconds"}
        seconds = position.get("seconds")
        if seconds is not None and (
            not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds < 0
        ):
            raise ProgressRuleError("Audio position cannot be negative.")
    else:
        allowed = set()
    if set(position) - allowed:
        raise ProgressRuleError("The resume position contains unsupported fields.")
    return position


@transaction.atomic
def set_bookmark(*, user: User, learning_object_id: UUID) -> tuple[Bookmark, bool]:
    learning_object = published_learning_object(learning_object_id=learning_object_id)
    if not can_view_learning_object(user=user, learning_object=learning_object):
        raise ProgressRuleError("This learning object is not available.")
    return Bookmark.objects.get_or_create(user=user, learning_object=learning_object)


def remove_bookmark(*, user: User, learning_object_id: UUID) -> bool:
    deleted, _ = Bookmark.objects.filter(user=user, learning_object_id=learning_object_id).delete()
    return deleted > 0


@transaction.atomic
def update_learning_progress(
    *,
    user: User,
    learning_object_id: UUID,
    expected_revision: int,
    status: str,
    completion_percent: int,
    position: dict[str, object],
) -> LearningProgress:
    learning_object = published_learning_object(learning_object_id=learning_object_id)
    if not can_view_learning_object(user=user, learning_object=learning_object):
        raise ProgressRuleError("This learning object is not available.")
    version = learning_object.published_version
    if version is None:
        raise ProgressRuleError("This learning object has no published version.")
    if status not in LearningProgress.Status.values:
        raise ProgressRuleError("Unsupported progress status.")
    if not 0 <= completion_percent <= 100:
        raise ProgressRuleError("Completion percent must be between 0 and 100.")
    validated_position = _validate_position(
        content_type=version.content_type,
        position=position,
    )
    progress = (
        LearningProgress.objects.select_for_update()
        .filter(user=user, learning_object=learning_object)
        .first()
    )
    if progress is None:
        if expected_revision != 0:
            raise ProgressConflictError("Progress changed. Reload it and try again.")
        progress = LearningProgress(
            user=user,
            learning_object=learning_object,
            version=version,
            status=status,
            completion_percent=completion_percent,
            position=validated_position,
            revision=1,
        )
    else:
        if progress.revision != expected_revision:
            raise ProgressConflictError("Progress changed. Reload it and try again.")
        progress.version = version
        progress.status = status
        progress.completion_percent = completion_percent
        progress.position = validated_position
        progress.revision += 1
    if status == LearningProgress.Status.COMPLETED:
        progress.completion_percent = 100
        progress.completed_at = progress.completed_at or timezone.now()
    else:
        progress.completed_at = None
    progress.full_clean()
    progress.save()
    return progress


@transaction.atomic
def complete_lesson(*, user: User, lesson_id: UUID, expected_revision: int) -> LessonProgress:
    try:
        lesson = EducationNode.objects.get(
            id=lesson_id,
            kind=EducationNode.Kind.LESSON,
            is_discoverable=True,
        )
    except EducationNode.DoesNotExist as error:
        raise ProgressRuleError("Lesson not found.") from error
    progress = LessonProgress.objects.select_for_update().filter(user=user, lesson=lesson).first()
    if progress is None:
        if expected_revision != 0:
            raise ProgressConflictError("Lesson progress changed. Reload it and try again.")
        progress = LessonProgress(user=user, lesson=lesson, completed_at=timezone.now())
        progress.save()
        publish_after_commit(
            LessonCompleted(lesson_id=lesson.id, user_id=user.id, actor_id=user.id)
        )
        return progress
    if progress.revision != expected_revision:
        raise ProgressConflictError("Lesson progress changed. Reload it and try again.")
    return progress


def _review_state(review: QuestionReview | None) -> dict[str, object]:
    if review is None:
        return {}
    return {
        "due_at": review.due_at.isoformat(),
        "interval_days": review.interval_days,
        "ease_factor": str(review.ease_factor),
        "repetitions": review.repetitions,
        "lapses": review.lapses,
        "revision": review.revision,
    }


@transaction.atomic
def record_question_outcome(
    *,
    user: User,
    question_version: QuestionVersion,
    result_id: UUID,
    attempt_question_id: UUID,
    was_correct: bool,
    reviewed_at: datetime,
) -> QuestionReview:
    existing_log = QuestionReviewLog.objects.filter(
        result_id=result_id,
        question=question_version.question,
    ).first()
    if existing_log is not None:
        return QuestionReview.objects.get(user=user, question=question_version.question)

    review = (
        QuestionReview.objects.select_for_update()
        .filter(user=user, question=question_version.question)
        .first()
    )
    previous_state = _review_state(review)
    if review is None:
        review = QuestionReview(
            user=user,
            question=question_version.question,
            last_question_version=question_version,
            due_at=reviewed_at,
            last_reviewed_at=reviewed_at,
        )

    if was_correct:
        if review.repetitions == 0:
            interval_days = 1
        elif review.repetitions == 1:
            interval_days = 6
        else:
            interval_days = max(1, round(review.interval_days * float(review.ease_factor)))
        review.repetitions += 1
        review.interval_days = interval_days
        review.ease_factor = min(Decimal("3.00"), review.ease_factor + Decimal("0.05"))
    else:
        review.repetitions = 0
        review.interval_days = 1
        review.lapses += 1
        review.ease_factor = max(Decimal("1.30"), review.ease_factor - Decimal("0.20"))

    review.last_question_version = question_version
    review.last_was_correct = was_correct
    review.last_reviewed_at = reviewed_at
    review.due_at = reviewed_at + timedelta(days=review.interval_days)
    if review.pk and not review._state.adding:
        review.revision += 1
    review.full_clean()
    review.save()
    QuestionReviewLog.objects.create(
        user=user,
        question=question_version.question,
        question_version=question_version,
        result_id=result_id,
        attempt_question_id=attempt_question_id,
        was_correct=was_correct,
        previous_state=previous_state,
        new_state=_review_state(review),
        reviewed_at=reviewed_at,
    )
    return review
