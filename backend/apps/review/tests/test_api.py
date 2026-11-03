from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user

from ..models import MistakeEvent, ReviewItem

pytestmark = pytest.mark.django_db


def attempt_payload(*, key=None):
    return {
        "idempotency_key": str(key or uuid4()),
        "question_key": "demo:oral-pathology:sheet-4:q18",
        "subject_key": "catalog:oral-pathology",
        "subject_label": "Oral Pathology",
        "source_type": "sheet",
        "source_id": "oral-pathology:sheet-4",
        "source_label": "Sheet 4",
        "source_question_index": 18,
        "prompt": "What is the most common site of oral cancer?",
        "explanation": "Review the original sheet explanation.",
        "options": [
            {"id": "x", "text": "Incorrect"},
            {"id": "y", "text": "Correct"},
        ],
        "selected_option_ids": ["x"],
        "correct_option_ids": ["y"],
    }


def test_question_attempt_review_bank_and_user_isolation_api() -> None:
    owner = create_user(email="owner@example.com", with_trial=True)
    stranger = create_user(email="stranger@example.com", with_trial=True)
    owner_client = APIClient()
    owner_client.force_authenticate(owner)
    stranger_client = APIClient()
    stranger_client.force_authenticate(stranger)
    key = uuid4()

    created = owner_client.post(
        "/api/v1/question-attempts", attempt_payload(key=key), format="json"
    )
    replay = owner_client.post("/api/v1/question-attempts", attempt_payload(key=key), format="json")
    queue = owner_client.get("/api/v1/review-queue")
    bank = owner_client.get("/api/v1/review-bank")

    assert created.status_code == 201
    assert replay.status_code == 200
    assert queue.status_code == 200
    assert queue.json()["count"] == 1
    assert queue.json()["results"][0]["selected_answers"] == ["Incorrect"]
    assert bank.json()["active_count"] == 1
    assert MistakeEvent.objects.filter(user=owner).count() == 1

    item = ReviewItem.objects.get(user=owner)
    assert stranger_client.get("/api/v1/review-queue").json()["count"] == 0
    assert stranger_client.get("/api/v1/review-bank").json()["active_count"] == 0
    denied = stranger_client.post(
        f"/api/v1/review-bank/items/{item.id}/answer",
        {"idempotency_key": str(uuid4()), "selected_option_ids": ["y"]},
        format="json",
    )
    assert denied.status_code == 400
    item.refresh_from_db()
    assert item.state == ReviewItem.State.ACTIVE


def test_review_answer_and_weekly_recall_api_round_trip() -> None:
    user = create_user(with_trial=True)
    client = APIClient()
    client.force_authenticate(user)
    client.post("/api/v1/question-attempts", attempt_payload(), format="json")
    item = ReviewItem.objects.get(user=user)

    corrected = client.post(
        f"/api/v1/review-bank/items/{item.id}/answer",
        {"idempotency_key": str(uuid4()), "selected_option_ids": ["y"]},
        format="json",
    )
    weekly_status = client.get("/api/v1/weekly-recall")
    weekly = client.post("/api/v1/weekly-recall", {}, format="json")
    resumed = client.post("/api/v1/weekly-recall", {}, format="json")

    assert corrected.status_code == 200
    assert corrected.json()["was_correct"] is True
    assert weekly_status.json()["available"] is True
    assert weekly.status_code == 201
    assert resumed.status_code == 200
    assert resumed.json()["session"]["id"] == weekly.json()["session"]["id"]


def test_daily_review_is_bounded_due_owned_and_does_not_reveal_answers() -> None:
    from datetime import timedelta

    from django.utils import timezone

    owner = create_user(with_trial=True)
    stranger = create_user(email="daily-stranger@example.com", with_trial=True)
    client = APIClient()
    client.force_authenticate(owner)
    now = timezone.now()

    def item(user, key, **overrides):
        values = {
            "user": user,
            "canonical_key": key,
            "subject_key": key.split(":")[0],
            "subject_label_snapshot": "Subject",
            "source_type": "sheet",
            "prompt_snapshot": "Question",
            "explanation_snapshot": "Private explanation",
            "options_snapshot": [{"id": "x", "text": "X"}, {"id": "y", "text": "Y"}],
            "correct_option_ids_snapshot": ["y"],
            "mistake_count": 1,
            "first_mistake_at": now,
            "last_mistake_at": now,
            "next_review_at": now - timedelta(days=1),
        }
        values.update(overrides)
        return ReviewItem.objects.create(**values)

    for index in range(23):
        item(owner, f"a:{index}")
    repeated = item(owner, "b:repeated", mistake_count=4)
    item(owner, "future", next_review_at=now + timedelta(days=1))
    item(owner, "hidden", state=ReviewItem.State.HIDDEN)
    item(owner, "unanswerable", correct_option_ids_snapshot=[])
    item(stranger, "private", mistake_count=100)
    response = client.get("/api/v1/review-bank/daily")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 20
    assert payload["due_count"] == 24
    assert payload["results"][0]["id"] == str(repeated.id)
    assert len({row["id"] for row in payload["results"]}) == 20
    assert all(row["subject_key"] in {"a", "b"} for row in payload["results"])
    assert all(
        "correct_option_ids" not in row and "explanation" not in row for row in payload["results"]
    )
    assert ReviewItem.objects.filter(user=owner, state=ReviewItem.State.ACTIVE).count() == 26
    overview = client.get("/api/v1/review-bank").json()
    assert overview["due_count"] == 24
    assert sum(subject["due_count"] for subject in overview["subjects"]) == 24
    assert client.get("/api/v1/review-bank/daily").json() == payload
    anonymous = APIClient().get("/api/v1/review-bank/daily")
    assert anonymous.status_code in (401, 403)
