from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.discovery.models import SearchEntry
from apps.education.services import ScopeCapabilities, grant_creator_scope
from apps.education.tests.helpers import create_admin, create_creator, published_path
from platform_core.events import DomainEvent, domain_events

from ..events import QuestionPublished
from ..models import Question, QuestionVersion
from ..selectors import published_question
from ..services import (
    QuestionConflictError,
    QuestionInput,
    QuestionOptionInput,
    QuestionRuleError,
    create_question,
    publish_question,
    reject_question,
    revise_question,
    submit_question_for_review,
)
from .helpers import question_input

pytestmark = pytest.mark.django_db


def test_question_validation_rejects_ambiguous_answer_keys() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    with pytest.raises(QuestionRuleError, match="Exactly one"):
        create_question(
            actor=admin,
            data=QuestionInput(
                academic_node=lesson,
                question_type=QuestionVersion.QuestionType.SINGLE_CHOICE,
                prompt="Select an answer",
                options=(
                    QuestionOptionInput(text="A", is_correct=True),
                    QuestionOptionInput(text="B", is_correct=True),
                ),
            ),
        )
    with pytest.raises(QuestionRuleError, match="exactly two"):
        create_question(
            actor=admin,
            data=QuestionInput(
                academic_node=lesson,
                question_type=QuestionVersion.QuestionType.TRUE_FALSE,
                prompt="A true or false prompt",
                options=(
                    QuestionOptionInput(text="True", is_correct=True),
                    QuestionOptionInput(text="False"),
                    QuestionOptionInput(text="Unknown"),
                ),
            ),
        )


def test_published_question_keeps_immutable_release_and_emits_event(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    question = create_question(actor=admin, data=question_input(node=lesson))
    question = submit_question_for_review(
        actor=admin,
        question_id=question.id,
        expected_revision=question.revision,
    )
    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(QuestionPublished, received.append)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            question = publish_question(
                actor=admin,
                question_id=question.id,
                expected_revision=question.revision,
            )
    finally:
        unsubscribe()

    published_version_id = question.published_version_id
    assert SearchEntry.objects.get(resource_id=question.id).summary == ""
    assert len(received) == 1
    assert received[0].event_name == "question.published"

    question = revise_question(
        actor=admin,
        question_id=question.id,
        expected_revision=question.revision,
        data=question_input(node=lesson, prompt="Revised private prompt"),
    )
    public = published_question(question_id=question.id)
    assert question.current_version_id != published_version_id
    assert public.published_version_id == published_version_id
    with pytest.raises(QuestionConflictError):
        revise_question(
            actor=admin,
            question_id=question.id,
            expected_revision=question.revision - 1,
            data=question_input(node=lesson),
        )


def test_assessment_creator_scope_is_separate_from_content_scope() -> None:
    admin = create_admin()
    creator = create_creator()
    _, subject, lesson = published_path(admin=admin)
    grant_creator_scope(
        actor=admin,
        user=creator,
        node=subject,
        capabilities=ScopeCapabilities(can_create_content=True),
    )
    with pytest.raises(QuestionRuleError, match="cannot create assessments"):
        create_question(actor=creator, data=question_input(node=lesson))

    grant_creator_scope(
        actor=admin,
        user=creator,
        node=subject,
        capabilities=ScopeCapabilities(can_create_assessments=True),
    )
    question = create_question(actor=creator, data=question_input(node=lesson))
    question = submit_question_for_review(
        actor=creator,
        question_id=question.id,
        expected_revision=question.revision,
    )
    with pytest.raises(QuestionRuleError, match="cannot publish"):
        publish_question(
            actor=creator,
            question_id=question.id,
            expected_revision=question.revision,
        )


def test_question_rejection_retirement_and_management_api() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    student_client = APIClient()
    student_client.force_authenticate(student)
    assert student_client.post("/api/v1/management/questions", {}, format="json").status_code == 403

    client = APIClient()
    client.force_authenticate(admin)
    payload = {
        "academic_node_id": str(lesson.id),
        "question_type": "single_choice",
        "prompt": "Which nerve supplies the face?",
        "explanation": "The facial nerve.",
        "difficulty": "medium",
        "language": "en",
        "metadata": {},
        "options": [
            {"text": "Trigeminal", "is_correct": False},
            {"text": "Facial", "is_correct": True},
        ],
    }
    created_response = client.post("/api/v1/management/questions", payload, format="json")
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["current_version"]["options"][1]["is_correct"] is True
    assert client.get("/api/v1/management/questions").json()["count"] == 1
    assert client.get(f"/api/v1/management/questions/{created['id']}").status_code == 200

    submitted = client.post(
        f"/api/v1/management/questions/{created['id']}/submit",
        {"expected_revision": created["revision"]},
        format="json",
    ).json()
    rejected = client.post(
        f"/api/v1/management/questions/{created['id']}/reject",
        {"expected_revision": submitted["revision"], "review_note": "Clarify scope."},
        format="json",
    )
    assert rejected.status_code == 200
    rejected_payload = rejected.json()
    revised = client.patch(
        f"/api/v1/management/questions/{created['id']}",
        {
            **payload,
            "prompt": "Which nerve controls facial expression?",
            "expected_revision": rejected_payload["revision"],
        },
        format="json",
    ).json()
    reviewed = client.post(
        f"/api/v1/management/questions/{created['id']}/submit",
        {"expected_revision": revised["revision"]},
        format="json",
    ).json()
    published = client.post(
        f"/api/v1/management/questions/{created['id']}/publish",
        {"expected_revision": reviewed["revision"]},
        format="json",
    )
    assert published.status_code == 200
    retired = client.post(
        f"/api/v1/management/questions/{created['id']}/retire",
        {"expected_revision": published.json()["revision"]},
        format="json",
    )
    assert retired.json()["workflow_status"] == Question.WorkflowStatus.RETIRED
    assert not SearchEntry.objects.filter(resource_id=created["id"]).exists()


def test_reject_service_requires_feedback() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    question = create_question(actor=admin, data=question_input(node=lesson))
    question = submit_question_for_review(
        actor=admin,
        question_id=question.id,
        expected_revision=question.revision,
    )
    with pytest.raises(QuestionRuleError, match="feedback"):
        reject_question(
            actor=admin,
            question_id=question.id,
            expected_revision=question.revision,
            review_note=" ",
        )
