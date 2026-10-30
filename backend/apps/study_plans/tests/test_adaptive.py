from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.content.active_study import plan_payload
from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings, CatalogDocument
from apps.focus.managed_active_study import complete_part_reading, questions, start, submit
from apps.focus.models import ActiveStudyAttempt
from apps.focus.tests.test_managed_active_study import _payload
from apps.progress.models import LearningProgress
from apps.xp.models import XpTransaction

from ..availability import available_minutes
from ..models import StudyEvidence, StudyPlanItem
from ..services import plan_today
from . import test_foundation as fixtures
from .test_api import authenticated_client
from .test_apply_preview import apply, due
from .test_reading_preview import preview, setup_plan

curriculum = fixtures.curriculum
pytestmark = pytest.mark.django_db


def evidence(data, first=1, last=3, minutes=0, request_id=None, **changes):
    version = data["sheet"].published_version
    body = {
        "version_id": str(version.pk),
        "file_id": str(version.assets.get(role="primary").managed_file_id),
        "edition": "university",
        "page_start": first,
        "page_end": last,
        "minutes": minutes,
        "client_request_id": str(request_id or uuid4()),
        **changes,
    }
    return authenticated_client(data["user"]).post(
        f"/api/v1/study-plan/v2/exams/{data['period'].pk}/reading-progress",
        body,
        format="json",
    )


def configure_active(data):
    version = data["sheet"].published_version
    ActiveStudySettings.objects.create(
        sheet=data["sheet"], enabled=True, total_pdf_pages=12, source_version=version
    )
    plan = next(
        row
        for row in plan_payload(total_pdf_pages=12, excluded_start_pages=0, excluded_end_pages=0)[
            "difficulties"
        ]
        if row["difficulty"] == "medium"
    )
    ActiveStudyQuestionContent.objects.create(
        sheet=data["sheet"],
        source_version=version,
        difficulty="medium",
        payload=_payload(parts=plan["number_of_parts"]),
        plan_signature={
            "number_of_parts": plan["number_of_parts"],
            "page_ranges": plan["page_ranges"],
        },
        checkpoint_question_count=15 * plan["number_of_parts"],
        final_exam_question_count=50,
        created_by=data["admin"],
        updated_by=data["admin"],
    )
    asset = version.assets.get(role="primary")
    CatalogDocument.objects.create(
        version=version,
        managed_file=asset.managed_file,
        material_slug="d2-anatomy",
        sheet_slug="intro",
    )
    return plan


def test_day_specific_time_and_zero_day_override_are_authoritative(curriculum):
    profile = setup_plan(curriculum)
    today = plan_today(profile)
    client = authenticated_client(curriculum["user"])
    response = client.patch(
        "/api/v1/study-plan/profile",
        {
            "expected_revision": 1,
            "mode": "normal",
            "daily_minutes": 30,
            "session_minutes": 25,
            "weekdays": list(range(7)),
            "subjects": [],
            "timezone": "Africa/Tripoli",
            "weekly_minutes": {str(today.weekday()): 90},
            "date_minutes": {str(today): 0},
        },
        format="json",
    )
    assert response.status_code == 200, response.json()
    profile.refresh_from_db()
    assert available_minutes(profile, today) == 0
    assert preview(curriculum).json()["days"][0]["available_minutes"] == 0
    body = response.json() | {"expected_revision": 2, "weekly_minutes": {"7": 20}}
    for key in ("revision", "configured"):
        body.pop(key, None)
    assert client.patch("/api/v1/study-plan/profile", body, format="json").status_code == 400


def test_explicit_reading_coverage_is_scoped_and_retry_safe(curriculum):
    setup_plan(curriculum)
    sheet = curriculum["sheet"]
    LearningProgress.objects.create(
        user=curriculum["user"],
        learning_object=sheet,
        version=sheet.published_version,
        status="in_progress",
        completion_percent=50,
    )
    request_id = uuid4()
    first = evidence(curriculum, 1, 7, minutes=28, request_id=request_id)
    assert first.status_code == 200, first.json()
    assert evidence(curriculum, 1, 7, minutes=28, request_id=request_id).json() == first.json()
    assert evidence(curriculum, 1, 8, minutes=28, request_id=request_id).status_code == 409
    assert StudyEvidence.objects.count() == 1 and XpTransaction.objects.count() == 0
    tasks = preview(curriculum).json()["assignments"]
    assert [(task["page_start"], task["page_end"]) for task in tasks] == [(8, 12)]
    assert evidence(curriculum, 1, 13).status_code == 400
    assert evidence(curriculum, 1, 3, file_id=str(uuid4())).status_code == 400
    stranger = create_user(email="stranger@example.test", with_trial=True)
    path = f"/api/v1/study-plan/v2/exams/{curriculum['period'].pk}/reading-progress"
    assert authenticated_client(stranger).post(path, {}, format="json").status_code == 404


def test_partial_task_keeps_revision_consumed_time_and_remaining_pages(curriculum):
    profile = setup_plan(curriculum)
    value = preview(curriculum).json()
    assert apply(curriculum, value).status_code == 200
    task = StudyPlanItem.objects.get(page_start=1)
    body = {"client_request_id": str(uuid4()), "expected_revision": 1, "page_end": 2, "minutes": 15}
    client = authenticated_client(curriculum["user"])
    path = f"/api/v1/study-plan/items/{task.pk}/progress"
    first = client.post(path, body, format="json")
    assert first.status_code == 200, first.json()
    assert client.post(path, body, format="json").json() == first.json()
    task.refresh_from_db()
    assert task.status == "planned" and task.completed_page_end == 2 and task.revision == 2
    assert (
        client.post(path, body | {"client_request_id": str(uuid4())}, format="json").status_code
        == 409
    )
    # 15 recorded + 15 estimated remaining, with no invented extra capacity.
    value = preview(curriculum).json()
    assert value["days"][0]["existing_minutes"] == 30
    assert StudyEvidence.objects.count() == 1
    today = plan_today(profile)
    payload = client.get(f"/api/v1/study-plan?from={today}&to={today}").json()["results"][0]
    assert payload["completed_page_end"] == 2
    assert (
        client.get(f"/api/v1/study-plan?from={today}&to={today}").json()["day_loads"][str(today)][
            "planned"
        ]
        == 30
    )


def test_replan_archives_only_movable_work_and_preserves_pins_completed_and_receipts(curriculum):
    profile = setup_plan(curriculum)
    value = preview(curriculum).json()
    assert apply(curriculum, value).status_code == 200
    tasks = list(StudyPlanItem.objects.order_by("page_start"))
    tasks[0].status = "completed"
    tasks[0].completed_at = timezone.now()
    tasks[0].save()
    tasks[1].pinned = True
    tasks[1].save()
    tasks[2].scheduled_date = plan_today(profile) - timedelta(days=1)
    tasks[2].save()
    value = preview(curriculum, replan=True).json()
    assert value["replace_item_ids"] == [str(tasks[2].pk)]
    request_id = uuid4()
    saved = apply(curriculum, value, request_id, replan=True)
    assert saved.status_code == 200, saved.json()
    assert saved.json()["replaced_count"] == 1
    tasks[0].refresh_from_db()
    tasks[1].refresh_from_db()
    tasks[2].refresh_from_db()
    assert tasks[0].status == "completed" and tasks[1].pinned
    assert tasks[2].status == "superseded" and tasks[2].planning_key is None
    assert apply(curriculum, value, request_id, replan=True).json() == saved.json()
    assert StudyPlanItem.objects.filter(status="planned", page_start=11).count() == 1


def test_reviews_cannot_monopolize_reading_and_future_reviews_stay_after_due_date(curriculum):
    profile = setup_plan(curriculum)
    for index in range(12):
        item = due(curriculum) if index == 0 else None
        if item:
            original = item
        else:
            original.pk = uuid4()
            original.canonical_key = (
                f"active-study:{curriculum['sheet'].pk}:easy:bank:1:page:1:{index + 1}"
            )
            original.save(force_insert=True)
    curriculum["period"].starts_on = plan_today(profile) + timedelta(days=2)
    curriculum["period"].save()
    value = preview(curriculum, include_reviews=True).json()
    assert value["scheduled_reading_minutes"] >= 25
    assert value["scheduled_review_minutes"] > 0
    assert all(day["allocated_minutes"] <= day["available_minutes"] for day in value["days"])
    original.next_review_at = timezone.now() + timedelta(days=1)
    original.save()
    later = preview(curriculum, include_reviews=True).json()
    for task in later["assignments"]:
        if task.get("review_item_id") == str(original.pk):
            assert task["scheduled_date"] >= str(plan_today(profile) + timedelta(days=1))


def test_reading_time_calibrates_from_explicit_samples_without_claiming_mastery(curriculum):
    setup_plan(curriculum)
    for first in (1, 3, 5):
        assert evidence(curriculum, first, first + 1, minutes=4).status_code == 200
    value = preview(curriculum).json()
    estimate = value["subject_estimates"][str(curriculum["subject"].pk)]
    assert estimate["minutes_per_page"] == 2 and estimate["sample_count"] == 3
    assert estimate["source"] == "self_reported_samples" and estimate["confidence"] == "low"
    assert value["required_reading_minutes"] == 12


def test_active_study_tasks_follow_reading_and_only_exact_version_results_complete_them(curriculum):
    profile = setup_plan(curriculum)
    configure_active(curriculum)
    profile.daily_minutes = 120
    profile.save()
    value = preview(curriculum, include_active_study=True).json()
    assert value["required_active_study_minutes"] > 0
    assert any(task["activity"] == "active_study" for task in value["assignments"])
    saved = apply(curriculum, value, include_active_study=True)
    assert saved.status_code == 200, saved.json()
    target = StudyPlanItem.objects.filter(activity="active_study").order_by("page_start").first()
    run, _ = start(user=curriculum["user"], sheet_id=curriculum["sheet"].pk, difficulty="medium")
    assert run.planning_source["study_source_version"] == str(
        curriculum["sheet"].published_version_id
    )
    complete_part_reading(user=curriculum["user"], run_id=run.pk)
    quiz = questions(user=curriculum["user"], run_id=run.pk)
    submit(
        user=curriculum["user"],
        run_id=run.pk,
        attempt_id=quiz["attempt_id"],
        answers=[{"position": q["position"], "selected_answer": "B"} for q in quiz["questions"]],
    )
    attempt = ActiveStudyAttempt.objects.get(run=run)
    assert attempt.source_evidence["study_source_file"] == str(target.source_file_id)
    today = plan_today(profile)
    response = authenticated_client(curriculum["user"]).get(
        f"/api/v1/study-plan?from={today}&to={today}"
    )
    assert response.status_code == 200
    target.refresh_from_db()
    assert target.status == "completed"


def test_progress_invalidates_preview_and_superseded_tasks_cannot_receive_new_reports(curriculum):
    setup_plan(curriculum)
    value = preview(curriculum).json()
    assert evidence(curriculum, 1, 2).status_code == 200
    assert apply(curriculum, value).status_code == 409
    value = preview(curriculum).json()
    assert apply(curriculum, value).status_code == 200
    task = StudyPlanItem.objects.order_by("scheduled_date", "page_start").first()
    task.status = "superseded"
    task.planning_key = None
    task.save()
    response = authenticated_client(curriculum["user"]).post(
        f"/api/v1/study-plan/items/{task.pk}/progress",
        {
            "client_request_id": str(uuid4()),
            "expected_revision": task.revision,
            "page_end": task.page_end,
        },
        format="json",
    )
    assert response.status_code == 409


def test_plan_reminder_obeys_pilot_and_cohort_boundaries(curriculum, settings):
    from ..reminders import daily_plan_briefing

    profile = setup_plan(curriculum)
    value = preview(curriculum).json()
    assert apply(curriculum, value).status_code == 200
    today = plan_today(profile)
    assert daily_plan_briefing(user=curriculum["user"], today=today)["minutes"] > 0
    settings.STUDY_PLAN_V2_USER_IDS = [str(uuid4())]
    assert daily_plan_briefing(user=curriculum["user"], today=today) is None
    settings.STUDY_PLAN_V2_USER_IDS = []
    curriculum["user"].cohort = None
    assert daily_plan_briefing(user=curriculum["user"], today=today) is None


def test_scoring_evidence_cannot_cross_file_or_bank_revision(curriculum):
    from apps.focus.planning import scoring_anchor

    from ..task_progress import reconcile_review_tasks

    setup_plan(curriculum)
    configure_active(curriculum)
    value = preview(curriculum, include_active_study=True).json()
    assert apply(curriculum, value, include_active_study=True).status_code == 200
    task = StudyPlanItem.objects.filter(activity="active_study").order_by("page_start").first()
    run, _ = start(user=curriculum["user"], sheet_id=curriculum["sheet"].pk, difficulty="medium")
    attempt = ActiveStudyAttempt.objects.create(
        run=run,
        kind="checkpoint",
        part_number=1,
        number=1,
        total=15,
        score=15,
        passed=True,
        submitted_at=timezone.now(),
    )
    attempt.source_evidence = scoring_anchor(run, attempt) | {"study_source_file": str(uuid4())}
    attempt.save()
    reconcile_review_tasks(curriculum["user"])
    task.refresh_from_db()
    assert task.status == "planned"
    attempt.source_evidence = scoring_anchor(run, attempt) | {"bank_revision": 999}
    attempt.save()
    reconcile_review_tasks(curriculum["user"])
    task.refresh_from_db()
    assert task.status == "planned"
