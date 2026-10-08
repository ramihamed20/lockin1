"""Grading a student's answer to a published question, once.

The client sends only which choices it picked. Correctness, the explanation and
the XP are all decided here from the published version, so nothing the browser
claims about the answer or its reward is trusted. XP is earned only by a correct
answer; a wrong one is recorded, locked and worth nothing.

Idempotency has two independent locks. ``QuestionAnswer`` is unique per student
and question, so a second submission -- a double tap, a retry after a dropped
response, a reopened sheet, another tab -- reads the recorded answer back and is
never graded again. And the XP goes through the shared ledger under a source
key that names the student and the question, whose own unique constraint makes
a second award impossible even if the first lock were bypassed.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.xp.services import award_xp

from .models import Question, QuestionAnswer, QuestionVersion

XP_BY_DIFFICULTY: dict[str, int] = {
    QuestionVersion.Difficulty.EASY.value: 5,
    QuestionVersion.Difficulty.MEDIUM.value: 10,
    QuestionVersion.Difficulty.HARD.value: 15,
}

# Stable across difficulty edits: a question re-published at another difficulty
# must not be able to earn a second award under a different rule.
XP_RULE_CODE = "question_answered_v1"


class AnswerRejected(ValueError):
    pass


def xp_source_key(*, user_id: UUID, question_id: UUID) -> str:
    return f"question-answer:{user_id}:{question_id}"


def _selection(version: QuestionVersion, choice_ids: Iterable[UUID]) -> list[UUID]:
    offered = {option.id for option in version.options.all()}
    selected = list(dict.fromkeys(choice_ids))
    if not selected:
        raise AnswerRejected("Choose an answer.")
    if any(choice_id not in offered for choice_id in selected):
        raise AnswerRejected("That choice does not belong to this question.")
    if version.question_type != QuestionVersion.QuestionType.MULTIPLE_SELECT and len(selected) > 1:
        raise AnswerRejected("This question takes one answer.")
    return selected


def _record_wrong(
    *,
    user: User,
    question: Question,
    version: QuestionVersion,
    selected: list[UUID],
    correct: set[UUID],
    event_key: str,
    now: datetime,
) -> None:
    """Put a wrong answer in the Review Bank; each distinct event counts once."""

    from apps.review.contracts import QuestionAttemptEvent
    from apps.review.models import ReviewItem
    from apps.review.services import record_question_attempt, subject_for_node

    subject = subject_for_node(version.academic_node)
    sheet = version.source_learning_object
    options = tuple({"id": str(option.id), "text": option.text} for option in version.options.all())
    record_question_attempt(
        event=QuestionAttemptEvent(
            user=user,
            event_key=event_key,
            canonical_key=f"question:{question.id}",
            subject_key=f"node:{subject.id}",
            subject_label=subject.title,
            source_type=ReviewItem.SourceType.SHEET,
            source_id=str(sheet.id) if sheet else "",
            source_label=(
                sheet.published_version.title
                if sheet and sheet.published_version
                else subject.title
            ),
            source_question_index=None,
            prompt=version.prompt,
            explanation=version.explanation,
            options=options,
            selected_option_ids=tuple(str(value) for value in selected),
            correct_option_ids=tuple(str(value) for value in correct),
            is_correct=False,
            answered_at=now,
            question_version=version,
            subject=subject,
        )
    )


def retry_question(
    *, user: User, question: Question, choice_ids: Iterable[UUID], retry_key: UUID
) -> tuple[bool, QuestionVersion, set[UUID], int]:
    """Grade another try at a question the student already answered.

    The first answer, its verdict and its XP stay as recorded. A wrong retry is
    one more mistake in the Review Bank, so the question's mistake count rises
    each time it is missed; a right one records nothing. ``retry_key`` makes a
    resent request count once. Returns whether it was right, the version it was
    graded against, the correct choices and the question's mistake count.
    """

    if not QuestionAnswer.objects.filter(user=user, question=question).exists():
        raise AnswerRejected("Answer this question first.")
    version = question.published_version
    if version is None or question.retired_at is not None:
        raise AnswerRejected("This question is not available.")
    selected = _selection(version, choice_ids)
    correct = {option.id for option in version.options.all() if option.is_correct}
    is_correct = set(selected) == correct
    if not is_correct:
        _record_wrong(
            user=user,
            question=question,
            version=version,
            selected=selected,
            correct=correct,
            event_key=f"normal-question-retry:{retry_key}",
            now=timezone.now(),
        )
    from apps.review.models import ReviewItem

    mistakes = (
        ReviewItem.objects.filter(user=user, canonical_key=f"question:{question.id}")
        .values_list("mistake_count", flat=True)
        .first()
    )
    return is_correct, version, correct, mistakes or 0


def answer_question(
    *, user: User, question: Question, choice_ids: Iterable[UUID]
) -> tuple[QuestionAnswer, bool]:
    """Record and grade the student's answer; ``False`` means it was already recorded."""

    existing = QuestionAnswer.objects.filter(user=user, question=question).first()
    if existing is not None:
        return existing, False

    version = question.published_version
    if version is None or question.retired_at is not None:
        raise AnswerRejected("This question is not available.")
    selected = _selection(version, choice_ids)
    correct = {option.id for option in version.options.all() if option.is_correct}
    is_correct = set(selected) == correct
    points = XP_BY_DIFFICULTY.get(version.difficulty, XP_BY_DIFFICULTY["medium"])
    now = timezone.now()

    try:
        with transaction.atomic():
            # The row is written whatever the verdict: a wrong answer is locked
            # exactly like a right one, so it can never be retaken for XP.
            answer = QuestionAnswer.objects.create(
                user=user,
                question=question,
                version=version,
                selected_option_ids=[str(choice_id) for choice_id in selected],
                is_correct=is_correct,
                answered_at=now,
            )
            if not is_correct:
                _record_wrong(
                    user=user,
                    question=question,
                    version=version,
                    selected=selected,
                    correct=correct,
                    event_key=f"normal-question:{answer.id}",
                    now=now,
                )
                return answer, True
            award, created = award_xp(
                user_id=user.id,
                source_key=xp_source_key(user_id=user.id, question_id=question.id),
                source_event_id=None,
                source_event_name="questions.question.answered",
                source_object_id=question.id,
                rule_code=XP_RULE_CODE,
                points=points,
                category="learning",
                reason=f"{version.get_difficulty_display()} question answered",
                occurred_at=now,
                ranking_eligible=True,
            )
            if created:
                answer.xp_awarded = award.points
                answer.save(update_fields=("xp_awarded",))
    except IntegrityError:
        # A concurrent submission recorded the answer first. Theirs stands.
        return QuestionAnswer.objects.get(user=user, question=question), False
    return answer, True
