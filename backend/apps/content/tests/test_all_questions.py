"""All Questions: one JSON document distributed into every existing question bank."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditRecord
from apps.education.tests.helpers import create_admin, published_path
from apps.files.services import create_managed_file
from apps.questions.models import Question, QuestionImportBatch
from apps.questions.services import (
    QuestionInput,
    QuestionOptionInput,
    QuestionRuleError,
    create_question,
)

from ..models import ActiveStudyQuestionContent, ActiveStudySettings
from .test_sheet_editions import _pdf, _sheet

pytestmark = pytest.mark.django_db


def _world(pages: int = 22) -> tuple[Any, Any, APIClient, str]:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject, pages=pages)
    client = APIClient()
    client.force_authenticate(admin)
    base = f"/api/v1/operations/admin/content/sheets/{sheet.id}"
    saved = client.patch(
        f"{base}/active-study",
        {
            "expected_revision": 0,
            "enabled": True,
            "excluded_start_pages": 1,
            "excluded_end_pages": 1,
        },
        format="json",
    )
    assert saved.status_code == 200, saved.json()
    return admin, sheet, client, base


def _question(tag: str) -> dict[str, Any]:
    return {
        "question": f"Question {tag}?",
        "options": {"A": f"A {tag}", "B": f"B {tag}", "C": f"C {tag}", "D": f"D {tag}"},
        "correct_answer": "C",
        "explanation": f"Because {tag}.",
    }


def _document(context: dict[str, Any], *, normal: int = 30, tag: str = "v1") -> dict[str, Any]:
    """The JSON an AI would return for this context, pages included."""

    active: dict[str, Any] = {}
    for row in context["difficulties"]:
        key = row["difficulty"]
        active[key] = {
            "parts": [
                {
                    "part": part["part"],
                    "pages": f"{part['start_page']}-{part['end_page']}",
                    "questions": [
                        _question(f"{tag}-{key}-P{part['part']}-{index}")
                        for index in range(row["questions_per_checkpoint"])
                    ],
                }
                for part in row["page_ranges"]
            ],
            "final_exam": {
                "questions": [
                    _question(f"{tag}-{key}-F-{index}")
                    for index in range(row["final_exam_questions"])
                ]
            },
        }
    return {
        "active_study": active,
        "sheet_questions": {"questions": [_question(f"{tag}-N-{i}") for i in range(normal)]},
    }


def _context(client: APIClient, base: str, query: str = "") -> dict[str, Any]:
    response = client.get(f"{base}/all-questions{query}")
    assert response.status_code == 200, response.json()
    return response.json()


def _validate(client: APIClient, base: str, document: Any, *, normal: int = 30, **extra: Any):
    return client.post(
        f"{base}/all-questions/validate{extra.pop('query', '')}",
        {"payload": document, "sheet_question_count": normal, **extra},
        format="json",
    )


def _save(
    client: APIClient,
    base: str,
    document: Any,
    context: dict[str, Any],
    *,
    normal: int = 30,
    query: str = "",
    **extra: Any,
):
    body = {
        "payload": document,
        "sheet_question_count": normal,
        "settings_revision": context["settings_revision"],
        "expected_revisions": {
            row["difficulty"]: row["existing"]["revision"] for row in context["difficulties"]
        },
        **extra,
    }
    return client.put(f"{base}/all-questions{query}", body, format="json")


def _errors(response: Any) -> list[dict[str, str]]:
    assert response.status_code == 400, response.json()
    return response.json()["errors"]


def test_context_reads_each_difficultys_configured_parts_and_own_final_exam() -> None:
    _, _, client, base = _world()
    context = _context(client, base)
    assert context["edition"] == "university"
    # 22 pages, first and last excluded -> pages 2-21.
    assert (context["effective_start_page"], context["effective_end_page"]) == (2, 21)
    rows = {row["difficulty"]: row for row in context["difficulties"]}
    medium_plan = client.get(f"{base}/active-study").json()["difficulties"]
    for row in medium_plan:
        assert rows[row["difficulty"]]["number_of_parts"] == row["number_of_parts"]
        assert rows[row["difficulty"]]["page_ranges"] == row["page_ranges"]
    assert [rows[key]["number_of_parts"] for key in ("easy", "medium", "hard")] == [3, 4, 5]
    assert all(row["final_exam_questions"] == 50 for row in rows.values())
    assert all(row["questions_per_checkpoint"] == 15 for row in rows.values())
    assert [rows[key]["total"] for key in ("easy", "medium", "hard")] == [95, 110, 125]
    assert context["active_study_total"] == 330
    assert context["sheet_questions"]["existing_count"] == 0


def test_valid_combined_document_is_saved_into_every_existing_bank() -> None:
    _, sheet, client, base = _world()
    context = _context(client, base)
    document = _document(context, normal=30)

    validated = _validate(client, base, document, normal=30)
    assert validated.status_code == 200, validated.json()
    summary = validated.json()["summary"]
    assert summary["total_expected"] == summary["total_received"] == 360
    assert all(row["ok"] for row in summary["difficulties"])
    assert all(part["ok"] for row in summary["difficulties"] for part in row["parts"])
    assert summary["sheet_questions"] == {"expected": 30, "received": 30, "ok": True}
    # Validation writes nothing.
    assert not ActiveStudyQuestionContent.objects.filter(sheet=sheet).exists()

    saved = _save(client, base, document, context, normal=30)
    assert saved.status_code == 200, saved.json()
    contents = {c.difficulty: c for c in ActiveStudyQuestionContent.objects.filter(sheet=sheet)}
    assert set(contents) == {"easy", "medium", "hard"}
    assert contents["easy"].checkpoint_question_count == 45
    assert contents["hard"].checkpoint_question_count == 75
    assert all(content.final_exam_question_count == 50 for content in contents.values())
    # Each difficulty keeps its own Final Exam; pages are not stored in the bank.
    assert contents["medium"].payload["final_exam"]["questions"][0]["question"] == (
        "Question v1-medium-F-0?"
    )
    assert "pages" not in contents["easy"].payload["parts"][0]

    batch = QuestionImportBatch.objects.get(sheet=sheet)
    assert str(batch.id) == saved.json()["sheet_question_batch_id"]
    questions = Question.objects.filter(import_batch=batch)
    assert questions.count() == 30
    assert all(q.workflow_status == Question.WorkflowStatus.PUBLISHED for q in questions)
    first = questions.get(current_version__prompt="Question v1-N-0?").current_version
    assert [o.text for o in first.options.all() if o.is_correct] == ["C v1-N-0"]

    # Every difficulty is Ready for students through the existing readiness.
    for row in client.get(f"{base}/active-study").json()["difficulties"]:
        assert row["readiness"]["ready"] is True, row["readiness"]
    assert AuditRecord.objects.filter(action="content.all_questions_saved").exists()


def test_part_and_final_exam_counts_are_reported_with_their_location() -> None:
    _, _, client, base = _world()
    context = _context(client, base)
    document = _document(context)
    document["active_study"]["easy"]["parts"][1]["questions"].pop()
    document["active_study"]["medium"]["final_exam"]["questions"].pop()
    document["active_study"]["hard"]["parts"][2]["questions"][7]["correct_answer"] = "E"

    response = _validate(client, base, document)
    errors = _errors(response)
    by_path = {item["path"]: item for item in errors}
    easy = by_path["active_study.easy.parts[1].questions"]
    assert easy["section"] == "Easy → Part 2"
    assert "contains 14 questions. Expected 15" in easy["message"]
    medium = by_path["active_study.medium.final_exam.questions"]
    assert medium["section"] == "Medium → Final Exam"
    assert "contains 49 questions. Expected 50" in medium["message"]
    hard = by_path["active_study.hard.parts[2].questions[7].correct_answer"]
    assert hard["section"] == "Hard → Part 3 → Question 8"
    assert "Invalid correct_answer: 'E'" in hard["message"]

    summary = response.json()["summary"]
    rows = {row["difficulty"]: row for row in summary["difficulties"]}
    easy_part = rows["easy"]["parts"][1]
    assert (easy_part["part"], easy_part["expected"], easy_part["received"]) == (2, 15, 14)
    assert easy_part["ok"] is False
    assert rows["easy"]["parts"][0]["ok"] is True
    assert rows["medium"]["final_exam"] == {"expected": 50, "received": 49, "ok": False}
    assert rows["hard"]["parts"][2]["ok"] is False
    assert rows["hard"]["final_exam"]["ok"] is True


def test_each_difficulty_needs_its_own_final_exam_and_correct_part_count() -> None:
    _, _, client, base = _world()
    context = _context(client, base)
    document = _document(context)
    del document["active_study"]["easy"]["final_exam"]
    document["active_study"]["final_exam"] = {"questions": []}
    document["active_study"]["hard"]["parts"].pop()

    by_path = {item["path"]: item for item in _errors(_validate(client, base, document))}
    assert by_path["active_study.easy.final_exam"]["message"] == "Easy Final Exam is missing."
    assert "Each difficulty has its own" in by_path["active_study.final_exam"]["message"]
    hard_messages = [
        item["message"]
        for item in _errors(_validate(client, base, document))
        if item["path"] == "active_study.hard.parts"
    ]
    assert "Expected 5 parts for Hard, but received 4." in hard_messages


def test_missing_difficulty_and_wrong_final_exam_count() -> None:
    _, _, client, base = _world()
    context = _context(client, base)
    document = _document(context)
    del document["active_study"]["medium"]
    document["active_study"]["hard"]["final_exam"]["questions"].append(_question("extra"))

    by_path = {item["path"]: item for item in _errors(_validate(client, base, document))}
    assert by_path["active_study.medium"]["message"] == "Medium is missing."
    assert (
        "contains 51 questions. Expected 50"
        in (by_path["active_study.hard.final_exam.questions"]["message"])
    )


def test_malformed_questions_and_wrong_page_ranges_are_rejected() -> None:
    _, _, client, base = _world()
    context = _context(client, base)
    document = _document(context)
    broken = document["active_study"]["easy"]["parts"][0]["questions"][0]
    broken["question"] = "  "
    del broken["options"]["D"]
    document["active_study"]["medium"]["parts"][0]["questions"][1]["options"]["B"] = ""
    document["active_study"]["hard"]["parts"][0]["pages"] = "1-99"
    document["sheet_questions"]["questions"][3]["explanation"] = ""

    paths = {item["path"] for item in _errors(_validate(client, base, document))}
    assert "active_study.easy.parts[0].questions[0].question" in paths
    assert "active_study.easy.parts[0].questions[0].options.D" in paths
    assert "active_study.medium.parts[0].questions[1].options.B" in paths
    assert "active_study.hard.parts[0].pages" in paths
    assert "sheet_questions.questions[3].explanation" in paths


def test_normal_questions_follow_the_selected_custom_count() -> None:
    _, sheet, client, base = _world()
    context = _context(client, base)

    assert _validate(client, base, _document(context, normal=10), normal=10).status_code == 200
    short = _errors(_validate(client, base, _document(context, normal=9), normal=10))
    assert {
        "path": "sheet_questions.questions",
        "section": "Normal Questions",
        "message": "Expected 10 questions. Received 9.",
    } in short

    # Zero means no Normal Questions: nothing is imported.
    document = _document(context, normal=0)
    saved = _save(client, base, document, context, normal=0)
    assert saved.status_code == 200, saved.json()
    assert saved.json()["sheet_question_batch_id"] is None
    assert not QuestionImportBatch.objects.filter(sheet=sheet).exists()


def test_a_failure_after_earlier_banks_were_written_saves_nothing(monkeypatch) -> None:
    _, sheet, client, base = _world()
    context = _context(client, base)

    def fail(**_: Any) -> None:
        raise QuestionRuleError("The selected sheet has no current version.")

    # Every Active Study bank is written before the Normal Questions import.
    monkeypatch.setattr("apps.content.all_questions.import_questions", fail)
    response = _save(client, base, _document(context), context)
    assert response.status_code == 400
    assert not ActiveStudyQuestionContent.objects.filter(sheet=sheet).exists()
    assert not AuditRecord.objects.filter(action="content.active_study_questions_imported").exists()


def test_a_stale_revision_on_the_last_bank_rolls_back_the_whole_save() -> None:
    _, sheet, client, base = _world()
    context = _context(client, base)
    hard = next(row for row in context["difficulties"] if row["difficulty"] == "hard")
    single = _document(context)["active_study"]["hard"]
    for part in single["parts"]:
        part.pop("pages")
    assert (
        client.put(
            f"{base}/active-study/questions/hard",
            {"expected_revision": 0, "payload": single},
            format="json",
        ).status_code
        == 200
    )
    assert hard["existing"]["revision"] == 0  # the context is now stale for Hard

    response = _save(client, base, _document(context, tag="v2"), context)
    assert response.status_code == 409
    assert set(
        ActiveStudyQuestionContent.objects.filter(sheet=sheet).values_list("difficulty", flat=True)
    ) == {"hard"}
    assert not QuestionImportBatch.objects.filter(sheet=sheet).exists()


def test_invalid_document_never_writes() -> None:
    _, sheet, client, base = _world()
    context = _context(client, base)
    document = _document(context)
    document["active_study"]["hard"]["final_exam"]["questions"].pop()
    response = _save(client, base, document, context)
    assert response.status_code == 400
    assert response.json()["errors"][0]["section"] == "Hard → Final Exam"
    assert not ActiveStudyQuestionContent.objects.filter(sheet=sheet).exists()
    assert not QuestionImportBatch.objects.filter(sheet=sheet).exists()


def test_saving_again_replaces_active_study_sets_and_reports_them_first() -> None:
    _, sheet, client, base = _world()
    first = _context(client, base)
    assert _save(client, base, _document(first, tag="v1"), first).status_code == 200

    second = _context(client, base)
    existing = {row["difficulty"]: row["existing"] for row in second["difficulties"]}
    assert existing["easy"] == {
        "revision": 1,
        "checkpoint_question_count": 45,
        "final_exam_question_count": 50,
    }
    assert second["sheet_questions"]["existing_count"] == 30
    assert second["sheet_questions"]["all_questions_count"] == 30

    saved = _save(client, base, _document(second, tag="v2", normal=10), second, normal=10)
    assert saved.status_code == 200, saved.json()
    contents = {c.difficulty: c for c in ActiveStudyQuestionContent.objects.filter(sheet=sheet)}
    assert ActiveStudyQuestionContent.objects.filter(sheet=sheet).count() == 3
    assert all(content.revision == 2 for content in contents.values())
    assert (
        contents["easy"].payload["parts"][0]["questions"][0]["question"].startswith("Question v2")
    )
    # The earlier All Questions Normal Questions are archived, not stacked.
    assert saved.json()["replaced_sheet_question_count"] == 30
    live = Question.objects.filter(current_version__source_learning_object=sheet).exclude(
        workflow_status=Question.WorkflowStatus.RETIRED
    )
    assert live.count() == 10
    assert _context(client, base)["sheet_questions"]["all_questions_count"] == 10


def test_rerunning_all_questions_never_doubles_the_normal_questions() -> None:
    _, sheet, client, base = _world()
    for run, count in enumerate((30, 40, 40), start=1):
        context = _context(client, base)
        saved = _save(
            client, base, _document(context, tag=f"run{run}", normal=count), context, normal=count
        )
        assert saved.status_code == 200, saved.json()
    live = Question.objects.filter(current_version__source_learning_object=sheet).exclude(
        workflow_status=Question.WorkflowStatus.RETIRED
    )
    assert live.count() == 40
    assert {q.current_version.prompt for q in live} == {
        f"Question run3-N-{index}?" for index in range(40)
    }
    # Archived, not deleted: earlier versions stay for attempts and history.
    assert Question.objects.filter(current_version__source_learning_object=sheet).count() == 110
    assert QuestionImportBatch.objects.filter(sheet=sheet).count() == 3

    # A run without Normal Questions leaves the last ones in place.
    context = _context(client, base)
    saved = _save(client, base, _document(context, tag="run4", normal=0), context, normal=0)
    assert saved.status_code == 200, saved.json()
    assert saved.json()["replaced_sheet_question_count"] == 0
    assert live.count() == 40


def test_questions_added_outside_all_questions_are_never_replaced() -> None:
    admin, sheet, client, base = _world()
    # An ordinary Question import, exactly as the Questions area sends it.
    manual = client.post(
        f"{base}/questions/import",
        {
            "payload": {
                "version": "lockin_questions_v1",
                "questions": [
                    {
                        "type": "mcq",
                        "question": f"Manual import {index}?",
                        "choices": ["One", "Two", "Three", "Four"],
                        "correct_answer": "Two",
                        "explanation": "Manual.",
                    }
                    for index in range(5)
                ],
            },
            "publish": True,
        },
        format="json",
    )
    assert manual.status_code == 201, manual.json()
    # A hand-written custom exam question.
    version = sheet.current_version
    custom = create_question(
        actor=admin,
        data=QuestionInput(
            academic_node=version.academic_node,
            source_learning_object=sheet,
            question_type="single_choice",
            prompt="Custom exam question?",
            metadata={"source": "exam"},
            options=(
                QuestionOptionInput(text="Yes", is_correct=True),
                QuestionOptionInput(text="No", is_correct=False),
            ),
        ),
    )

    first = _context(client, base)
    assert first["sheet_questions"]["existing_count"] == 5
    assert first["sheet_questions"]["all_questions_count"] == 0
    assert _save(client, base, _document(first, tag="a"), first).status_code == 200
    second = _context(client, base)
    assert second["sheet_questions"]["all_questions_count"] == 30
    saved = _save(client, base, _document(second, tag="b", normal=20), second, normal=20)
    assert saved.status_code == 200, saved.json()
    assert saved.json()["replaced_sheet_question_count"] == 30

    retired = Question.WorkflowStatus.RETIRED
    manual_questions = Question.objects.filter(current_version__prompt__startswith="Manual import")
    assert manual_questions.count() == 5
    assert not manual_questions.filter(workflow_status=retired).exists()
    custom.refresh_from_db()
    assert custom.workflow_status != retired
    live_generated = Question.objects.filter(
        current_version__metadata__import_origin="all_questions"
    ).exclude(workflow_status=retired)
    assert live_generated.count() == 20


def test_exclusions_chosen_in_all_questions_become_that_editions_boundaries() -> None:
    _, sheet, client, base = _world()
    context = _context(client, base, "?excluded_start_pages=2&excluded_end_pages=2")
    assert context["exclusions_changed"] is True
    assert (context["effective_start_page"], context["effective_end_page"]) == (3, 20)
    easy = next(row for row in context["difficulties"] if row["difficulty"] == "easy")
    assert easy["page_ranges"][0]["start_page"] == 3

    # A document built for the saved boundaries does not fit the chosen ones.
    stale = _document(_context(client, base))
    assert (
        _validate(client, base, stale, excluded_start_pages=2, excluded_end_pages=2).status_code
        == 400
    )

    document = _document(context)
    saved = _save(client, base, document, context, excluded_start_pages=2, excluded_end_pages=2)
    assert saved.status_code == 200, saved.json()
    assert saved.json()["boundaries_updated"] is True
    settings = ActiveStudySettings.objects.get(sheet=sheet, edition="university")
    assert (settings.excluded_start_pages, settings.excluded_end_pages) == (2, 2)
    assert settings.enabled is True
    for row in client.get(f"{base}/active-study").json()["difficulties"]:
        assert row["readiness"]["ready"] is True, row["readiness"]


def _upload_lockin(admin: Any, client: APIClient, base: str, pages: int) -> None:
    lockin = create_managed_file(owner=admin, upload=_pdf(pages, "lockin.pdf"), kind="pdf")
    revision = client.get(base).json()["revision"]
    uploaded = client.post(
        f"{base}/lockin-pdf",
        {"expected_revision": revision, "lockin_file_id": str(lockin.id)},
        format="json",
    )
    assert uploaded.status_code == 200, uploaded.json()


def test_lockin_edition_plans_its_own_pages_without_touching_the_university_config() -> None:
    admin, sheet, client, base = _world()
    _upload_lockin(admin, client, base, pages=20)
    university = _context(client, base)
    lockin = _context(client, base, "?edition=lockin")

    assert lockin["edition_label"] == "Lockin Sheet"
    assert lockin["shared_question_bank"] is True
    assert (lockin["effective_start_page"], lockin["effective_end_page"]) == (1, 20)
    for uni_row, lockin_row in zip(university["difficulties"], lockin["difficulties"], strict=True):
        # One bank: same part count, each edition on its own pages.
        assert uni_row["number_of_parts"] == lockin_row["number_of_parts"]
        assert lockin_row["page_ranges"][0]["start_page"] == 1
        assert uni_row["page_ranges"][0]["start_page"] == 2

    # University page ranges do not validate as the Lock-in edition.
    assert (
        _validate(client, base, _document(university), query="?edition=lockin").status_code == 400
    )

    context = _context(client, base, "?edition=lockin&excluded_start_pages=1&excluded_end_pages=0")
    saved = _save(
        client,
        base,
        _document(context),
        context,
        query="?edition=lockin",
        excluded_start_pages=1,
        excluded_end_pages=0,
    )
    assert saved.status_code == 200, saved.json()
    lockin_settings = ActiveStudySettings.objects.get(sheet=sheet, edition="lockin")
    assert (lockin_settings.excluded_start_pages, lockin_settings.excluded_end_pages) == (1, 0)
    # Lock-in inherited "enabled" from the University Sheet and keeps it.
    assert lockin_settings.enabled is True
    uni_settings = ActiveStudySettings.objects.get(sheet=sheet, edition="university")
    assert (uni_settings.excluded_start_pages, uni_settings.excluded_end_pages) == (1, 1)
    assert [row["page_ranges"] for row in _context(client, base)["difficulties"]] == [
        row["page_ranges"] for row in university["difficulties"]
    ]
    # Both editions read the one bank that was just saved.
    for edition in ("university", "lockin"):
        rows = client.get(f"{base}/active-study?edition={edition}").json()["difficulties"]
        assert all(row["readiness"]["ready"] for row in rows), (edition, rows)


def test_university_save_does_not_change_lockin_boundaries() -> None:
    admin, sheet, client, base = _world()
    _upload_lockin(admin, client, base, pages=20)
    assert (
        client.patch(
            f"{base}/active-study?edition=lockin",
            {
                "expected_revision": 0,
                "enabled": True,
                "excluded_start_pages": 2,
                "excluded_end_pages": 0,
            },
            format="json",
        ).status_code
        == 200
    )
    context = _context(client, base, "?excluded_start_pages=0&excluded_end_pages=1")
    saved = _save(
        client, base, _document(context), context, excluded_start_pages=0, excluded_end_pages=1
    )
    assert saved.status_code == 200, saved.json()
    lockin_settings = ActiveStudySettings.objects.get(sheet=sheet, edition="lockin")
    assert (lockin_settings.excluded_start_pages, lockin_settings.excluded_end_pages) == (2, 0)
    uni = ActiveStudySettings.objects.get(sheet=sheet, edition="university")
    assert (uni.excluded_start_pages, uni.excluded_end_pages) == (0, 1)


def test_large_document_round_trips_through_the_api() -> None:
    _, sheet, client, base = _world(pages=42)
    context = _context(client, base)
    document = _document(context, normal=200)
    for row in document["active_study"].values():
        for part in row["parts"]:
            for question in part["questions"]:
                question["explanation"] = "Long explanation. " * 40
    assert context["active_study_total"] + 200 > 600
    saved = _save(client, base, deepcopy(document), context, normal=200)
    assert saved.status_code == 200, saved.json()
    assert saved.json()["summary"]["total_received"] == context["active_study_total"] + 200
    assert Question.objects.filter(import_batch__sheet=sheet).count() == 200


def test_error_list_is_capped_but_counts_every_error() -> None:
    _, _, client, base = _world()
    context = _context(client, base)
    document = _document(context)
    for row in document["active_study"].values():
        for part in row["parts"]:
            for question in part["questions"]:
                question["correct_answer"] = "Z"
                question["explanation"] = ""
    body = _validate(client, base, document).json()
    assert body["error_count"] > 200
    assert len(body["errors"]) == 200


def test_a_failed_import_restores_the_previous_all_questions_batch(monkeypatch) -> None:
    _, sheet, client, base = _world()
    first = _context(client, base)
    assert _save(client, base, _document(first, tag="a"), first).status_code == 200

    def fail(**_: Any) -> None:
        raise QuestionRuleError("The selected sheet has no current version.")

    # The previous batch is archived before the new import, in one transaction.
    monkeypatch.setattr("apps.content.all_questions.import_questions", fail)
    second = _context(client, base)
    assert _save(client, base, _document(second, tag="b"), second).status_code == 400
    assert _context(client, base)["sheet_questions"]["all_questions_count"] == 30
    easy = ActiveStudyQuestionContent.objects.get(sheet=sheet, difficulty="easy")
    assert easy.revision == 1
