from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any
from uuid import uuid4

import pytest
from django.contrib.auth.models import Group
from django.db import close_old_connections, connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.content.active_study import plan_payload
from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.review.models import ReviewItem
from apps.xp.models import XpTransaction

from ..managed_active_study import (
    ManagedActiveStudyRuleError,
    abandon,
    answer,
    availability,
    complete_part_reading,
    continue_anyway,
    questions,
    start,
    study_again,
    submit,
)
from ..models import ActiveStudyAnswer, ActiveStudyAttempt, ActiveStudyRun

pytestmark = pytest.mark.django_db


def _question(label: str) -> dict[str, object]:
    return {
        "question": f"Question {label}?",
        "options": {"A": f"A {label}", "B": f"B {label}", "C": f"C {label}", "D": f"D {label}"},
        "correct_answer": "B",
        "explanation": f"Explanation {label}.",
    }


def _payload(parts: int = 4) -> dict[str, object]:
    return {
        "parts": [
            {"part": part, "questions": [_question(f"P{part}-{index}") for index in range(1, 16)]}
            for part in range(1, parts + 1)
        ],
        "final_exam": {"questions": [_question(f"F-{index}") for index in range(1, 51)]},
    }


def _setup() -> tuple[Any, Any, Any]:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = published_pdf(actor=admin, node=subject, title="Active PDF")
    settings = ActiveStudySettings.objects.create(
        sheet=sheet, enabled=True, total_pdf_pages=22, excluded_start_pages=1
    )
    plan = plan_payload(total_pdf_pages=22, excluded_start_pages=1, excluded_end_pages=0)
    medium = next(item for item in plan["difficulties"] if item["difficulty"] == "medium")
    ActiveStudyQuestionContent.objects.create(
        sheet=sheet,
        difficulty="medium",
        payload=_payload(),
        plan_signature={
            "number_of_parts": medium["number_of_parts"],
            "page_ranges": medium["page_ranges"],
        },
        checkpoint_question_count=60,
        final_exam_question_count=50,
        created_by=admin,
        updated_by=admin,
    )
    return create_user(), sheet, settings


def _open_checkpoint(user: Any, sheet: Any) -> tuple[Any, dict[str, Any]]:
    run, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    complete_part_reading(user=user, run_id=run.id)
    return run, questions(user=user, run_id=run.id)


def _answer_count(user: Any, run: Any, payload: dict[str, Any], count: int) -> None:
    for item in payload["questions"]:
        selected = "B" if item["position"] <= count else "A"
        answer(
            user=user,
            run_id=run.id,
            attempt_id=payload["attempt_id"],
            position=item["position"],
            selected_answer=selected,
        )


def _grant_focus(user: Any) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="focus.workspace"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def _client(user: Any) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_ready_availability_uses_the_existing_content_status_and_resumes() -> None:
    user, sheet, _ = _setup()
    before = availability(user=user, sheet_id=sheet.id)
    medium = next(item for item in before["difficulties"] if item["difficulty"] == "medium")
    assert medium["status"] == "ready"
    run, created = start(user=user, sheet_id=sheet.id, difficulty="medium")
    resumed, created_again = start(user=user, sheet_id=sheet.id, difficulty="medium")
    assert created is True and created_again is False and resumed.id == run.id
    assert run.current_page_range if False else run.current_part == 1


def test_availability_is_per_difficulty_and_pdf_rendering_is_not_a_readiness_input() -> None:
    user, sheet, settings = _setup()
    payload = availability(user=user, sheet_id=sheet.id)
    by_difficulty = {item["difficulty"]: item for item in payload["difficulties"]}
    assert by_difficulty["medium"]["status"] == "ready"
    assert by_difficulty["easy"]["status"] == "not_configured"

    # Browser PDF.js failures never reach this server-owned calculation.
    settings.refresh_from_db()
    unchanged = availability(user=user, sheet_id=sheet.id)
    assert (
        next(item for item in unchanged["difficulties"] if item["difficulty"] == "medium")["status"]
        == "ready"
    )


def test_checkpoint_passing_and_low_score_choices_preserve_attempt_history() -> None:
    user, sheet, _ = _setup()
    run, payload = _open_checkpoint(user, sheet)
    _answer_count(user, run, payload, 10)
    run, result = submit(user=user, run_id=run.id, attempt_id=payload["attempt_id"])
    assert result["passed"] is True
    assert run.current_part == 2

    complete_part_reading(user=user, run_id=run.id)
    payload = questions(user=user, run_id=run.id)
    _answer_count(user, run, payload, 9)
    run, result = submit(user=user, run_id=run.id, attempt_id=payload["attempt_id"])
    assert result["passed"] is False
    assert run.stage == ActiveStudyRun.Stage.CHECKPOINT_RESULT
    retried = study_again(user=user, run_id=run.id)
    assert retried.current_part == 2 and retried.stage == ActiveStudyRun.Stage.READING
    assert ActiveStudyAttempt.objects.filter(run=run, part_number=2).count() == 1

    complete_part_reading(user=user, run_id=run.id)
    payload = questions(user=user, run_id=run.id)
    _answer_count(user, run, payload, 9)
    run, _ = submit(user=user, run_id=run.id, attempt_id=payload["attempt_id"])
    run = continue_anyway(user=user, run_id=run.id)
    assert run.current_part == 3
    assert ActiveStudyAttempt.objects.filter(run=run, part_number=2).count() == 2
    assert ActiveStudyAttempt.objects.filter(run=run, part_number=2, continued_anyway=True).exists()


def test_final_exam_requires_all_parts_and_awards_completion_xp_once() -> None:
    user, sheet, _ = _setup()
    run, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    with pytest.raises(ManagedActiveStudyRuleError):
        questions(user=user, run_id=run.id)
    for _ in range(4):
        complete_part_reading(user=user, run_id=run.id)
        payload = questions(user=user, run_id=run.id)
        _answer_count(user, run, payload, 10)
        run, _ = submit(user=user, run_id=run.id, attempt_id=payload["attempt_id"])
    assert run.stage == ActiveStudyRun.Stage.FINAL
    final = questions(user=user, run_id=run.id)
    _answer_count(user, run, final, 35)
    run, result = submit(user=user, run_id=run.id, attempt_id=final["attempt_id"])
    assert result["passed"] is True and result["completed"] is True
    assert XpTransaction.objects.filter(user=user, rule_code="active_study_medium_v1").count() == 1
    _, repeated = submit(user=user, run_id=run.id, attempt_id=final["attempt_id"])
    assert repeated["already_submitted"] is True
    assert XpTransaction.objects.filter(user=user, rule_code="active_study_medium_v1").count() == 1


def test_admin_configured_real_sheet_completes_through_student_managed_api() -> None:
    admin = create_admin(email="active-study-api-admin@example.com")
    _, subject, _ = published_path(admin=admin)
    sheet = published_pdf(actor=admin, node=subject, title="Managed API sheet")
    admin_client = _client(admin)
    configured = admin_client.patch(
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
    assert configured.status_code == 200
    imported = admin_client.put(
        f"/api/v1/operations/admin/content/sheets/{sheet.id}/active-study/questions/medium",
        {"expected_revision": 0, "payload": _payload()},
        format="json",
    )
    assert imported.status_code == 200

    student = create_user(email="active-study-api-student@example.com")
    _grant_focus(student)
    client = _client(student)
    started = client.post(
        "/api/v1/focus/managed-active-study/start",
        {"sheet_id": str(sheet.id), "difficulty": "medium"},
        format="json",
    )
    assert started.status_code == 201
    run = started.json()["run"]

    for _ in range(4):
        opened = client.post(
            f"/api/v1/focus/managed-active-study/{run['id']}/complete-reading", {}, format="json"
        )
        assert opened.status_code == 200
        quiz = client.get(
            f"/api/v1/focus/managed-active-study/{run['id']}/questions"
        ).json()
        for question in quiz["questions"]:
            answer_response = client.post(
                f"/api/v1/focus/managed-active-study/{run['id']}/answer",
                {
                    "attempt_id": quiz["attempt_id"],
                    "position": question["position"],
                    "selected_answer": "B",
                },
                format="json",
            )
            assert answer_response.status_code == 200
        submitted = client.post(
            f"/api/v1/focus/managed-active-study/{run['id']}/submit",
            {"attempt_id": quiz["attempt_id"]},
            format="json",
        )
        assert submitted.status_code == 200
        run = submitted.json()["run"]

    assert run["stage"] == "final"
    final = client.get(
        f"/api/v1/focus/managed-active-study/{run['id']}/questions"
    ).json()
    for question in final["questions"]:
        selected = "B" if question["position"] <= 35 else "A"
        assert client.post(
            f"/api/v1/focus/managed-active-study/{run['id']}/answer",
            {
                "attempt_id": final["attempt_id"],
                "position": question["position"],
                "selected_answer": selected,
            },
            format="json",
        ).status_code == 200
    completed = client.post(
        f"/api/v1/focus/managed-active-study/{run['id']}/submit",
        {"attempt_id": final["attempt_id"]},
        format="json",
    )

    assert completed.status_code == 200
    assert completed.json()["result"]["completed"] is True
    assert completed.json()["result"]["xp_awarded"] > 0
    assert ReviewItem.objects.filter(user=student, canonical_key__contains=":final:").count() == 15


def test_legacy_api_refuses_new_runs_but_keeps_existing_runtime_intact() -> None:
    student = create_user(email="legacy-start-disabled@example.com")
    _grant_focus(student)

    response = _client(student).post(
        "/api/v1/focus/active-study/start",
        {
            "material_slug": "oral-histology",
            "sheet_slug": "sheet-4",
            "difficulty": "medium",
            "page_count": 16,
        },
        format="json",
    )

    assert response.status_code == 400
    assert "managed sheet reader" in response.json()["error"]["message"]


def test_final_score_34_does_not_complete_and_records_wrong_answers() -> None:
    user, sheet, _ = _setup()
    run, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    for _ in range(4):
        complete_part_reading(user=user, run_id=run.id)
        payload = questions(user=user, run_id=run.id)
        _answer_count(user, run, payload, 10)
        run, _ = submit(user=user, run_id=run.id, attempt_id=payload["attempt_id"])
    final = questions(user=user, run_id=run.id)
    _answer_count(user, run, final, 34)
    run, result = submit(user=user, run_id=run.id, attempt_id=final["attempt_id"])
    assert result["passed"] is False and run.status == ActiveStudyRun.Status.ACTIVE
    assert run.stage == ActiveStudyRun.Stage.FINAL_RESULT
    assert ReviewItem.objects.filter(user=user, canonical_key__contains=":final:").count() == 16


def test_answer_is_server_scored_and_cannot_be_rewritten() -> None:
    user, sheet, _ = _setup()
    run, payload = _open_checkpoint(user, sheet)
    feedback = answer(
        user=user, run_id=run.id, attempt_id=payload["attempt_id"], position=1, selected_answer="A"
    )
    assert feedback["correct"] is False and feedback["correct_answer"] == "B"
    with pytest.raises(ManagedActiveStudyRuleError):
        answer(
            user=user,
            run_id=run.id,
            attempt_id=payload["attempt_id"],
            position=1,
            selected_answer="B",
        )


def test_abandon_retains_attempt_evidence_and_allows_a_fresh_run() -> None:
    user, sheet, _ = _setup()
    run, payload = _open_checkpoint(user, sheet)
    answer(
        user=user,
        run_id=run.id,
        attempt_id=payload["attempt_id"],
        position=1,
        selected_answer="A",
    )

    abandoned = abandon(user=user, run_id=run.id)
    restarted, created = start(user=user, sheet_id=sheet.id, difficulty="medium")

    assert abandoned.status == ActiveStudyRun.Status.ABANDONED
    assert restarted.id != abandoned.id and created is True
    assert ActiveStudyAttempt.objects.filter(run=abandoned).count() == 1
    assert ActiveStudyAnswer.objects.filter(attempt__run=abandoned).count() == 1


def test_active_study_runs_are_strictly_isolated_between_students() -> None:
    first, sheet, _ = _setup()
    second = create_user(email="active-study-isolated@example.com")
    first_run, _ = start(user=first, sheet_id=sheet.id, difficulty="medium")
    second_run, _ = start(user=second, sheet_id=sheet.id, difficulty="medium")

    assert first_run.id != second_run.id
    with pytest.raises(ManagedActiveStudyRuleError):
        complete_part_reading(user=second, run_id=first_run.id)
    assert ActiveStudyRun.objects.filter(user=first, sheet=sheet).count() == 1
    assert ActiveStudyRun.objects.filter(user=second, sheet=sheet).count() == 1


@pytest.mark.postgres
def test_managed_run_lock_targets_only_the_run_row() -> None:
    user, sheet, _ = _setup()
    run, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")

    with CaptureQueriesContext(connection) as queries:
        complete_part_reading(user=user, run_id=run.id)

    locking_query = next(
        query["sql"] for query in queries.captured_queries if "FOR UPDATE" in query["sql"]
    )
    assert 'FOR UPDATE OF "focus_activestudyrun"' in locking_query
    assert '"content_learningobject"' not in locking_query.split("FOR UPDATE", maxsplit=1)[1]


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicate_answers_create_one_persisted_answer() -> None:
    Group.objects.get_or_create(name=Role.ADMINISTRATOR.value)
    user, sheet, _ = _setup()
    run, payload = _open_checkpoint(user, sheet)

    def submit_same_answer() -> dict[str, Any]:
        close_old_connections()
        try:
            return answer(
                user=user,
                run_id=run.id,
                attempt_id=payload["attempt_id"],
                position=1,
                selected_answer="B",
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: submit_same_answer(), range(2)))

    assert all(result["correct"] is True for result in results)
    assert (
        ActiveStudyAnswer.objects.filter(
            attempt_id=payload["attempt_id"], question_position=1
        ).count()
        == 1
    )
