from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.study_plans.exam_models import ExamSchedule
from apps.study_plans.tests.test_foundation import curriculum  # noqa: F401

from ..daily import daily_review_payload
from ..models import ReviewAnswerLog, ReviewItem
from ..policy import review_priority
from ..selectors import with_answer_confidence
from ..services import record_question_attempt
from .test_review import attempt_event

pytestmark = pytest.mark.django_db


def bank_item(user, number=1, subject_key="catalog:oral-pathology"):
    return record_question_attempt(
        event=attempt_event(
            user=user,
            event_number=number,
            canonical_key=f"question:{number}",
            subject_key=subject_key,
        )
    ).review_item


def test_confidence_and_active_time_are_optional_validated_and_retry_safe():
    user = create_user(with_trial=True)
    item = bank_item(user)
    client = APIClient()
    client.force_authenticate(user)
    path = f"/api/v1/review-bank/items/{item.pk}/answer"
    payload = {
        "selected_option_ids": ["b"],
        "idempotency_key": str(uuid4()),
        "confidence": "unsure",
        "active_seconds": 42,
    }
    for invalid in ({"active_seconds": 0}, {"active_seconds": 901}, {"confidence": "guess"}):
        assert client.post(path, {**payload, **invalid}, format="json").status_code == 400
    answer = client.post(path, payload, format="json")
    replay = client.post(path, {**payload, "active_seconds": 50}, format="json")
    assert answer.status_code == replay.status_code == 200
    assert answer.json()["was_correct"] is True
    assert replay.json()["confidence"] == "unsure"
    assert replay.json()["active_seconds"] == 42
    assert ReviewAnswerLog.objects.filter(user=user).count() == 1
    item.refresh_from_db()
    assert item.state == ReviewItem.State.HIDDEN
    assert item.mastery_level == 1
    annotated = with_answer_confidence(ReviewItem.objects.filter(pk=item.pk), user=user).get()
    plain = ReviewItem.objects.get(pk=item.pk)
    now = timezone.now()
    assert review_priority(annotated, now=now) == review_priority(plain, now=now) + 5


def test_daily_timing_uses_recent_owned_samples_and_keeps_cold_start_honest():
    user = create_user()
    stranger = create_user(email="timing-other@example.com")
    item = bank_item(user)
    now = timezone.now()
    assert daily_review_payload(user=user, now=now)["personalized_timing"] is False
    for index, seconds in enumerate([20, 40, 40, 40, 40, 300]):
        ReviewAnswerLog.objects.create(
            user=user,
            review_item=item,
            idempotency_key=uuid4(),
            context="review_bank",
            selected_option_ids=["a"],
            was_correct=False,
            active_seconds=seconds,
            answered_at=now - timedelta(minutes=index + 1),
        )
    ReviewAnswerLog.objects.create(
        user=stranger,
        review_item=bank_item(stranger),
        idempotency_key=uuid4(),
        context="review_bank",
        selected_option_ids=["a"],
        was_correct=False,
        active_seconds=5,
        answered_at=now,
    )
    ReviewAnswerLog.objects.create(
        user=user,
        review_item=item,
        idempotency_key=uuid4(),
        context="review_bank",
        selected_option_ids=["a"],
        was_correct=False,
        active_seconds=120,
        answered_at=now - timedelta(days=61),
    )
    payload = daily_review_payload(user=user, now=now)
    assert payload["personalized_timing"] is True
    assert payload["seconds_per_question"] == 40
    assert payload["timing_sample_count"] == 6
    assert "correct_option_ids" not in payload["results"][0]


def test_exam_priority_uses_only_visible_current_cohort_schedules(curriculum, settings):  # noqa: F811
    user = curriculum["user"]
    period = curriculum["period"]
    subject = curriculum["subject"]
    now = timezone.now()
    period.starts_on = timezone.localdate() + timedelta(days=1)
    period.save()
    exam = ExamSchedule.objects.create(
        period=period,
        subject=subject,
        scheduled_on=timezone.localdate() + timedelta(days=7),
        status="confirmed",
    )
    urgent = bank_item(user, 1, f"catalog:{subject.material_slug}")
    other = bank_item(user, 2)
    leaf = bank_item(user, 3, f"content:{curriculum['lesson'].id}")
    ReviewItem.objects.filter(pk=other.pk).update(mistake_count=8)
    now = timezone.now()
    payload = daily_review_payload(user=user, now=now)
    assert payload["results"][0]["id"] == urgent.id
    assert "exam_soon" in payload["results"][0]["priority_reasons"]
    assert payload["results"][0]["exam_on"] == exam.scheduled_on.isoformat()
    assert (
        next(row for row in payload["results"] if row["id"] == leaf.id)["exam_on"]
        == exam.scheduled_on.isoformat()
    )
    exam.status = "draft"
    exam.save()
    assert daily_review_payload(user=user, now=now)["results"][0]["id"] == other.id
    exam.status = "confirmed"
    exam.save()
    settings.STUDY_PLAN_V2_USER_IDS = [str(uuid4())]
    assert daily_review_payload(user=user, now=now)["results"][0]["id"] == other.id
    settings.STUDY_PLAN_V2_USER_IDS = []
    user.cohort = None
    user.save()
    assert all(
        "exam_soon" not in row["priority_reasons"]
        for row in daily_review_payload(user=user, now=now)["results"]
    )
