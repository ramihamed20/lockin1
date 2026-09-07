from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.education.tests.helpers import create_admin, pdf_upload, published_path
from apps.files.services import create_managed_file

from ..admin_services import create_sheet
from ..models import ActiveStudyQuestionContent

pytestmark = pytest.mark.django_db


def _sheet(*, admin: Any, subject: Any):
    return create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(
            owner=admin, upload=pdf_upload(name="active.pdf"), kind="pdf"
        ),
        title="Active sheet",
        summary="",
        position=0,
        publish=False,
        notify_students=False,
        allow_download=False,
    )


def _question(label: str) -> dict[str, object]:
    return {
        "question": f"Question {label}?",
        "options": {"A": f"A {label}", "B": f"B {label}", "C": f"C {label}", "D": f"D {label}"},
        "correct_answer": "B",
        "explanation": f"Explanation {label}.",
    }


def _payload(parts: int = 4, questions_per_part: int = 15, final_questions: int = 50):
    return {
        "parts": [
            {
                "part": part,
                "questions": [
                    _question(f"P{part}-{question}")
                    for question in range(1, questions_per_part + 1)
                ],
            }
            for part in range(1, parts + 1)
        ],
        "final_exam": {
            "questions": [_question(f"F-{question}") for question in range(1, final_questions + 1)]
        },
    }


def _configured_client() -> tuple[APIClient, Any, Any]:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject)
    client = APIClient()
    client.force_authenticate(admin)
    settings = client.patch(
        f"/api/v1/operations/admin/content/sheets/{sheet.id}/active-study",
        {
            "expected_revision": 0,
            "enabled": True,
            "total_pdf_pages": 22,
            "excluded_start_pages": 1,
            "excluded_end_pages": 0,
        },
        format="json",
    )
    assert settings.status_code == 200
    return client, admin, sheet


def _endpoint(sheet: Any) -> str:
    return f"/api/v1/operations/admin/content/sheets/{sheet.id}/active-study/questions/medium"


def test_valid_content_import_is_saved_ordered_and_audited() -> None:
    client, _, sheet = _configured_client()
    payload = _payload()
    assert client.post(_endpoint(sheet), {"payload": payload}, format="json").status_code == 200
    saved = client.put(
        _endpoint(sheet), {"expected_revision": 0, "payload": payload}, format="json"
    )
    assert saved.status_code == 200
    content = saved.json()["content"]
    assert content["status"] == "ready"
    assert content["checkpoint_question_count"] == 60
    assert content["final_exam_question_count"] == 50
    assert content["payload"]["parts"][0]["questions"][0]["question"] == "Question P1-1?"
    assert ActiveStudyQuestionContent.objects.filter(sheet=sheet, difficulty="medium").count() == 1
    assert AuditRecord.objects.filter(action="content.active_study_questions_imported").exists()


@pytest.mark.parametrize(
    "payload",
    [
        _payload(parts=3),
        _payload(questions_per_part=14),
        _payload(questions_per_part=16),
        _payload(final_questions=49),
        _payload(final_questions=51),
    ],
)
def test_invalid_part_and_question_counts_are_rejected(payload: dict[str, object]) -> None:
    client, _, sheet = _configured_client()
    response = client.post(_endpoint(sheet), {"payload": payload}, format="json")
    assert response.status_code == 400
    assert response.json()["errors"]


@pytest.mark.parametrize(
    "change",
    [
        lambda payload: payload["parts"][0]["questions"][0]["options"].pop("D"),
        lambda payload: payload["parts"][0]["questions"][0]["options"].update({"E": "extra"}),
        lambda payload: payload["parts"][0]["questions"][0].update({"correct_answer": "E"}),
        lambda payload: payload["parts"][0]["questions"][0].pop("explanation"),
        lambda payload: payload["parts"][0]["questions"][0].update({"question": "   "}),
        lambda payload: payload["parts"][1].update({"part": 1}),
        lambda payload: payload["parts"][0].pop("part"),
    ],
)
def test_invalid_mcq_and_part_structure_are_rejected(change: Any) -> None:
    client, _, sheet = _configured_client()
    payload = _payload()
    change(payload)
    response = client.post(_endpoint(sheet), {"payload": payload}, format="json")
    assert response.status_code == 400
    assert response.json()["errors"]


def test_malformed_payload_and_duplicate_questions_are_rejected_without_writes() -> None:
    client, _, sheet = _configured_client()
    malformed = client.post(_endpoint(sheet), {"payload": "not an object"}, format="json")
    assert malformed.status_code == 400
    duplicate = _payload()
    duplicate["parts"][0]["questions"][1]["question"] = duplicate["parts"][0]["questions"][0][
        "question"
    ]
    response = client.put(
        _endpoint(sheet), {"expected_revision": 0, "payload": duplicate}, format="json"
    )
    assert response.status_code == 400
    assert not ActiveStudyQuestionContent.objects.filter(sheet=sheet).exists()


def test_invalid_replacement_keeps_previous_content_and_delete_is_scoped() -> None:
    client, _, sheet = _configured_client()
    payload = _payload()
    assert (
        client.put(
            _endpoint(sheet), {"expected_revision": 0, "payload": payload}, format="json"
        ).status_code
        == 200
    )
    original = ActiveStudyQuestionContent.objects.get(sheet=sheet, difficulty="medium")
    old_revision = original.revision
    invalid = deepcopy(payload)
    invalid["final_exam"]["questions"].pop()
    rejected = client.put(
        _endpoint(sheet), {"expected_revision": old_revision, "payload": invalid}, format="json"
    )
    assert rejected.status_code == 400
    original.refresh_from_db()
    assert original.revision == old_revision
    assert original.payload == payload
    deleted = client.delete(_endpoint(sheet), {"expected_revision": old_revision}, format="json")
    assert deleted.status_code == 204
    assert not ActiveStudyQuestionContent.objects.filter(sheet=sheet, difficulty="medium").exists()
    assert AuditRecord.objects.filter(action="content.active_study_questions_deleted").exists()


def test_permissions_disable_retention_and_changed_plan_needs_review() -> None:
    client, _, sheet = _configured_client()
    payload = _payload()
    assert (
        client.put(
            _endpoint(sheet), {"expected_revision": 0, "payload": payload}, format="json"
        ).status_code
        == 200
    )

    student = create_user()
    denied = APIClient()
    denied.force_authenticate(student)
    assert denied.get(_endpoint(sheet)).status_code == 403
    assert (
        denied.put(
            _endpoint(sheet), {"expected_revision": 1, "payload": payload}, format="json"
        ).status_code
        == 403
    )

    settings_endpoint = f"/api/v1/operations/admin/content/sheets/{sheet.id}/active-study"
    current = client.get(settings_endpoint).json()
    disabled = client.patch(
        settings_endpoint,
        {
            "expected_revision": current["revision"],
            "enabled": False,
            "total_pdf_pages": 22,
            "excluded_start_pages": 1,
            "excluded_end_pages": 0,
        },
        format="json",
    )
    assert disabled.status_code == 200
    assert ActiveStudyQuestionContent.objects.filter(sheet=sheet, difficulty="medium").exists()

    changed = client.patch(
        settings_endpoint,
        {
            "expected_revision": disabled.json()["revision"],
            "enabled": False,
            "total_pdf_pages": 26,
            "excluded_start_pages": 1,
            "excluded_end_pages": 0,
            "confirm_boundary_change": True,
        },
        format="json",
    )
    assert changed.status_code == 200
    medium = next(item for item in changed.json()["difficulties"] if item["difficulty"] == "medium")
    assert medium["number_of_parts"] == 5
    assert medium["content"]["status"] == "needs_review"
