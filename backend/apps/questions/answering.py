"""Grading a student's answer to a published question, once.

The client sends only which choices it picked. Correctness, the explanation and
the XP are all decided here from the published version, so nothing the browser
claims about the answer or its reward is trusted.

Idempotency has two independent locks. ``QuestionAnswer`` is unique per student
and question, so a second submission -- a double tap, a retry after a dropped
response, a reopened sheet, another tab -- reads the recorded answer back and is
never graded again. And the XP goes through the shared ledger under a source
key that names the student and the question, whose own unique constraint makes
a second award impossible even if the first lock were bypassed.
"""

from __future__ import annotations

from collections.abc import Iterable
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
    points = XP_BY_DIFFICULTY.get(version.difficulty, XP_BY_DIFFICULTY["medium"])
    now = timezone.now()

    try:
        with transaction.atomic():
            answer = QuestionAnswer.objects.create(
                user=user,
                question=question,
                version=version,
                selected_option_ids=[str(choice_id) for choice_id in selected],
                is_correct=set(selected) == correct,
                answered_at=now,
            )
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
