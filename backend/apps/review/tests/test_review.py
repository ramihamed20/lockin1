from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.accounts.tests.helpers import create_user

from ..contracts import QuestionAttemptEvent
from ..models import MistakeEvent, ReviewAnswerLog, ReviewItem, WeeklyRecallQuestion
from ..policy import iso_week_key, select_diverse_weekly_items
from ..selectors import latest_mistakes
from ..services import (
    answer_review_item,
    create_or_resume_weekly_recall,
    record_question_attempt,
)

pytestmark = pytest.mark.django_db

OPTIONS = (
    {"id": "a", "text": "Incorrect answer"},
    {"id": "b", "text": "Correct answer"},
)


def attempt_event(
    *,
    user,
    event_number: int,
    canonical_key: str = "external:question-1",
    subject_key: str = "catalog:oral-pathology",
    subject_label: str = "Oral Pathology",
    answered_at=None,
) -> QuestionAttemptEvent:
    return QuestionAttemptEvent(
        user=user,
        event_key=f"test-event:{event_number}",
        canonical_key=canonical_key,
        subject_key=subject_key,
        subject_label=subject_label,
        source_type=ReviewItem.SourceType.SHEET,
        source_id="sheet-4",
        source_label="Sheet 4",
        source_question_index=event_number,
        prompt=f"Question {canonical_key}",
        explanation="A reliable explanation.",
        options=OPTIONS,
        selected_option_ids=("a",),
        correct_option_ids=("b",),
        is_correct=False,
        answered_at=answered_at or timezone.now(),
    )


def test_latest_four_events_do_not_delete_history_or_duplicate_review_item() -> None:
    user = create_user()
    started = timezone.now()
    for index in range(5):
        recorded = record_question_attempt(
            event=attempt_event(
                user=user,
                event_number=index,
                answered_at=started + timedelta(minutes=index),
            )
        )
        assert recorded.created is True

    recent = list(latest_mistakes(user=user, limit=4))
    assert [item.event_key for item in recent] == [
        "test-event:4",
        "test-event:3",
        "test-event:2",
        "test-event:1",
    ]
    assert MistakeEvent.objects.filter(user=user).count() == 5
    item = ReviewItem.objects.get(user=user)
    assert item.mistake_count == 5
    assert item.state == ReviewItem.State.ACTIVE


def test_review_answer_lifecycle_is_idempotent_and_preserves_hidden_item() -> None:
    user = create_user()
    item = record_question_attempt(event=attempt_event(user=user, event_number=1)).review_item
    assert item is not None

    wrong_key = uuid4()
    wrong = answer_review_item(
        user=user,
        review_item_id=item.id,
        selected_option_ids=("a",),
        idempotency_key=wrong_key,
        context=ReviewAnswerLog.Context.REVIEW_BANK,
    )
    replay = answer_review_item(
        user=user,
        review_item_id=item.id,
        selected_option_ids=("a",),
        idempotency_key=wrong_key,
        context=ReviewAnswerLog.Context.REVIEW_BANK,
    )
    assert replay.answer_log.id == wrong.answer_log.id
    item.refresh_from_db()
    assert item.review_incorrect_count == 1
    assert item.mistake_count == 2
    assert MistakeEvent.objects.filter(user=user).count() == 2

    corrected = answer_review_item(
        user=user,
        review_item_id=item.id,
        selected_option_ids=("b",),
        idempotency_key=uuid4(),
        context=ReviewAnswerLog.Context.REVIEW_BANK,
    )
    assert corrected.answer_log.was_correct is True
    item.refresh_from_db()
    assert item.state == ReviewItem.State.HIDDEN
    assert item.mastery_level == 1
    assert item.review_correct_count == 1
    assert ReviewItem.objects.filter(id=item.id).exists()


def test_weekly_recall_is_stable_diverse_and_reactivates_failed_memory() -> None:
    user = create_user()
    subject_keys = ("catalog:anatomy", "catalog:physiology", "catalog:histology")
    items = []
    for index, subject_key in enumerate(subject_keys):
        item = record_question_attempt(
            event=attempt_event(
                user=user,
                event_number=index,
                canonical_key=f"external:{index}",
                subject_key=subject_key,
                subject_label=subject_key.split(":", 1)[1].title(),
            )
        ).review_item
        assert item is not None
        answer_review_item(
            user=user,
            review_item_id=item.id,
            selected_option_ids=("b",),
            idempotency_key=uuid4(),
            context=ReviewAnswerLog.Context.REVIEW_BANK,
        )
        items.append(item)

    selected = select_diverse_weekly_items(items, now=timezone.now(), limit=3)
    assert {item.subject_key for item in selected} == set(subject_keys)

    session, created = create_or_resume_weekly_recall(user=user)
    replay, replay_created = create_or_resume_weekly_recall(user=user)
    assert created is True
    assert replay_created is False
    assert replay.id == session.id
    assert session.week_key == iso_week_key(session.started_at)
    assert WeeklyRecallQuestion.objects.filter(session=session).count() == 3

    question = WeeklyRecallQuestion.objects.filter(session=session).first()
    assert question is not None
    failed = answer_review_item(
        user=user,
        review_item_id=question.review_item_id,
        selected_option_ids=("a",),
        idempotency_key=uuid4(),
        context=ReviewAnswerLog.Context.WEEKLY_RECALL,
        weekly_question_id=question.id,
    )
    assert failed.answer_log.was_correct is False
    question.review_item.refresh_from_db()
    assert question.review_item.state == ReviewItem.State.ACTIVE
    assert question.review_item.mastery_level == 0
    assert question.review_item.relearning_count == 1


def test_correct_first_answer_never_creates_review_history() -> None:
    user = create_user()
    event = attempt_event(user=user, event_number=1)
    correct = replace(
        event,
        selected_option_ids=("b",),
        is_correct=True,
    )
    recorded = record_question_attempt(event=correct)
    assert recorded.review_item is None
    assert ReviewItem.objects.filter(user=user).count() == 0
    assert MistakeEvent.objects.filter(user=user).count() == 0
