"""One-file imports use the same permissions, validation and revision checks as JSON."""

from __future__ import annotations

import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from ..admin_serializers import AdminAllQuestionsValidateSerializer
from ..models import ActiveStudyQuestionContent
from .test_all_questions import _context, _document, _question, _world

pytestmark = pytest.mark.django_db


def _file(document):
    return SimpleUploadedFile(
        "all-questions.json",
        b"\xef\xbb\xbf" + json.dumps(document).encode(),
        content_type="application/json",
    )


def test_large_file_validates_and_saves_all_banks_with_multipart_revision_metadata() -> None:
    _, sheet, client, base = _world(pages=6)
    context = _context(client, base)
    document = _document(context, normal=2)
    for bank in document["active_study"].values():
        for group in [*bank["parts"], bank["final_exam"]]:
            for question in group["questions"]:
                question["explanation"] = "Explanation supported by the sheet. " * 500
    assert len(json.dumps(document).encode()) > 2_621_440
    metadata = {"sheet_question_count": "2", "excluded_start_pages": "1"}
    # Above Django's default in-memory request-body limit; still one complete document.
    response = client.post(
        f"{base}/all-questions/validate",
        {**metadata, "payload_file": _file(document)},
        format="multipart",
    )
    assert response.status_code == 200, response.json()
    assert response.json()["valid"] is True
    assert not ActiveStudyQuestionContent.objects.filter(sheet=sheet).exists()
    response = client.put(
        f"{base}/all-questions",
        {
            **metadata,
            "payload_file": _file(document),
            "settings_revision": str(context["settings_revision"]),
            "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
            "publish_sheet_questions": "false",
        },
        format="multipart",
    )
    assert response.status_code == 200, response.json()
    assert response.json()["summary"]["total_received"] == context["active_study_total"] + 2
    assert ActiveStudyQuestionContent.objects.filter(sheet=sheet).count() == 3
    # Reusing stale revision metadata still fails; files do not bypass optimistic locking.
    stale = client.put(
        f"{base}/all-questions",
        {
            **metadata,
            "payload_file": _file(document),
            "settings_revision": str(context["settings_revision"]),
            "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
        },
        format="multipart",
    )
    assert stale.status_code == 409
    assert set(
        ActiveStudyQuestionContent.objects.filter(sheet=sheet).values_list("revision", flat=True)
    ) == {1}


def test_invalid_file_reports_question_location_and_never_writes() -> None:
    _, sheet, client, base = _world(pages=6)
    document = _document(_context(client, base), normal=0)
    document["active_study"]["hard"]["final_exam"]["questions"][0]["correct_answer"] = "Z"
    response = client.put(
        f"{base}/all-questions",
        {
            "payload_file": _file(document),
            "sheet_question_count": "0",
            "settings_revision": "1",
            "expected_revisions": '{"easy":0,"medium":0,"hard":0}',
        },
        format="multipart",
    )
    assert response.status_code == 400, response.json()
    assert response.json()["errors"][0]["section"] == "Hard → Final Exam → Question 1"
    assert not ActiveStudyQuestionContent.objects.filter(sheet=sheet).exists()


def test_multipart_text_payload_remains_compatible_and_unknown_fields_are_rejected() -> None:
    _, _, client, base = _world(pages=6)
    document = _document(_context(client, base), normal=0)
    data = {"payload": json.dumps(document), "sheet_question_count": "0"}
    response = client.post(f"{base}/all-questions/validate", data, format="multipart")
    assert response.status_code == 200, response.json()
    response = client.post(
        f"{base}/all-questions/validate", {**data, "unexpected": "value"}, format="multipart"
    )
    assert response.status_code == 400


@pytest.mark.parametrize("content", [b"{truncated", b"\xff\xfe"])
def test_invalid_json_or_encoding_is_rejected(content: bytes) -> None:
    serializer = AdminAllQuestionsValidateSerializer(
        data={
            "payload_file": SimpleUploadedFile("bank.json", content),
            "sheet_question_count": 0,
        }
    )
    assert not serializer.is_valid()
    assert "payload_file" in serializer.errors


def test_file_size_and_exactly_one_source_are_enforced() -> None:
    upload = _file({})
    upload.size = 16 * 1024 * 1024 + 1
    for sources in ({}, {"payload": {}, "payload_file": _file({})}, {"payload_file": upload}):
        serializer = AdminAllQuestionsValidateSerializer(
            data={"sheet_question_count": 0, **sources}
        )
        assert not serializer.is_valid()


def test_file_import_requires_the_same_admin_permission() -> None:
    _, _, _, base = _world(pages=6)
    response = APIClient().post(
        f"{base}/all-questions/validate",
        {"payload_file": _file({}), "sheet_question_count": "0"},
        format="multipart",
    )
    assert response.status_code in (401, 403)


def test_page_errors_show_physical_page_and_mark_only_that_page_invalid() -> None:
    _, sheet, client, base = _world(pages=4)
    sheet.active_study_page_bank_enabled = True
    sheet.save(update_fields=["active_study_page_bank_enabled"])
    context = _context(client, base)
    document = {"active_study": {}, "sheet_questions": {"questions": []}}
    for row in context["difficulties"]:
        key = row["difficulty"]
        document["active_study"][key] = {
            "pages": [
                {"page": page, "questions": [_question(f"{key}-{page}-{i}") for i in range(15)]}
                for page in row["page_numbers"]
            ],
            "final_exam": {
                "questions": [
                    _question(f"{key}-final-{i}") for i in range(row["final_exam_questions"])
                ]
            },
        }
    document["active_study"]["medium"]["pages"][0]["questions"][2]["correct_answer"] = "Z"
    response = client.post(
        f"{base}/all-questions/validate",
        {"payload_file": _file(document), "sheet_question_count": "0"},
        format="multipart",
    )
    assert response.status_code == 400, response.json()
    body = response.json()
    assert body["errors"][0]["section"] == "Medium → Page 2 → Question 3"
    medium = next(row for row in body["summary"]["difficulties"] if row["difficulty"] == "medium")
    assert [(page["part"], page["ok"]) for page in medium["parts"]] == [(2, False), (3, True)]
