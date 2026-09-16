"""Admin to student Active Study across a sheet's two editions.

Covers the orderings administrators actually use: questions saved before or
after a Sheet Summary or a Lock-in PDF, and editions whose raw page counts
differ while their study ranges match.
"""

from __future__ import annotations

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.models import AcademicProgram, StudentCohort
from apps.education.tests.helpers import create_admin, published_path
from apps.files.services import create_managed_file
from apps.focus.tests.test_managed_active_study import _grant_focus

from ..editions import LOCKIN, UNIVERSITY
from .test_sheet_editions import _pdf, _questions, _sheet

pytestmark = pytest.mark.django_db


def _world() -> tuple[Any, Any, APIClient, APIClient, str]:
    admin = create_admin()
    student = create_user()
    institution, subject, _ = published_path(admin=admin)
    program = AcademicProgram.objects.create(code="flow", name_en="F", name_ar="F")
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Y1", name_ar="Y1"
    )
    cohort.content_nodes.set([institution])
    student.cohort = cohort
    student.save(update_fields=["cohort"])
    _grant_focus(student)
    sheet = _sheet(admin=admin, subject=subject, pages=22)
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    student_client = APIClient()
    student_client.force_authenticate(student)
    return (
        admin,
        sheet,
        admin_client,
        student_client,
        (f"/api/v1/operations/admin/content/sheets/{sheet.id}"),
    )


def _medium(client: APIClient, base: str, edition: str) -> dict[str, Any]:
    payload = client.get(f"{base}/active-study?edition={edition}").json()
    return next(item for item in payload["difficulties"] if item["difficulty"] == "medium")


def _upload_lockin(admin: Any, client: APIClient, base: str, pages: int) -> None:
    lockin = create_managed_file(owner=admin, upload=_pdf(pages, "lockin.pdf"), kind="pdf")
    revision = client.get(base).json()["revision"]
    uploaded = client.post(
        f"{base}/lockin-pdf",
        {"expected_revision": revision, "lockin_file_id": str(lockin.id)},
        format="json",
    )
    assert uploaded.status_code == 200, uploaded.json()


def _student_editions(client: APIClient) -> dict[str, dict[str, Any]]:
    results = client.get("/api/v1/catalog/materials").json()["results"]
    sheet = next(item for group in results for item in group["sheets"])
    return {row["edition"]: row for row in sheet["editions"]}


def test_saved_questions_stay_ready_after_summary_and_lockin_uploads() -> None:
    admin, sheet, client, student, base = _world()
    current = client.get(f"{base}/active-study").json()
    assert (
        client.patch(
            f"{base}/active-study",
            {"expected_revision": current["revision"], "enabled": True},
            format="json",
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"{base}/active-study/questions/medium",
            {"expected_revision": 0, "payload": _questions(parts=4)},
            format="json",
        ).status_code
        == 200
    )
    assert _medium(client, base, UNIVERSITY)["readiness"]["ready"] is True

    # Each of these creates a new sheet version without touching the
    # University PDF the questions and page settings describe.
    summary = create_managed_file(owner=admin, upload=_pdf(3, "summary.pdf"), kind="pdf")
    revision = client.get(base).json()["revision"]
    assert (
        client.post(
            f"{base}/summary-pdf",
            {"expected_revision": revision, "summary_file_id": str(summary.id)},
            format="json",
        ).status_code
        == 200
    )
    _upload_lockin(admin, client, base, pages=22)

    assert _medium(client, base, UNIVERSITY)["readiness"]["ready"] is True
    assert (
        student.get(f"/api/v1/focus/managed-active-study/sheets/{sheet.id}").json()["difficulties"][
            1
        ]["status"]
        == "ready"
    )
    assert _student_editions(student)[UNIVERSITY]["hasActiveStudy"] is True


def test_lockin_shares_the_university_questions_with_different_raw_page_counts() -> None:
    admin, sheet, client, student, base = _world()
    _upload_lockin(admin, client, base, pages=20)

    # University: 22 pages, first and last excluded -> 20 study pages.
    current = client.get(f"{base}/active-study").json()
    saved = client.patch(
        f"{base}/active-study",
        {
            "expected_revision": current["revision"],
            "enabled": True,
            "excluded_start_pages": 1,
            "excluded_end_pages": 1,
        },
        format="json",
    )
    assert saved.status_code == 200, saved.json()
    assert saved.json()["eligible_study_pages"] == 20
    parts = _medium(client, base, UNIVERSITY)["number_of_parts"]
    assert (
        client.put(
            f"{base}/active-study/questions/medium",
            {"expected_revision": 0, "payload": _questions(parts=parts)},
            format="json",
        ).status_code
        == 200
    )

    # Lock-in never configured on its own: it follows the University Sheet.
    lockin = client.get(f"{base}/active-study?edition=lockin").json()
    assert lockin["enabled"] is True
    assert lockin["settings_inherited"] is True
    assert lockin["eligible_study_pages"] == 20
    assert lockin["study_pages_match_university"] is True
    university_medium = _medium(client, base, UNIVERSITY)
    lockin_medium = _medium(client, base, LOCKIN)
    assert lockin_medium["readiness"]["ready"] is True, lockin_medium["readiness"]
    # Same part sizes, each edition on its own pages.
    assert [(row["end_page"] - row["start_page"]) for row in lockin_medium["page_ranges"]] == [
        (row["end_page"] - row["start_page"]) for row in university_medium["page_ranges"]
    ]
    assert university_medium["page_ranges"][0]["start_page"] == 2
    assert university_medium["page_ranges"][-1]["end_page"] == 21
    assert lockin_medium["page_ranges"][0]["start_page"] == 1
    assert lockin_medium["page_ranges"][-1]["end_page"] == 20

    # Saving Lock-in settings explicitly is accepted without a boundary
    # confirmation, because it cannot invalidate the shared question bank.
    saved = client.patch(
        f"{base}/active-study?edition=lockin",
        {"expected_revision": 0, "enabled": True, "excluded_start_pages": 0},
        format="json",
    )
    assert saved.status_code == 200, saved.json()
    assert _medium(client, base, LOCKIN)["readiness"]["ready"] is True

    editions = _student_editions(student)
    assert editions[UNIVERSITY]["hasActiveStudy"] is True
    assert editions[LOCKIN]["hasActiveStudy"] is True

    questions: dict[str, list[str]] = {}
    for edition in (UNIVERSITY, LOCKIN):
        started = student.post(
            "/api/v1/focus/managed-active-study/start",
            {"sheet_id": str(sheet.id), "difficulty": "medium", "edition": edition},
            format="json",
        )
        assert started.status_code == 201, (edition, started.json())
        run = started.json()["run"]
        assert run["number_of_parts"] == parts
        expected_start = 2 if edition == UNIVERSITY else 1
        assert run["current_page_range"]["start_page"] == expected_start
        student.post(
            f"/api/v1/focus/managed-active-study/{run['id']}/complete-reading", {}, format="json"
        )
        quiz = student.get(f"/api/v1/focus/managed-active-study/{run['id']}/questions").json()
        questions[edition] = [item["question"] for item in quiz["questions"]]
    assert questions[UNIVERSITY] == questions[LOCKIN]


def test_replacing_the_lockin_pdf_leaves_the_university_edition_ready() -> None:
    admin, _, client, _, base = _world()
    _upload_lockin(admin, client, base, pages=22)
    current = client.get(f"{base}/active-study").json()
    assert (
        client.patch(
            f"{base}/active-study",
            {"expected_revision": current["revision"], "enabled": True},
            format="json",
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"{base}/active-study/questions/medium",
            {"expected_revision": 0, "payload": _questions(parts=4)},
            format="json",
        ).status_code
        == 200
    )
    _upload_lockin(admin, client, base, pages=18)

    assert _medium(client, base, UNIVERSITY)["readiness"]["ready"] is True
    lockin_medium = _medium(client, base, LOCKIN)
    assert lockin_medium["readiness"]["ready"] is True
    assert lockin_medium["page_ranges"][-1]["end_page"] == 18


def test_a_wrong_lockin_page_count_explains_that_editions_may_differ() -> None:
    admin, _, client, _, base = _world()
    _upload_lockin(admin, client, base, pages=20)
    rejected = client.patch(
        f"{base}/active-study?edition=lockin",
        {"expected_revision": 0, "enabled": True, "total_pdf_pages": 22},
        format="json",
    )
    assert rejected.status_code == 400
    message = rejected.json()["error"]["fields"]["total_pdf_pages"][0]
    assert "20" in message and "Lockin Sheet" in message


def _tagged_questions(*, parts: int, tag: str) -> dict[str, Any]:
    payload = _questions(parts=parts)
    for part in payload["parts"]:
        for question in part["questions"]:
            question["question"] = f"{tag} {question['question']}"
    for question in payload["final_exam"]["questions"]:
        question["question"] = f"{tag} {question['question']}"
    return payload


def test_university_questions_are_the_lockin_questions_without_a_second_copy() -> None:
    """University questions saved -> Lockin opened by a student -> same set, Ready."""

    from apps.focus.managed_active_study import _questions_for
    from apps.focus.models import ActiveStudyRun

    from ..models import ActiveStudyQuestionContent, CatalogDocument

    admin, sheet, client, student, base = _world()
    _upload_lockin(admin, client, base, pages=20)
    current = client.get(f"{base}/active-study").json()
    assert (
        client.patch(
            f"{base}/active-study",
            {
                "expected_revision": current["revision"],
                "enabled": True,
                "excluded_start_pages": 1,
                "excluded_end_pages": 1,
            },
            format="json",
        ).status_code
        == 200
    )
    parts = _medium(client, base, UNIVERSITY)["number_of_parts"]
    first = _tagged_questions(parts=parts, tag="v1")
    assert (
        client.put(
            f"{base}/active-study/questions/medium",
            {"expected_revision": 0, "payload": first},
            format="json",
        ).status_code
        == 200
    )
    # Nothing was imported for Lock-in, and there is nowhere to import it to.
    assert ActiveStudyQuestionContent.objects.filter(sheet=sheet).count() == 1

    # The student opens the Lock-in edition: Ready, not "Not Ready".
    assert _student_editions(student)[LOCKIN]["hasActiveStudy"] is True
    availability = student.get(
        f"/api/v1/focus/managed-active-study/sheets/{sheet.id}?edition=lockin"
    ).json()
    medium = next(row for row in availability["difficulties"] if row["difficulty"] == "medium")
    assert medium["status"] == "ready"

    def open_edition(edition: str) -> ActiveStudyRun:
        started = student.post(
            "/api/v1/focus/managed-active-study/start",
            {"sheet_id": str(sheet.id), "difficulty": "medium", "edition": edition},
            format="json",
        )
        assert started.status_code in {200, 201}, (edition, started.json())
        return ActiveStudyRun.objects.get(id=started.json()["run"]["id"])

    def question_set(run: ActiveStudyRun) -> dict[str, list[str]]:
        run.refresh_from_db()
        return {
            **{
                f"part-{part}": [
                    item["question"] for item in _questions_for(run, kind="checkpoint", part=part)
                ]
                for part in range(1, parts + 1)
            },
            "final": [item["question"] for item in _questions_for(run, kind="final", part=None)],
        }

    university_run = open_edition(UNIVERSITY)
    lockin_run = open_edition(LOCKIN)
    expected = {
        **{
            f"part-{part['part']}": [item["question"] for item in part["questions"]]
            for part in first["parts"]
        },
        "final": [item["question"] for item in first["final_exam"]["questions"]],
    }
    assert question_set(university_run) == expected
    assert question_set(lockin_run) == expected

    # Only the PDF side is per edition: separate runs, page ranges and documents.
    assert university_run.id != lockin_run.id
    assert university_run.plan_signature["page_ranges"][0]["start_page"] == 2
    assert lockin_run.plan_signature["page_ranges"][0]["start_page"] == 1
    documents = CatalogDocument.objects.filter(version__learning_object_id=sheet.id, is_active=True)
    assert {doc.edition for doc in documents} == {UNIVERSITY, LOCKIN}
    assert len({doc.managed_file_id for doc in documents}) == 2

    # Updating the questions from the University edition updates Lock-in too.
    updated = _tagged_questions(parts=parts, tag="v2")
    assert (
        client.put(
            f"{base}/active-study/questions/medium",
            {"expected_revision": 1, "payload": updated},
            format="json",
        ).status_code
        == 200
    )
    assert ActiveStudyQuestionContent.objects.filter(sheet=sheet).count() == 1
    assert _medium(client, base, LOCKIN)["readiness"]["ready"] is True
    lockin_questions = question_set(lockin_run)
    assert lockin_questions["part-1"][0].startswith("v2 ")
    assert lockin_questions["final"][0].startswith("v2 ")
    assert lockin_questions == question_set(university_run)
