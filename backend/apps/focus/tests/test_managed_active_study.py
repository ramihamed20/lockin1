from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from django.contrib.auth.models import Group
from django.db import close_old_connections, connection
from django.test.utils import CaptureQueriesContext

from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.content.active_study import plan_payload
from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.review.models import ReviewItem
from apps.xp.models import XpTransaction

from ..managed_active_study import (
    ManagedActiveStudyRuleError,
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


def test_ready_availability_uses_the_existing_content_status_and_resumes() -> None:
    user, sheet, _ = _setup()
    before = availability(user=user, sheet_id=sheet.id)
    medium = next(item for item in before["difficulties"] if item["difficulty"] == "medium")
    assert medium["status"] == "ready"
    run, created = start(user=user, sheet_id=sheet.id, difficulty="medium")
    resumed, created_again = start(user=user, sheet_id=sheet.id, difficulty="medium")
    assert created is True and created_again is False and resumed.id == run.id
    assert run.current_page_range if False else run.current_part == 1


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


def test_final_score_34_does_not_complete_and_records_wrong_answers() -> (
    None
):
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
    assert (
        ReviewItem.objects.filter(user=user, canonical_key__contains=":final:").count() == 16
    )


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
