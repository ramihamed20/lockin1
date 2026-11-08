from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.entitlements.models import EntitlementGrant
from apps.progress.models import LearningProgress
from apps.subscriptions.models import Subscription

from ..exam_models import ExamSchedule
from ..models import StudyPlanItem, StudyPlanProfile
from ..services import plan_today
from . import test_foundation as fixtures
from .test_api import authenticated_client

curriculum = fixtures.curriculum

pytestmark = pytest.mark.django_db


def setup_plan(data, pages=12):
    profile = StudyPlanProfile.objects.create(
        user=data["user"],
        mode="normal",
        daily_minutes=30,
        session_minutes=25,
        weekdays=list(range(7)),
    )
    version = data["sheet"].published_version
    asset = version.assets.get(role="primary")
    asset.managed_file.pdf_page_count = pages
    asset.managed_file.save()
    return profile


def path(data):
    return f"/api/v1/study-plan/v2/exams/{data['period'].pk}/reading-preview"


def preview(data, **body):
    return authenticated_client(data["user"]).post(path(data), body, format="json")


def test_preview_uses_published_pages_and_retains_existing_time_without_writes(curriculum):
    profile = setup_plan(curriculum)
    today = plan_today(profile)
    item = StudyPlanItem.objects.create(
        user=curriculum["user"],
        title="Fixed",
        scheduled_date=today,
        duration_minutes=20,
        status="completed",
        completed_at=timezone.now(),
    )
    response = preview(curriculum)
    assert response.status_code == 200, response.json()
    result = response.json()
    assert result["kind"] == "reading_only_preview" and result["persisted"] is False
    assert result["required_reading_minutes"] == 60
    assert result["days"][0]["existing_minutes"] == 20
    # The last, shorter page unit cannot leapfrog prerequisite pages on day one.
    assert result["days"][0]["allocated_minutes"] == 0
    assert [(a["page_start"], a["page_end"]) for a in result["assignments"]] == [
        (1, 5),
        (6, 10),
        (11, 12),
    ]
    assert result["coverage_complete"] is True
    assert StudyPlanItem.objects.filter(user=curriculum["user"]).count() == 1
    item.refresh_from_db()
    assert item.status == "completed" and item.revision == 1
    assert result == preview(curriculum).json() | {"computed_at": result["computed_at"]}


def test_subject_exam_deadline_is_used_instead_of_period_start(curriculum):
    profile = setup_plan(curriculum, pages=12)
    period = curriculum["period"]
    period.starts_on = plan_today(profile) + timedelta(days=1)
    period.save()
    ExamSchedule.objects.create(
        period=period,
        subject=curriculum["subject"],
        scheduled_on=period.starts_on + timedelta(days=6),
    )
    result = preview(curriculum).json()
    assert result["unscheduled"] == []
    assert all(a["deadline_source"] == "subject_schedule" for a in result["assignments"])
    assert all(
        a["scheduled_date"] < str(period.starts_on + timedelta(days=6))
        for a in result["assignments"]
    )


def test_shortfall_is_reported_and_exam_day_is_excluded(curriculum):
    profile = setup_plan(curriculum)
    period = curriculum["period"]
    period.starts_on = plan_today(profile) + timedelta(days=1)
    period.save()
    result = preview(curriculum).json()
    assert len(result["days"]) == 1
    assert result["scheduled_reading_minutes"] == 25
    assert sum(a["estimated_minutes"] for a in result["unscheduled"]) == 35
    assert result["planner_ready"] is False


def test_partial_progress_needs_coverage_and_reader_position_is_not_completion(curriculum):
    setup_plan(curriculum)
    sheet = curriculum["sheet"]
    LearningProgress.objects.create(
        user=curriculum["user"],
        learning_object=sheet,
        version=sheet.published_version,
        status="in_progress",
        completion_percent=50,
        position={"page": 6},
    )
    result = preview(curriculum).json()
    assert result["coverage_complete"] is False
    assert result["issues"][0]["reason"] == "partial_reading_needs_confirmation"
    assert result["assignments"] == []


def test_current_version_completed_reading_is_not_scheduled_again(curriculum):
    setup_plan(curriculum)
    sheet = curriculum["sheet"]
    LearningProgress.objects.create(
        user=curriculum["user"],
        learning_object=sheet,
        version=sheet.published_version,
        status="completed",
        completion_percent=100,
        completed_at=timezone.now(),
    )
    result = preview(curriculum).json()
    assert result["completed_reading_sheets"] == 1
    assert result["required_reading_minutes"] == 0
    assert result["assignments"] == []


def test_unknown_pages_and_missing_edition_are_explicit(curriculum):
    setup_plan(curriculum, pages=None)
    version = curriculum["sheet"].published_version
    version.page_count = None
    version.save()
    result = preview(curriculum).json()
    assert result["coverage_complete"] is False
    assert result["issues"][0]["reason"] == "page_count_unknown"
    missing = preview(curriculum, edition="lockin").json()
    assert missing["issues"][0]["reason"] == "edition_unavailable"


def test_publication_change_is_reflected_without_destroying_tasks(curriculum):
    setup_plan(curriculum)
    before = preview(curriculum).json()
    published_pdf(actor=curriculum["admin"], node=curriculum["lesson"], title="New sheet")
    after = preview(curriculum).json()
    assert after["syllabus_fingerprint"] != before["syllabus_fingerprint"]
    assert not StudyPlanItem.objects.filter(user=curriculum["user"]).exists()


def test_feature_flag_pilot_and_cohort_remain_server_authoritative(curriculum, settings):
    setup_plan(curriculum)
    settings.STUDY_PLAN_V2_ENABLED = False
    assert preview(curriculum).status_code == 403
    settings.STUDY_PLAN_V2_ENABLED = True
    settings.STUDY_PLAN_V2_USER_IDS = [str(uuid4())]
    assert preview(curriculum).status_code == 403
    settings.STUDY_PLAN_V2_USER_IDS = []
    other = create_user(email="no-cohort@example.test", with_trial=True)
    assert authenticated_client(other).post(path(curriculum), {}, format="json").status_code == 404
    assert APIClient().post(path(curriculum), {}, format="json").status_code == 403


def test_unconfigured_profiles_and_invalid_input_do_not_guess_availability(curriculum):
    assert preview(curriculum).status_code == 400
    setup_plan(curriculum)
    assert preview(curriculum, edition="unknown").status_code == 400
    assert preview(curriculum, daily_minutes=480).status_code == 400


def test_expired_subscription_is_denied_even_when_pilot_enabled(curriculum):
    setup_plan(curriculum)
    user = create_user(
        email="expired-planner@example.test", cohort=curriculum["user"].cohort, with_trial=True
    )
    Subscription.objects.filter(account__primary_user=user).update(status="expired")
    EntitlementGrant.objects.filter(user=user).update(status="expired")
    assert authenticated_client(user).post(path(curriculum), {}, format="json").status_code == 403


def test_session_post_requires_csrf(curriculum):
    setup_plan(curriculum)
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(curriculum["user"])
    assert client.post(path(curriculum), {}, format="json").status_code == 403


def test_non_normal_modes_do_not_use_a_fictional_daily_budget(curriculum):
    profile = setup_plan(curriculum)
    for mode in ("beginning", "custom"):
        profile.mode = mode
        profile.save()
        assert preview(curriculum).status_code == 400


def test_other_subject_exam_days_are_not_treated_as_full_study_days(curriculum):
    profile = setup_plan(curriculum, pages=20)
    period = curriculum["period"]
    period.starts_on = plan_today(profile) + timedelta(days=1)
    period.save()
    ExamSchedule.objects.create(
        period=period,
        subject=curriculum["subject"],
        exam_type="practical",
        scheduled_on=period.starts_on,
    )
    ExamSchedule.objects.create(
        period=period,
        subject=curriculum["subject"],
        exam_type="theory",
        scheduled_on=period.starts_on + timedelta(days=7),
    )
    # The earliest subject exam controls preparation. Later spare time cannot
    # make its workload appear complete, and the exam date itself has zero time.
    result = preview(curriculum).json()
    assert result["days"][1]["date"] == str(period.starts_on)
    assert result["days"][1]["available_minutes"] == 0
    assert all(a["scheduled_date"] < str(period.starts_on) for a in result["assignments"])
    assert result["unscheduled"]
