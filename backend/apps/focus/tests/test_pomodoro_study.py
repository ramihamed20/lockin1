"""Pomodoro fixes each timed reading boundary without changing legacy study progress."""

from collections import Counter
from uuid import uuid4

import pytest

from apps.focus import managed_active_study as study
from apps.focus.models import ActiveStudyAttempt, ActiveStudyRun
from apps.focus.question_identity import canonical_keys_for_attempt
from apps.focus.tests.test_managed_active_study import _client, _setup
from apps.focus.tests.test_page_active_study import custom_start, page_world, pass_test
from apps.offline.tests.test_active_study_offline import _attempt_operation, _sync
from apps.xp.models import XpTransaction

pytestmark = pytest.mark.django_db


def pomodoro_start(user, sheet):
    return study.start(user=user, sheet_id=sheet.id, difficulty="medium", study_mode="pomodoro")[0]


def close_cycle(user, run, end, count):
    return study.complete_part_reading(
        user=user, run_id=run.id, part=run.current_part, end_page=end, question_count=count
    )


def test_timed_pages_have_balanced_forty_question_test_and_separate_progress():
    user, sheet, _ = page_world()
    standard, _ = study.start(user=user, sheet_id=sheet.id, difficulty="medium")
    custom, _ = custom_start(user, sheet)
    run = pomodoro_start(user, sheet)
    assert run.id not in {standard.id, custom.id}
    assert run.plan_signature["page_ranges"] == [{"part": 1, "start_page": 2, "end_page": 22}]
    with pytest.raises(study.ManagedActiveStudyRuleError):
        study.questions(user=user, run_id=run.id)
    run = close_cycle(user, run, 7, 40)
    assert run.plan_signature["page_ranges"] == [
        {"part": 1, "start_page": 2, "end_page": 7, "question_count": 40},
        {"part": 2, "start_page": 8, "end_page": 22},
    ]
    quiz = study.questions(user=user, run_id=run.id)
    assert len(quiz["questions"]) == 40
    counts = Counter(int(q["question"].split("page-")[1].split("-")[0]) for q in quiz["questions"])
    assert set(counts) == set(range(2, 8))
    assert max(counts.values()) - min(counts.values()) == 1
    assert len({q["question"] for q in quiz["questions"]}) == 40
    assert all("correct_answer" not in q and "explanation" not in q for q in quiz["questions"])
    # A network retry keeps this cycle and its attempt, with no second split.
    close_cycle(user, run, 7, 40)
    assert study.questions(user=user, run_id=run.id)["attempt_id"] == quiz["attempt_id"]
    run, result = pass_test(user, run)
    assert result["passed"] and run.current_part == 2 and run.stage == "reading"
    assert run.unlocked_pages == 22
    row = next(
        r
        for r in study.availability(user=user, sheet_id=sheet.id)["difficulties"]
        if r["difficulty"] == "medium"
    )
    assert row["pomodoro_available"] and row["pomodoro_max_questions"] == 40
    assert row["pomodoro_progress"]["current_part"] == 2
    for untouched in (standard, custom):
        untouched.refresh_from_db()
        assert untouched.stage == "reading" and untouched.current_part == 1
    assert not XpTransaction.objects.filter(user=user).exists()


@pytest.mark.parametrize(
    ("part", "end", "count"),
    [
        (1, 1, 10),
        (1, 23, 10),
        (1, 7, 41),
        (1, 7, 0),
        (2, 7, 10),
        (1, 2, 40),
        (1, True, 10),
        (1, 7, True),
    ],
)
def test_invalid_boundaries_counts_and_stale_cycles_never_change_progress(part, end, count):
    user, sheet, _ = page_world()
    run = pomodoro_start(user, sheet)
    with pytest.raises(study.ManagedActiveStudyRuleError):
        study.complete_part_reading(
            user=user, run_id=run.id, part=part, end_page=end, question_count=count
        )
    run.refresh_from_db()
    assert run.stage == "reading" and len(run.plan_signature["page_ranges"]) == 1
    assert not run.attempts.exists()


def test_closed_cycle_cannot_change_its_questions_and_explain_identity_survives_later_cycles():
    user, sheet, bank = page_world()
    run = close_cycle(user, pomodoro_start(user, sheet), 7, 40)
    quiz = study.questions(user=user, run_id=run.id)
    attempt = ActiveStudyAttempt.objects.select_related("run").get(id=quiz["attempt_id"])
    original = canonical_keys_for_attempt(attempt, bank)
    assert len(original) == 40 and all(":page:" in key for key in original.values())
    for end, count in ((7, 10), (6, 40)):
        with pytest.raises(study.ManagedActiveStudyRuleError, match="retry keeps"):
            close_cycle(user, run, end, count)
    run, _ = pass_test(user, run)
    close_cycle(user, run, 10, 3)
    attempt.refresh_from_db()
    assert canonical_keys_for_attempt(attempt, bank) == original


def test_resuming_keeps_dynamic_ranges_and_restart_only_replaces_pomodoro():
    user, sheet, _ = page_world()
    run = close_cycle(user, pomodoro_start(user, sheet), 7, 15)
    resumed = pomodoro_start(user, sheet)
    assert resumed.id == run.id and resumed.plan_signature == run.plan_signature
    fresh = study.restart(user=user, run_id=run.id)
    run.refresh_from_db()
    assert run.status == "abandoned" and fresh.study_mode == "pomodoro"
    assert fresh.plan_signature["page_ranges"] == [{"part": 1, "start_page": 2, "end_page": 22}]


def test_final_still_has_fifty_questions_and_completion_xp_is_not_duplicated():
    user, sheet, _ = page_world()
    for _ in range(2):
        run = close_cycle(user, pomodoro_start(user, sheet), 22, 40)
        run, _ = pass_test(user, run)
        assert run.stage == "final"
        assert len(study.questions(user=user, run_id=run.id)["questions"]) == 50
        run, _ = pass_test(user, run)
        assert run.status == "completed"
    assert (
        XpTransaction.objects.filter(
            user=user, source_key__startswith="active-study-managed:"
        ).count()
        == 1
    )
    assert run.xp_awarded == 0


def test_legacy_sheets_reject_pomodoro_and_normal_reading_rejects_its_metadata():
    user, sheet, _ = _setup()
    assert not any(
        r["pomodoro_available"]
        for r in study.availability(user=user, sheet_id=sheet.id)["difficulties"]
    )
    with pytest.raises(study.ManagedActiveStudyRuleError, match="new page-based"):
        pomodoro_start(user, sheet)
    normal, _ = study.start(user=user, sheet_id=sheet.id, difficulty="medium")
    with pytest.raises(study.ManagedActiveStudyRuleError, match="only in Pomodoro"):
        close_cycle(user, normal, 7, 10)


def test_api_starts_pomodoro_and_validates_checkpoint_request():
    user, sheet, _ = page_world()
    client = _client(user)
    started = client.post(
        "/api/v1/focus/managed-active-study/start",
        {"sheet_id": str(sheet.id), "difficulty": "medium", "study_mode": "pomodoro"},
        format="json",
    )
    assert started.status_code == 201, started.json()
    run_id = started.json()["run"]["id"]
    path = f"/api/v1/focus/managed-active-study/{run_id}/complete-reading"
    for body in (
        {},
        {"part": 1, "end_page": 7, "question_count": 41},
        {"part": 1, "end_page": 7, "question_count": 10, "score": 10},
    ):
        assert client.post(path, body, format="json").status_code == 400
    closed = client.post(path, {"part": 1, "end_page": 7, "question_count": 40}, format="json")
    assert closed.status_code == 200, closed.json()
    assert closed.json()["run"]["current_page_range"]["end_page"] == 7


def test_offline_replay_uses_exact_closed_pages_count_and_idempotent_attempt():
    user, sheet, bank = page_world()
    attempt_id = uuid4()
    options = dict(
        user=user,
        sheet_id=sheet.id,
        edition="university",
        difficulty="medium",
        study_mode="pomodoro",
        bank_revision=bank.revision,
        kind="checkpoint",
        part=1,
        checkpoint_end_page=7,
        checkpoint_question_count=40,
        attempt_id=attempt_id,
        answers=[{"position": i, "selected_answer": "B"} for i in range(1, 41)],
    )
    applied = study.replay_offline_attempt(**options)
    assert applied["status"] == "applied" and applied["result"]["passed"]
    assert applied["run"]["current_page_range"]["start_page"] == 8
    assert study.replay_offline_attempt(**options)["status"] == "duplicate"
    assert ActiveStudyAttempt.objects.filter(id=attempt_id).count() == 1
    assert ActiveStudyRun.objects.get(id=applied["run"]["id"]).checkpoint_attempts == 1


def test_offline_sync_transport_validates_pomodoro_metadata_and_server_grades_forty():
    user, sheet, bank = page_world()
    operation = _attempt_operation(sheet, total=40, correct=40)
    operation["payload"].update(
        {
            "study_mode": "pomodoro",
            "bank_revision": bank.revision,
            "pomodoro_checkpoint": {"end_page": 7, "question_count": 40},
        }
    )
    response = _sync(user, [operation])
    assert response.status_code == 200, response.json()
    accepted = response.json()["accepted"]
    assert len(accepted) == 1
    assert accepted[0]["result"]["result"]["score"] == 40
    assert accepted[0]["result"]["run"]["current_page_range"]["start_page"] == 8
    # A malformed second cycle is rejected before a new boundary can be written.
    broken = _attempt_operation(sheet, part=2)
    broken["payload"].update(
        {
            "study_mode": "pomodoro",
            "bank_revision": bank.revision,
            "pomodoro_checkpoint": {"end_page": 10, "question_count": 41},
        }
    )
    rejected = _sync(user, [broken]).json()
    assert not rejected["accepted"]
    run = ActiveStudyRun.objects.get(user=user, sheet=sheet, study_mode="pomodoro")
    assert run.current_part == 2 and "question_count" not in run.plan_signature["page_ranges"][1]


def test_changed_bank_cannot_close_or_resume_a_pomodoro_session():
    user, sheet, bank = page_world()
    run = pomodoro_start(user, sheet)
    bank.revision += 1
    bank.save(update_fields=["revision"])
    with pytest.raises(study.ManagedActiveStudyRuleError, match="Questions changed"):
        close_cycle(user, run, 7, 40)
    with pytest.raises(study.ManagedActiveStudyRuleError, match="Questions changed"):
        pomodoro_start(user, sheet)


def test_downloaded_bundle_advertises_pomodoro_without_versioning_student_progress():
    user, sheet, _ = page_world()
    client = _client(user)
    path = f"/api/v1/offline/active-study/{sheet.id}/"
    before = client.get(path)
    assert before.status_code == 200, before.json()
    row = next(
        r for r in before.json()["availability"]["difficulties"] if r["difficulty"] == "medium"
    )
    assert row["pomodoro_available"] and row["pomodoro_progress"] is None
    run = close_cycle(user, pomodoro_start(user, sheet), 7, 40)
    after = client.get(path).json()
    assert before.json()["content_version"] == after["content_version"]
    row = next(r for r in after["availability"]["difficulties"] if r["difficulty"] == "medium")
    assert row["pomodoro_progress"]["id"] == str(run.id)
    assert row["pomodoro_progress"]["current_page_range"]["end_page"] == 7
