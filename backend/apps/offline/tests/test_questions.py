from uuid import uuid4

import pytest

from apps.content.tests.test_catalog_questions import _client, _year_fixture
from apps.entitlements.offline_lease import issue_offline_lease
from apps.questions.models import Question

pytestmark = pytest.mark.django_db


def test_offline_question_bundle_and_sync_keep_server_authoritative_xp() -> None:
    fixture = _year_fixture()
    first = fixture["years"]["year-1"]
    second = fixture["years"]["year-2"]
    sheet = first["sheet"]
    student = first["student"]
    question = Question.objects.get(published_version__source_learning_object=sheet)
    bundle = _client(student).get(f"/api/v1/offline/questions/{sheet.id}/?source=ai-sheet")
    denied = _client(second["student"]).get(
        f"/api/v1/offline/questions/{sheet.id}/?source=ai-sheet"
    )
    assert bundle.status_code == 200
    assert denied.status_code == 403
    assert bundle.json()["count"] == 1
    correct_choice = bundle.json()["answer_keys"][str(question.id)]["correct_choice_ids"][0]
    operation = {
        "operation_id": str(uuid4()),
        "operation_type": "question_answer",
        "payload": {
            "sheet_id": str(sheet.id),
            "question_id": str(question.id),
            "choice_ids": [correct_choice],
            "xp_to_add": 999,
        },
    }
    lease_token = issue_offline_lease(user=student)["token"]
    result = _client(student).post(
        "/api/v1/offline/sync/",
        {"lease_token": lease_token, "operations": [operation]},
        format="json",
    )
    retry = _client(student).post(
        "/api/v1/offline/sync/",
        {"lease_token": lease_token, "operations": [operation]},
        format="json",
    )
    assert result.status_code == retry.status_code == 200
    assert result.json()["accepted"][0]["result"]["xp_awarded"] == 5
    assert retry.json()["xp_total"] == result.json()["xp_total"] == 5
