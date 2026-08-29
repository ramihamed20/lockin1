from __future__ import annotations

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.admin_services import create_sheet
from apps.content.models import LearningObjectAsset
from apps.education.tests.helpers import create_admin, pdf_upload, published_path
from apps.files.models import ManagedFile
from apps.files.services import create_managed_file
from apps.notifications.models import Notification
from apps.questions import admin_services
from apps.questions.importing import QuestionImportValidationError, validate_question_import
from apps.questions.models import Question, QuestionImportBatch, QuestionVersion

pytestmark = pytest.mark.django_db


def _payload() -> dict[str, object]:
    return {
        "version": "lockin_questions_v1",
        "questions": [
            {
                "type": "mcq",
                "question": "Which layer contains melanocytes?",
                "choices": ["Basal", "Spinous", "Granular", "Cornified"],
                "correct_answer": "Basal",
                "explanation": "Melanocytes reside in the basal layer.",
                "difficulty": "easy",
                "topic": "Epidermis",
                "source_page": 7,
            },
            {
                "type": "true_false",
                "question": "Keratinocytes are the main epidermal cell.",
                "correct_answer": True,
                "explanation": "They form most of the epidermis.",
                "difficulty": "medium",
                "topic": "Epidermis",
                "source_page": None,
            },
            {
                "type": "multiple_select",
                "question": "Select epidermal cells.",
                "choices": ["Keratinocyte", "Melanocyte", "Fibroblast", "Osteocyte"],
                "correct_answers": ["Keratinocyte", "Melanocyte"],
                "explanation": "Both are normal epidermal cell types.",
                "difficulty": "hard",
                "topic": "Cells",
                "source_page": 8,
            },
        ],
    }


def _sheet(*, admin: Any, subject: Any, title: str = "Skin", publish: bool = False):
    managed_file = create_managed_file(
        owner=admin,
        upload=pdf_upload(name=f"{title.lower().replace(' ', '-')}.pdf"),
        kind="pdf",
    )
    return create_sheet(
        actor=admin,
        subject=subject,
        managed_file=managed_file,
        title=title,
        summary="A managed lecture sheet.",
        position=2,
        publish=publish,
        notify_students=False,
        allow_download=False,
    )


def test_content_management_requires_operational_capabilities() -> None:
    student = create_user()
    client = APIClient()
    client.force_authenticate(student)

    assert client.get("/api/v1/operations/admin/content/subjects").status_code == 403
    assert (
        client.post(
            "/api/v1/operations/admin/content/sheets/00000000-0000-0000-0000-000000000001/questions/validate",
            {"payload": _payload()},
            format="json",
        ).status_code
        == 403
    )


def test_sheet_create_publish_notify_update_unpublish_and_safe_delete() -> None:
    admin = create_admin()
    student = create_user()
    _, subject, _ = published_path(admin=admin)
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(name="skin.pdf"), kind="pdf")
    client = APIClient()
    client.force_authenticate(admin)

    created_response = client.post(
        f"/api/v1/operations/admin/content/subjects/{subject.id}/sheets",
        {
            "title": "Skin",
            "summary": "Lecture sheet",
            "primary_file_id": str(managed_file.id),
            "position": 4,
            "publish": True,
            "notify_students": True,
            "allow_download": False,
        },
        format="json",
    )

    assert created_response.status_code == 201
    created = created_response.json()
    assert created["workflow_status"] == "published"
    assert created["position"] == 4
    assert Notification.objects.filter(
        recipient=student,
        template_key="content.sheet_published",
        data__group_key=f"new-sheets:{subject.id}",
    ).exists()

    updated_response = client.patch(
        f"/api/v1/operations/admin/content/sheets/{created['id']}",
        {"expected_revision": created["revision"], "title": "Skin revised", "position": 1},
        format="json",
    )
    assert updated_response.status_code == 200
    updated = updated_response.json()
    assert updated["title"] == "Skin revised"
    assert updated["workflow_status"] == "published"

    unpublished_response = client.post(
        f"/api/v1/operations/admin/content/sheets/{created['id']}/actions",
        {"expected_revision": updated["revision"], "action": "unpublish"},
        format="json",
    )
    assert unpublished_response.status_code == 200
    assert unpublished_response.json()["workflow_status"] == "draft"
    assert client.get(f"/api/v1/learning-objects/{created['id']}").status_code == 404

    blocked_delete = client.delete(f"/api/v1/operations/admin/content/sheets/{created['id']}")
    assert blocked_delete.status_code == 400
    assert "publication history" in blocked_delete.json()["error"]["message"]


def test_removing_pdf_unpublishes_but_retains_historical_asset() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject, publish=True)
    historical_asset = LearningObjectAsset.objects.get(
        version=sheet.current_version,
        role=LearningObjectAsset.Role.PRIMARY,
    )
    file_id = historical_asset.managed_file_id
    client = APIClient()
    client.force_authenticate(admin)

    response = client.delete(
        f"/api/v1/operations/admin/content/sheets/{sheet.id}/pdf",
        {"expected_revision": sheet.revision},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["workflow_status"] == "draft"
    assert response.json()["pdf"] is None
    assert ManagedFile.objects.filter(id=file_id).exists()
    assert LearningObjectAsset.objects.filter(id=historical_asset.id).exists()


def test_json_validate_import_history_and_safe_undo() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject)
    client = APIClient()
    client.force_authenticate(admin)

    validated = client.post(
        f"/api/v1/operations/admin/content/sheets/{sheet.id}/questions/validate",
        {"payload": _payload()},
        format="json",
    )
    assert validated.status_code == 200
    assert validated.json()["type_counts"] == {
        "mcq": 1,
        "true_false": 1,
        "multiple_select": 1,
    }

    imported = client.post(
        f"/api/v1/operations/admin/content/sheets/{sheet.id}/questions/import",
        {"payload": _payload(), "publish": True},
        format="json",
    )
    assert imported.status_code == 201
    batch = imported.json()["batch"]
    questions = Question.objects.filter(import_batch_id=batch["id"])
    assert questions.count() == 3
    assert set(questions.values_list("workflow_status", flat=True)) == {"published"}
    versions = QuestionVersion.objects.filter(question__import_batch_id=batch["id"])
    assert set(versions.values_list("source_learning_object_id", flat=True)) == {sheet.id}
    assert set(versions.values_list("question_type", flat=True)) == {
        "single_choice",
        "true_false",
        "multiple_select",
    }

    history = client.get("/api/v1/operations/admin/content/imports")
    assert history.status_code == 200
    assert history.json()["results"][0]["batch_id"] == batch["batch_id"]
    wrong_confirmation = client.post(
        f"/api/v1/operations/admin/content/imports/{batch['id']}/undo",
        {"confirmation": "question_import_wrong"},
        format="json",
    )
    assert wrong_confirmation.status_code == 400

    undone = client.post(
        f"/api/v1/operations/admin/content/imports/{batch['id']}/undo",
        {"confirmation": batch["batch_id"]},
        format="json",
    )
    assert undone.status_code == 200
    assert undone.json()["status"] == "undone"
    assert set(questions.values_list("workflow_status", flat=True)) == {"retired"}


def test_import_validation_rejects_schema_answer_and_unknown_fields() -> None:
    invalid_payloads = [
        {**_payload(), "version": "unknown"},
        {
            "version": "lockin_questions_v1",
            "questions": [
                {
                    "type": "mcq",
                    "question": "Invalid answer",
                    "choices": ["A", "B"],
                    "correct_answer": "C",
                }
            ],
        },
        {
            "version": "lockin_questions_v1",
            "questions": [{"type": "essay", "question": "Unsupported"}],
        },
        {**_payload(), "unsafe_extra": True},
    ]

    for payload in invalid_payloads:
        with pytest.raises(QuestionImportValidationError):
            validate_question_import(payload)


def test_import_is_atomic_when_question_creation_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject)
    original = admin_services.create_question
    call_count = 0

    def fail_second(*args: Any, **kwargs: Any):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("simulated write failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(admin_services, "create_question", fail_second)
    with pytest.raises(RuntimeError, match="simulated write failure"):
        admin_services.import_questions(
            actor=admin,
            sheet=sheet,
            payload=_payload(),
            publish=False,
        )

    assert QuestionImportBatch.objects.count() == 0
    assert Question.objects.count() == 0


def test_bulk_move_preserves_version_history_and_can_publish() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    source = _sheet(admin=admin, subject=subject, title="Source")
    target = _sheet(admin=admin, subject=subject, title="Target")
    batch, _ = admin_services.import_questions(
        actor=admin,
        sheet=source,
        payload={"version": "lockin_questions_v1", "questions": [_payload()["questions"][0]]},
        publish=False,
    )
    question = batch.questions.get()
    original_version_id = question.current_version_id
    client = APIClient()
    client.force_authenticate(admin)

    moved = client.post(
        "/api/v1/operations/admin/content/questions/bulk",
        {
            "question_ids": [str(question.id)],
            "action": "move",
            "target_sheet_id": str(target.id),
        },
        format="json",
    )
    assert moved.status_code == 200
    question.refresh_from_db()
    assert question.current_version.source_learning_object_id == target.id
    assert question.current_version_id != original_version_id
    assert question.versions.filter(id=original_version_id).exists()

    published = client.post(
        "/api/v1/operations/admin/content/questions/bulk",
        {"question_ids": [str(question.id)], "action": "publish"},
        format="json",
    )
    assert published.status_code == 200
    question.refresh_from_db()
    assert question.workflow_status == Question.WorkflowStatus.PUBLISHED


def test_student_attempt_contract_excludes_source_page() -> None:
    from apps.assessments.serializers import AttemptQuestionSerializer, ResultQuestionSerializer
    from apps.review.serializers import ReviewAnswerWriteSerializer

    assert "source_page" not in AttemptQuestionSerializer.Meta.fields
    assert "source_page" not in ResultQuestionSerializer.Meta.fields
    assert "source_learning_object_id" not in AttemptQuestionSerializer.Meta.fields
    multiple_review_answer = ReviewAnswerWriteSerializer(
        data={
            "idempotency_key": "00000000-0000-4000-8000-000000000999",
            "selected_option_ids": ["a", "b"],
        }
    )
    assert multiple_review_answer.is_valid(), multiple_review_answer.errors
