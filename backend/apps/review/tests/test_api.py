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
