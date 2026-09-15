"""A sheet's two editions: one question bank, two PDFs, identical capability."""

from __future__ import annotations

import io
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from pypdf import PdfWriter
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.models import AcademicProgram, StudentCohort
from apps.education.tests.helpers import create_admin, published_path
from apps.files.services import create_managed_file

from ..active_study import part_sizes_for_count
from ..admin_services import _primary_file, create_sheet
from ..editions import LOCKIN, UNIVERSITY

pytestmark = pytest.mark.django_db


def _pdf(pages: int, name: str) -> SimpleUploadedFile:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="application/pdf")


def _questions(*, parts: int, per_part: int = 15, final: int = 50) -> dict[str, Any]:
    def question(index: int) -> dict[str, Any]:
        return {
            "question": f"Question {index}?",
            "options": {"A": "A1", "B": "B1", "C": "C1", "D": "D1"},
            "correct_answer": "B",
            "explanation": "Because B.",
        }

    counter = iter(range(1, parts * per_part + final + 1))
    return {
        "parts": [
            {"part": part, "questions": [question(next(counter)) for _ in range(per_part)]}
            for part in range(1, parts + 1)
        ],
        "final_exam": {"questions": [question(next(counter)) for _ in range(final)]},
    }


@pytest.mark.parametrize(
    ("pages", "parts", "expected"),
    [(18, 4, (4, 4, 4, 6)), (22, 4, (5, 5, 5, 7)), (4, 4, (1, 1, 1, 1)), (9, 3, (3, 3, 3))],
)
def test_an_edition_splits_its_own_pages_into_the_sheets_part_count(
    pages: int, parts: int, expected: tuple[int, ...]
) -> None:
    assert part_sizes_for_count(eligible_pages=pages, number_of_parts=parts) == expected


def _sheet(*, admin: Any, subject: Any, pages: int = 22):
    return create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(
            owner=admin, upload=_pdf(pages, "university.pdf"), kind="pdf"
        ),
        title="Patho",
        summary="",
        position=0,
        publish=True,
        notify_students=False,
        allow_download=False,
    )


def test_both_editions_plan_the_same_parts_from_one_question_bank() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject, pages=22)
    client = APIClient()
    client.force_authenticate(admin)
    base = f"/api/v1/operations/admin/content/sheets/{sheet.id}"

    university = client.get(f"{base}/active-study").json()
    assert university["edition"] == UNIVERSITY
    assert university["total_pdf_pages"] == 22
    medium = next(item for item in university["difficulties"] if item["difficulty"] == "medium")
    assert medium["number_of_parts"] == 4
    assert medium["page_ranges"][-1] == {"part": 4, "start_page": 16, "end_page": 22}

    # The Lock-in edition does not exist until its PDF is uploaded.
    detail = client.get(base).json()
    assert [row["available"] for row in detail["editions"]] == [True, False]

    lockin_file = create_managed_file(owner=admin, upload=_pdf(18, "lockin.pdf"), kind="pdf")
    uploaded = client.post(
        f"{base}/lockin-pdf",
        {"expected_revision": detail["revision"], "lockin_file_id": str(lockin_file.id)},
        format="json",
    )
    assert uploaded.status_code == 200
    editions = {row["edition"]: row for row in uploaded.json()["editions"]}
    assert editions[LOCKIN]["available"] is True
    assert editions[LOCKIN]["page_count"] == 18

    # Same parts, its own page ranges, without importing a second question set.
    lockin = client.get(f"{base}/active-study?edition=lockin").json()
    assert lockin["edition"] == LOCKIN
    assert lockin["total_pdf_pages"] == 18
    assert lockin["parts_follow_university"] is True
    for difficulty in ("easy", "medium", "hard"):
        theirs = next(item for item in lockin["difficulties"] if item["difficulty"] == difficulty)
        ours = next(item for item in university["difficulties"] if item["difficulty"] == difficulty)
        assert theirs["number_of_parts"] == ours["number_of_parts"]
        assert theirs["page_ranges"][0]["start_page"] == 1
        assert theirs["page_ranges"][-1]["end_page"] == 18
    lockin_medium = next(item for item in lockin["difficulties"] if item["difficulty"] == "medium")
    assert [row["end_page"] - row["start_page"] + 1 for row in lockin_medium["page_ranges"]] == [
        4,
        4,
        4,
        6,
    ]


def test_one_imported_question_bank_makes_both_editions_ready_for_students() -> None:
    admin = create_admin()
    student = create_user()
    institution, subject, _ = published_path(admin=admin)
    program = AcademicProgram.objects.create(code="ed", name_en="E", name_ar="E")
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Y1", name_ar="Y1"
    )
    cohort.content_nodes.set([institution])
    student.cohort = cohort
    student.save(update_fields=["cohort"])
    sheet = _sheet(admin=admin, subject=subject, pages=22)
    client = APIClient()
    client.force_authenticate(admin)
    base = f"/api/v1/operations/admin/content/sheets/{sheet.id}"

    lockin_file = create_managed_file(owner=admin, upload=_pdf(18, "lockin.pdf"), kind="pdf")
    revision = client.get(base).json()["revision"]
    assert (
        client.post(
            f"{base}/lockin-pdf",
            {"expected_revision": revision, "lockin_file_id": str(lockin_file.id)},
            format="json",
        ).status_code
        == 200
    )

    for edition in (UNIVERSITY, LOCKIN):
        current = client.get(f"{base}/active-study?edition={edition}").json()
        saved = client.patch(
            f"{base}/active-study?edition={edition}",
            {"expected_revision": current["revision"], "enabled": True},
            format="json",
        )
        assert saved.status_code == 200, saved.json()
        assert saved.json()["enabled"] is True

    # One import, for the sheet -- not for an edition.
    imported = client.put(
        f"{base}/active-study/questions/medium",
        {"expected_revision": 0, "payload": _questions(parts=4)},
        format="json",
    )
    assert imported.status_code in {200, 201}, imported.json()

    for edition in (UNIVERSITY, LOCKIN):
        payload = client.get(f"{base}/active-study?edition={edition}").json()
        medium = next(item for item in payload["difficulties"] if item["difficulty"] == "medium")
        assert medium["readiness"]["ready"] is True, (edition, medium["readiness"])

    # The student sees one sheet offering both editions, each with its own
    # catalog address, page count and Active Study.
    student_client = APIClient()
    student_client.force_authenticate(student)
    results = student_client.get("/api/v1/catalog/materials").json()["results"]
    sheets = [item for group in results for item in group["sheets"]]
    assert len(sheets) == 1
    editions = {row["edition"]: row for row in sheets[0]["editions"]}
    assert set(editions) == {UNIVERSITY, LOCKIN}
    assert editions[UNIVERSITY]["pageCount"] == 22
    assert editions[LOCKIN]["pageCount"] == 18
    assert editions[LOCKIN]["slug"] == f"{editions[UNIVERSITY]['slug']}-lockin"
    for row in editions.values():
        assert row["hasActiveStudy"] is True
        assert row["deliverable"] is True
        # Each edition opens in the ordinary reader through its own address.
        resolved = student_client.get(
            f"/api/v1/catalog/documents/{group_slug(results)}/{row['slug']}"
        )
        assert resolved.status_code == 200, (row["edition"], resolved.json())


def group_slug(results: list[dict[str, Any]]) -> str:
    return str(results[0]["slug"])


def test_removing_the_lockin_edition_keeps_the_sheet_and_its_questions() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject, pages=22)
    client = APIClient()
    client.force_authenticate(admin)
    base = f"/api/v1/operations/admin/content/sheets/{sheet.id}"

    lockin_file = create_managed_file(owner=admin, upload=_pdf(18, "lockin.pdf"), kind="pdf")
    revision = client.get(base).json()["revision"]
    uploaded = client.post(
        f"{base}/lockin-pdf",
        {"expected_revision": revision, "lockin_file_id": str(lockin_file.id)},
        format="json",
    )
    assert uploaded.status_code == 200
    imported = client.put(
        f"{base}/active-study/questions/easy",
        {"expected_revision": 0, "payload": _questions(parts=3)},
        format="json",
    )
    assert imported.status_code in {200, 201}, imported.json()

    removed = client.delete(
        f"{base}/lockin-pdf",
        {"expected_revision": uploaded.json()["revision"]},
        format="json",
    )
    assert removed.status_code == 200
    editions = {row["edition"]: row for row in removed.json()["editions"]}
    assert editions[LOCKIN]["available"] is False
    assert editions[UNIVERSITY]["available"] is True
    # The question bank belongs to the sheet, so it survives untouched.
    questions = client.get(f"{base}/active-study/questions/easy").json()
    assert questions["content"]["revision"] == 1
    assert questions["number_of_parts"] == 3


def test_each_edition_document_points_at_its_own_file_through_replacements() -> None:
    """The Catalog address of an edition must never serve another edition's PDF."""

    admin = create_admin()
    student = create_user()
    institution, subject, _ = published_path(admin=admin)
    program = AcademicProgram.objects.create(code="bind", name_en="B", name_ar="B")
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Y1", name_ar="Y1"
    )
    cohort.content_nodes.set([institution])
    student.cohort = cohort
    student.save(update_fields=["cohort"])
    sheet = _sheet(admin=admin, subject=subject, pages=22)
    client = APIClient()
    client.force_authenticate(admin)
    base = f"/api/v1/operations/admin/content/sheets/{sheet.id}"
    student_client = APIClient()
    student_client.force_authenticate(student)

    def addresses() -> dict[str, str]:
        results = student_client.get("/api/v1/catalog/materials").json()["results"]
        group = results[0]
        rows = {}
        for row in group["sheets"][0]["editions"]:
            resolved = student_client.get(
                f"/api/v1/catalog/documents/{group['slug']}/{row['slug']}"
            )
            rows[row["edition"]] = (
                resolved.json()["document"]["file_id"] if resolved.status_code == 200 else ""
            )
        return rows

    university_file = _primary_file(sheet).id
    lockin_file = create_managed_file(owner=admin, upload=_pdf(18, "lockin.pdf"), kind="pdf")
    revision = client.get(base).json()["revision"]
    uploaded = client.post(
        f"{base}/lockin-pdf",
        {"expected_revision": revision, "lockin_file_id": str(lockin_file.id)},
        format="json",
    )
    assert uploaded.status_code == 200
    resolved = addresses()
    assert resolved[UNIVERSITY] == str(university_file)
    assert resolved[LOCKIN] == str(lockin_file.id)

    # Replacing one edition's PDF moves only that edition's address.
    replacement = create_managed_file(owner=admin, upload=_pdf(12, "lockin-v2.pdf"), kind="pdf")
    replaced = client.post(
        f"{base}/lockin-pdf",
        {"expected_revision": uploaded.json()["revision"], "lockin_file_id": str(replacement.id)},
        format="json",
    )
    assert replaced.status_code == 200
    resolved = addresses()
    assert resolved[UNIVERSITY] == str(university_file)
    assert resolved[LOCKIN] == str(replacement.id)

    # With the Lock-in edition removed, its address resolves to nothing at all
    # rather than falling back to the edition that still exists.
    removed = client.delete(
        f"{base}/lockin-pdf",
        {"expected_revision": replaced.json()["revision"]},
        format="json",
    )
    assert removed.status_code == 200
    group = student_client.get("/api/v1/catalog/materials").json()["results"][0]
    assert [row["edition"] for row in group["sheets"][0]["editions"]] == [UNIVERSITY]
    orphan = student_client.get(
        f"/api/v1/catalog/documents/{group['slug']}/{group['sheets'][0]['slug']}-lockin"
    )
    assert orphan.status_code == 404
    assert student_client.get(
        f"/api/v1/catalog/documents/{group['slug']}/{group['sheets'][0]['slug']}"
    ).json()["document"]["file_id"] == str(university_file)
