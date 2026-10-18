"""Page banks power both styles while pre-rollout sheets keep their original contract."""

from copy import deepcopy
from uuid import uuid4

import pytest

from apps.content.active_study import difficulty_for_key
from apps.content.active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)
from apps.content.admin_services import active_study_plan_preview
from apps.content.all_questions import all_questions_context, validate_all_questions
from apps.content.models import ActiveStudyQuestionContent
from apps.focus.managed_active_study import (
    ManagedActiveStudyRuleError,
    answer,
    availability,
    complete_part_reading,
    offline_bundle,
    questions,
    replay_offline_attempt,
    start,
    submit,
)
from apps.focus.models import ActiveStudyRun
from apps.focus.tests.test_managed_active_study import _client, _grant_focus, _question, _setup
from apps.review.models import ReviewItem
from apps.xp.models import XpTransaction

pytestmark = pytest.mark.django_db


def page_world():
    user, sheet, settings = _setup()
    sheet.active_study_page_bank_enabled = True
    sheet.save(update_fields=("active_study_page_bank_enabled",))
    content = ActiveStudyQuestionContent.objects.get(sheet=sheet)
    content.payload = {
        "pages": [
            {"page": page, "questions": [_question(f"page-{page}-q-{q}") for q in range(15)]}
            for page in range(2, 23)
        ],
        "final_exam": {"questions": [_question(f"final-{q}") for q in range(50)]},
    }
    content.checkpoint_question_count = 315
    content.save()
    return user, sheet, content


def custom_start(user, sheet, **options):
    return start(
        user=user,
        sheet_id=sheet.id,
        difficulty="medium",
        study_mode="custom",
        pages_per_checkpoint=options.pop("pages", 3),
        questions_per_checkpoint=options.pop("count", 5),
        **options,
    )


def pass_test(user, run):
    payload = questions(user=user, run_id=run.id)
    return submit(
        user=user,
        run_id=run.id,
        attempt_id=payload["attempt_id"],
        answers=[{"position": q["position"], "selected_answer": "B"} for q in payload["questions"]],
    )


def test_new_bank_supports_both_styles_with_independent_progress_and_page_only_questions():
    user, sheet, _ = page_world()
    standard, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    custom, created = custom_start(user, sheet)
    assert created and standard.id != custom.id
    assert custom.plan_signature["page_ranges"][0] == {"part": 1, "start_page": 2, "end_page": 4}
    complete_part_reading(user=user, run_id=custom.id)
    payload = questions(user=user, run_id=custom.id)
    assert len(payload["questions"]) == 5
    assert all(
        any(f"page-{page}-" in q["question"] for page in (2, 3, 4)) for q in payload["questions"]
    )
    assert all("correct_answer" not in q and "explanation" not in q for q in payload["questions"])
    custom, result = pass_test(user, custom)
    assert result["passed"] and custom.current_part == 2 and custom.unlocked_pages == 7
    standard.refresh_from_db()
    assert standard.current_part == 1 and standard.stage == "reading"
    summary = next(
        row
        for row in availability(user=user, sheet_id=sheet.id)["difficulties"]
        if row["difficulty"] == "medium"
    )
    assert summary["progress"]["id"] == str(standard.id)
    assert summary["custom_progress"]["id"] == str(custom.id)


@pytest.mark.parametrize(
    ("pages", "count"),
    [(0, 5), (11, 5), (22, 5), (3, 0), (3, 31), (1, 16), (True, 5), (3, True)],
)
def test_custom_limits_are_server_owned(pages, count):
    user, sheet, _ = page_world()
    with pytest.raises(ManagedActiveStudyRuleError):
        custom_start(user, sheet, pages=pages, count=count)
    assert not ActiveStudyRun.objects.filter(sheet=sheet).exists()


def test_legacy_sheet_never_enables_customization_or_accepts_custom_start():
    user, sheet, _ = _setup()
    summary = availability(user=user, sheet_id=sheet.id)
    assert not any(row["customization_available"] for row in summary["difficulties"])
    with pytest.raises(ManagedActiveStudyRuleError, match="new page-based"):
        custom_start(user, sheet)
    run, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    assert run.study_mode == "standard"


def test_last_group_remains_short_and_fifteen_question_max_works_for_single_page():
    user, sheet, _ = page_world()
    run, _ = custom_start(user, sheet, pages=4, count=15)
    assert run.plan_signature["page_ranges"][-1] == {"part": 6, "start_page": 22, "end_page": 22}
    for _ in range(6):
        complete_part_reading(user=user, run_id=run.id)
        payload = questions(user=user, run_id=run.id)
        assert len(payload["questions"]) == 15
        run, _ = pass_test(user, run)
    assert run.stage == "final"
    assert len(questions(user=user, run_id=run.id)["questions"]) == 50


def test_setting_changes_require_explicit_replacement_and_keep_standard_progress():
    user, sheet, _ = page_world()
    standard, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    original, _ = custom_start(user, sheet)
    resumed, created = custom_start(user, sheet)
    assert resumed.id == original.id and not created
    with pytest.raises(ManagedActiveStudyRuleError, match="Resume or restart"):
        custom_start(user, sheet, pages=2)
    new, created = custom_start(user, sheet, pages=2, replace_existing=True)
    original.refresh_from_db()
    standard.refresh_from_db()
    assert created and original.status == "abandoned" and new.id != original.id
    assert standard.status == "active" and standard.current_part == 1


def test_custom_and_standard_completion_do_not_duplicate_completion_xp():
    user, sheet, _ = page_world()

    def finish(run):
        # Ten pages is the largest group, so 21 study pages take three checkpoints.
        for _ in range(8):
            if run.status == "completed":
                break
            if run.stage == "reading":
                complete_part_reading(user=user, run_id=run.id)
            run, _ = pass_test(user, run)
        return run

    run, _ = custom_start(user, sheet, pages=10, count=1)
    run = finish(run)
    assert run.status == "completed"
    second, _ = custom_start(user, sheet, pages=10, count=15)
    second = finish(second)
    assert second.status == "completed" and second.xp_awarded == 0
    assert (
        XpTransaction.objects.filter(
            source_key=f"active-study-managed:{user.id}:{sheet.id}:medium"
        ).count()
        == 1
    )


def test_review_identity_is_stable_across_standard_and_custom_regrouping():
    user, sheet, _ = page_world()
    for run in (
        custom_start(user, sheet, pages=1, count=1)[0],
        start(user=user, sheet_id=sheet.id, difficulty="medium")[0],
    ):
        complete_part_reading(user=user, run_id=run.id)
        payload = questions(user=user, run_id=run.id)
        answer(
            user=user,
            run_id=run.id,
            attempt_id=payload["attempt_id"],
            position=1,
            selected_answer="A",
        )
    assert ReviewItem.objects.filter(user=user, source_id=str(sheet.id)).count() == 1


def test_offline_bundle_and_replay_use_the_identical_custom_plan_and_are_idempotent():
    user, sheet, content = page_world()
    bundle = offline_bundle(user=user, sheet_id=sheet.id)
    assert len(bundle["difficulties"]["medium"]["pages"]) == 21
    assert len(bundle["difficulties"]["medium"]["parts"][0]["questions"]) == 15
    event = dict(
        user=user,
        sheet_id=sheet.id,
        edition="university",
        difficulty="medium",
        kind="checkpoint",
        part=1,
        attempt_id=uuid4(),
        answers=[{"position": p, "selected_answer": "B"} for p in range(1, 6)],
        study_mode="custom",
        pages_per_checkpoint=3,
        questions_per_checkpoint=5,
        bank_revision=content.revision,
    )
    result = replay_offline_attempt(**event)
    again = replay_offline_attempt(**event)
    assert result["status"] == "applied" and again["status"] == "duplicate"
    assert result["run"]["current_page_range"] == {"part": 2, "start_page": 5, "end_page": 7}


def test_page_json_rejects_omitted_excluded_duplicate_pages_and_incomplete_banks():
    _, sheet, content = page_world()
    plan = active_study_plan_preview(sheet=sheet)["difficulties"][1]

    def validate(payload):
        return validate_active_study_questions(
            payload,
            difficulty=difficulty_for_key("medium"),
            number_of_parts=plan["number_of_parts"],
            page_ranges=plan["page_ranges"],
            question_format="pages",
        )

    assert validate(content.payload).checkpoint_question_count == 315
    shortened = deepcopy(content.payload)
    shortened["pages"][0]["questions"] = shortened["pages"][0]["questions"][:4]
    assert validate(shortened).checkpoint_question_count == 304
    for change in (
        lambda p: p["pages"].pop(),
        lambda p: p["pages"][0].update(page=1),
        lambda p: p["pages"][0].update(questions=[]),
        lambda p: p["pages"][0]["questions"].append(_question("sixteenth")),
        lambda p: p["pages"].append(p["pages"][0]),
    ):
        invalid = deepcopy(content.payload)
        change(invalid)
        with pytest.raises(ActiveStudyQuestionValidationError):
            validate(invalid)


def test_sparse_page_banks_work_in_standard_custom_and_offline_modes():
    user, sheet, content = page_world()
    content.payload["pages"] = [
        {**page, "questions": page["questions"][:1]} for page in content.payload["pages"]
    ]
    content.checkpoint_question_count = len(content.payload["pages"])
    content.save()
    rows = availability(user=user, sheet_id=sheet.id)["difficulties"]
    medium = next(row for row in rows if row["difficulty"] == "medium")
    assert medium["status"] == "ready"

    standard, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    complete_part_reading(user=user, run_id=standard.id)
    expected_range = standard.plan_signature["page_ranges"][0]
    expected_count = expected_range["end_page"] - expected_range["start_page"] + 1
    assert len(questions(user=user, run_id=standard.id)["questions"]) == expected_count

    downloaded = offline_bundle(user=user, sheet_id=sheet.id)
    assert len(downloaded["difficulties"]["medium"]["parts"][0]["questions"]) == expected_count

    with pytest.raises(ManagedActiveStudyRuleError, match="at most 2 questions"):
        custom_start(user, sheet, pages=2, count=3)
    custom, _ = custom_start(user, sheet, pages=2, count=2)
    complete_part_reading(user=user, run_id=custom.id)
    assert len(questions(user=user, run_id=custom.id)["questions"]) == 2


def test_a_bank_of_twenty_per_page_written_before_the_fifteen_rule_stays_ready():
    user, sheet, content = page_world()
    content.payload = {
        **content.payload,
        "pages": [
            {**page, "questions": [_question(f"old-{page['page']}-{q}") for q in range(20)]}
            for page in content.payload["pages"]
        ],
    }
    content.save()
    row = next(
        item
        for item in availability(user=user, sheet_id=sheet.id)["difficulties"]
        if item["difficulty"] == "medium"
    )
    assert row["status"] == "ready" and row["pomodoro_available"]
    run, _ = custom_start(user, sheet, pages=1, count=15)
    complete_part_reading(user=user, run_id=run.id)
    assert len(questions(user=user, run_id=run.id)["questions"]) == 15
    with pytest.raises(ManagedActiveStudyRuleError):
        custom_start(user, sheet, pages=1, count=16, replace_existing=True)


def test_page_format_is_consistent_in_all_questions_context_and_validator():
    _, sheet, content = page_world()
    context = all_questions_context(sheet=sheet, edition="university")
    assert all(
        row["question_format"] == "pages" and row["part_question_total"] == 315
        for row in context["difficulties"]
    )
    result = validate_all_questions(
        sheet=sheet,
        edition="university",
        sheet_question_count=0,
        payload={
            "active_study": {key: deepcopy(content.payload) for key in ("easy", "medium", "hard")},
            "sheet_questions": {"questions": []},
        },
    )
    assert result.summary["total_received"] == 3 * 365
    assert all(row["question_format"] == "pages" for row in result.summary["difficulties"])


def test_api_enforces_thirty_max_and_does_not_leak_customization_to_legacy_sheets():
    user, sheet, _ = page_world()
    _grant_focus(user)
    client = _client(user)
    body = {
        "sheet_id": str(sheet.id),
        "difficulty": "medium",
        "study_mode": "custom",
        "pages_per_checkpoint": 3,
        "questions_per_checkpoint": 31,
    }
    path = "/api/v1/focus/managed-active-study/start"
    assert client.post(path, body, format="json").status_code == 400
    body["questions_per_checkpoint"] = 5
    response = client.post(path, body, format="json")
    assert response.status_code == 201, response.json()
    assert response.json()["run"]["study_mode"] == "custom"


def test_admin_new_sheet_creation_opts_into_page_bank():
    from apps.content.admin_services import create_sheet
    from apps.education.tests.helpers import pdf_upload
    from apps.files.services import create_managed_file

    _, legacy, content = page_world()
    actor = content.created_by
    subject = legacy.current_version.academic_node
    new = create_sheet(
        actor=actor,
        subject=subject,
        managed_file=create_managed_file(owner=actor, upload=pdf_upload(), kind="pdf"),
        title="New rollout sheet",
        summary="",
        position=1,
        publish=False,
        notify_students=False,
        allow_download=False,
    )
    assert new.active_study_page_bank_enabled


def test_page_bank_import_uses_the_admin_validation_and_persistence_path():
    from apps.content.admin_services import save_active_study_question_content

    _, sheet, content = page_world()
    actor = content.created_by
    payload = deepcopy(content.payload)
    saved = save_active_study_question_content(
        actor=actor, sheet_id=sheet.id, difficulty_key="hard", payload=payload, expected_revision=0
    )
    assert "pages" in saved.payload and "parts" not in saved.payload
    assert saved.checkpoint_question_count == 315


def test_custom_run_refuses_changed_bank_before_grading_or_resuming():
    user, sheet, content = page_world()
    run, _ = custom_start(user, sheet)
    complete_part_reading(user=user, run_id=run.id)
    content.revision += 1
    content.save(update_fields=("revision",))
    with pytest.raises(ManagedActiveStudyRuleError, match="Questions changed"):
        questions(user=user, run_id=run.id)
    with pytest.raises(ManagedActiveStudyRuleError, match="Questions changed"):
        custom_start(user, sheet)


def test_offline_continuation_cannot_apply_to_different_custom_settings():
    from apps.focus.managed_active_study import replay_offline_continue

    user, sheet, content = page_world()
    run, _ = custom_start(user, sheet)
    complete_part_reading(user=user, run_id=run.id)
    payload = questions(user=user, run_id=run.id)
    submit(
        user=user,
        run_id=run.id,
        attempt_id=payload["attempt_id"],
        answers=[{"position": q["position"], "selected_answer": "A"} for q in payload["questions"]],
    )
    with pytest.raises(ManagedActiveStudyRuleError, match="Offline settings"):
        replay_offline_continue(
            user=user,
            sheet_id=sheet.id,
            edition="university",
            difficulty="medium",
            part=1,
            study_mode="custom",
            pages_per_checkpoint=2,
            questions_per_checkpoint=5,
            bank_revision=content.revision,
        )
    accepted = replay_offline_continue(
        user=user,
        sheet_id=sheet.id,
        edition="university",
        difficulty="medium",
        part=1,
        study_mode="custom",
        pages_per_checkpoint=3,
        questions_per_checkpoint=5,
        bank_revision=content.revision,
    )
    assert accepted["run"]["current_part"] == 2
