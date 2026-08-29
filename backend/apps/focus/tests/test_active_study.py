import pytest

from apps.accounts.tests.helpers import create_user
from apps.xp.models import XpBalance, XpTransaction

from ..active_study import (
    _questions_for_run,
    active_quiz,
    continue_active_study,
    start_active_study,
    submit_active_quiz,
)

pytestmark = pytest.mark.django_db


def _start(user, difficulty="medium"):  # type: ignore[no-untyped-def]
    return start_active_study(
        user=user,
        material_slug="oral-histology",
        sheet_slug="sheet-4",
        difficulty=difficulty,
        page_count=16,
    )[0]


def _answers(run, correct_count):  # type: ignore[no-untyped-def]
    questions = _questions_for_run(run, include_answers=True)
    answers = {}
    for index, question in enumerate(questions):
        if index < correct_count:
            answers[question["id"]] = question["correct_option_id"]
        else:
            answers[question["id"]] = next(
                option["id"]
                for option in question["options"]
                if option["id"] != question["correct_option_id"]
            )
    return answers


def test_active_study_resumes_and_exposes_no_answer_keys() -> None:
    user = create_user(email="active-study-resume@example.com")
    run = _start(user)

    resumed, created = start_active_study(
        user=user,
        material_slug="oral-histology",
        sheet_slug="sheet-4",
        difficulty="hard",
        page_count=16,
    )
    _, public_questions = active_quiz(user=user, run_id=run.id)

    assert created is False
    assert resumed.id == run.id
    assert resumed.difficulty == "medium"
    assert len(public_questions) == 10
    assert all("correct_option_id" not in question for question in public_questions)


def test_active_study_is_available_for_every_catalog_test_sheet() -> None:
    user = create_user(email="active-study-shared-sheet@example.com")

    run, created = start_active_study(
        user=user,
        material_slug="microbiology",
        sheet_slug="sheet-2",
        difficulty="easy",
        page_count=16,
    )

    assert created is True
    assert run.material_slug == "microbiology"
    assert run.sheet_slug == "sheet-2"


def test_checkpoint_thresholds_unlock_or_require_a_choice() -> None:
    passing_user = create_user(email="active-study-pass@example.com")
    passing_run = _start(passing_user)
    passing_run, passing = submit_active_quiz(
        user=passing_user, run_id=passing_run.id, answers=_answers(passing_run, 7)
    )
    assert passing["outcome"] == "passed"
    assert passing_run.unlocked_pages == 6

    advisory_user = create_user(email="active-study-advisory@example.com")
    advisory_run = _start(advisory_user)
    advisory_run, advisory = submit_active_quiz(
        user=advisory_user, run_id=advisory_run.id, answers=_answers(advisory_run, 5)
    )
    assert advisory["outcome"] == "advisory"
    assert advisory["can_continue"] is True
    assert advisory_run.unlocked_pages == 3
    advisory_run = continue_active_study(user=advisory_user, run_id=advisory_run.id)
    assert advisory_run.unlocked_pages == 6

    blocked_user = create_user(email="active-study-blocked@example.com")
    blocked_run = _start(blocked_user)
    blocked_run, blocked = submit_active_quiz(
        user=blocked_user, run_id=blocked_run.id, answers=_answers(blocked_run, 4)
    )
    assert blocked["outcome"] == "blocked"
    assert blocked_run.unlocked_pages == 3


def test_final_assessment_awards_server_authoritative_xp_once() -> None:
    user = create_user(email="active-study-final@example.com")
    run = _start(user, difficulty="hard")
    run.unlocked_pages = 16
    run.save(update_fields=("unlocked_pages", "updated_at"))

    run, result = submit_active_quiz(user=user, run_id=run.id, answers=_answers(run, 35))

    assert result["total"] == 50
    assert result["completed"] is True
    assert result["xp_awarded"] == 200
    assert run.status == "completed"
    assert XpBalance.objects.get(user=user).total_points == 200
    assert XpTransaction.objects.filter(user=user, rule_code="active_study_hard_v1").count() == 1
