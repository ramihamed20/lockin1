from uuid import uuid4

import pytest
from pytest_django.fixtures import DjangoAssertNumQueries
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.tests.helpers import create_admin, published_path
from apps.questions.tests.helpers import published_question

from ..models import QuizVersion
from .helpers import published_quiz

pytestmark = pytest.mark.django_db


def test_student_assessment_flow_never_leaks_answer_key_before_submission() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    question = published_question(actor=admin, node=lesson)
    quiz = published_quiz(actor=admin, node=lesson, questions=(question,))
    client = APIClient()
    client.force_authenticate(student)

    listing = client.get(f"/api/v1/quizzes?node={lesson.id}")
    detail = client.get(f"/api/v1/quizzes/{quiz.id}")
    assert listing.status_code == detail.status_code == 200
    assert listing.json()["results"][0]["id"] == str(quiz.id)
    assert "question_links" not in detail.json()["version"]

    start_key = uuid4()
    started = client.post(
        f"/api/v1/quizzes/{quiz.id}/attempts",
        {"idempotency_key": str(start_key)},
        format="json",
    )
    assert started.status_code == 201
    attempt = started.json()["attempt"]
    question_payload = attempt["questions"][0]
    assert "correct_option_ids" not in question_payload
    assert "explanation" not in question_payload
    assert attempt["deadline_at"] is not None
    assert attempt["server_time"] is not None

    resumed = client.post(
        f"/api/v1/quizzes/{quiz.id}/attempts",
        {"idempotency_key": str(start_key)},
        format="json",
    )
    assert resumed.status_code == 200
    assert resumed.json()["resumed"] is True

    source_version = question.published_version
    assert source_version is not None
    correct_id = str(source_version.options.get(is_correct=True).id)
    answer = client.put(
        f"/api/v1/attempts/{attempt['id']}/questions/{question_payload['id']}/answer",
        {"selected_option_ids": [correct_id], "client_revision": 1},
        format="json",
    )
    assert answer.status_code == 200
    assert answer.json()["server_revision"] == 2

    activity = client.post(
        f"/api/v1/attempts/{attempt['id']}/activities",
        {
            "client_event_id": str(uuid4()),
            "activity_type": "workspace_entered",
            "metadata": {},
        },
        format="json",
    )
    assert activity.status_code == 201

    submitted = client.post(
        f"/api/v1/attempts/{attempt['id']}/submit",
        {"idempotency_key": str(uuid4())},
        format="json",
    )
    assert submitted.status_code == 200
    result = submitted.json()
    assert result["released"] is True
    assert result["percentage"] == "100.00"
    assert result["questions"][0]["correct_option_ids"] == [correct_id]
    assert result["questions"][0]["explanation"]
    assert client.get(f"/api/v1/assessment-results/{result['id']}").status_code == 200

    report = client.post(
        f"/api/v1/assessment-results/{result['id']}/reports",
        {
            "attempt_question_id": question_payload["id"],
            "category": "ambiguous",
            "details": "Please review this wording.",
        },
        format="json",
    )
    assert report.status_code == 201
    assert "evidence_snapshot" not in report.json()
    assert client.get("/api/v1/assessment-review").status_code == 200


def test_answer_revision_conflict_returns_authoritative_server_answer() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    question = published_question(actor=admin, node=lesson)
    quiz = published_quiz(actor=admin, node=lesson, questions=(question,))
    client = APIClient()
    client.force_authenticate(student)
    attempt = client.post(
        f"/api/v1/quizzes/{quiz.id}/attempts",
        {"idempotency_key": str(uuid4())},
        format="json",
    ).json()["attempt"]
    snapshot = attempt["questions"][0]
    first_id = snapshot["option_snapshot"][0]["id"]
    second_id = snapshot["option_snapshot"][1]["id"]
    url = f"/api/v1/attempts/{attempt['id']}/questions/{snapshot['id']}/answer"
    assert (
        client.put(
            url,
            {"selected_option_ids": [first_id], "client_revision": 1},
            format="json",
        ).status_code
        == 200
    )

    conflict = client.put(
        url,
        {"selected_option_ids": [second_id], "client_revision": 1},
        format="json",
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "answer_revision_conflict"
    assert conflict.json()["error"]["fields"]["current_answer"]["selected_option_ids"] == [first_id]


def test_management_quiz_workflow_and_student_authorization() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    question = published_question(actor=admin, node=lesson)
    student_client = APIClient()
    student_client.force_authenticate(student)
    assert student_client.post("/api/v1/management/quizzes", {}, format="json").status_code == 403

    client = APIClient()
    client.force_authenticate(admin)
    payload = {
        "academic_node_id": str(lesson.id),
        "title": "Anatomy mastery",
        "instructions": "Choose one answer.",
        "mode": "mastery",
        "selection_mode": "fixed",
        "question_count": 1,
        "question_ids": [str(question.id)],
        "duration_seconds": 600,
        "maximum_attempts": 1,
        "randomize_questions": True,
        "randomize_options": True,
        "result_release": "immediate",
        "pass_percent": "80.00",
        "ranking_eligible": False,
        "achievement_eligible": True,
        "focus_required": True,
        "allowed_difficulties": [],
        "language": "en",
        "metadata": {},
    }
    created = client.post("/api/v1/management/quizzes", payload, format="json")
    assert created.status_code == 201
    quiz = created.json()
    assert quiz["current_version"]["question_links"][0]["question_id"] == str(question.id)
    assert client.get("/api/v1/management/quizzes").json()["count"] == 1
    assert client.get(f"/api/v1/management/quizzes/{quiz['id']}").status_code == 200

    revised = client.patch(
        f"/api/v1/management/quizzes/{quiz['id']}",
        {**payload, "title": "Anatomy mastery revised", "expected_revision": quiz["revision"]},
        format="json",
    ).json()
    reviewed = client.post(
        f"/api/v1/management/quizzes/{quiz['id']}/submit",
        {"expected_revision": revised["revision"]},
        format="json",
    ).json()
    rejected = client.post(
        f"/api/v1/management/quizzes/{quiz['id']}/reject",
        {"expected_revision": reviewed["revision"], "review_note": "Clarify timing."},
        format="json",
    ).json()
    final_draft = client.patch(
        f"/api/v1/management/quizzes/{quiz['id']}",
        {**payload, "expected_revision": rejected["revision"]},
        format="json",
    ).json()
    final_review = client.post(
        f"/api/v1/management/quizzes/{quiz['id']}/submit",
        {"expected_revision": final_draft["revision"]},
        format="json",
    ).json()
    published = client.post(
        f"/api/v1/management/quizzes/{quiz['id']}/publish",
        {"expected_revision": final_review["revision"]},
        format="json",
    )
    assert published.status_code == 200
    retired = client.post(
        f"/api/v1/management/quizzes/{quiz['id']}/retire",
        {"expected_revision": published.json()["revision"]},
        format="json",
    )
    assert retired.json()["workflow_status"] == "retired"


def test_public_quiz_list_query_count_is_bounded(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    question = published_question(actor=admin, node=lesson)
    for index in range(4):
        published_quiz(
            actor=admin,
            node=lesson,
            questions=(question,),
            mode=QuizVersion.Mode.PRACTICE,
            title=f"Practice {index}",
        )
    client = APIClient()
    client.force_authenticate(student)

    with django_assert_max_num_queries(4):
        response = client.get(f"/api/v1/quizzes?node={lesson.id}&page_size=25")

    assert response.status_code == 200
    assert response.json()["count"] == 4
