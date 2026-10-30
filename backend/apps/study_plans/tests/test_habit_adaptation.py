from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.focus.models import FocusSession

from ..adaptive_habits import adaptive_capacity, difficulty_multiplier, habit_snapshot
from ..models import StudySheetDifficulty
from ..services import plan_today
from . import test_foundation as fixtures
from .test_reading_preview import preview, setup_plan


curriculum = fixtures.curriculum
pytestmark = pytest.mark.django_db


def test_starting_assessment_grows_slowly_without_claiming_measured_activity(curriculum):
    profile = setup_plan(curriculum)
    profile.daily_minutes = 240
    profile.habit_baseline_minutes = 60
    profile.study_rhythm = "fragmented"
    profile.habit_block_minutes = 40
    profile.save()
    today = plan_today(profile)
    habit = habit_snapshot(user=curriculum["user"], profile=profile, today=today)
    assert habit["source"] == "self_reported"
    assert habit["baseline_minutes"] == 60
    assert habit["suggested_block_minutes"] == 20
    assert 60 <= adaptive_capacity(profile, today, today, habit) <= 65
    assert adaptive_capacity(profile, today + timedelta(days=21), today, habit) <= 65
    profile.date_minutes = {str(today): 0}
    assert adaptive_capacity(profile, today, today, habit) == 0


def test_completed_focus_session_history_calibrates_without_inventing_attention(curriculum):
    profile = setup_plan(curriculum)
    today = plan_today(profile)
    zone = ZoneInfo(profile.timezone)
    for delta, minutes in [(1, 30), (2, 60), (3, 90)]:
        at = datetime.combine(today - timedelta(days=delta), time(12), tzinfo=zone)
        FocusSession.objects.create(
            user=curriculum["user"], status="completed", started_at=at,
            ended_at=at + timedelta(minutes=minutes),
            active_duration_seconds=minutes * 60,
        )
    habit = habit_snapshot(user=curriculum["user"], profile=profile, today=today)
    assert habit["source"] == "recorded"
    assert habit["baseline_minutes"] == 60
    assert habit["sample_days"] == 3


def test_sheet_rating_changes_workload_but_does_not_claim_mastery(curriculum):
    setup_plan(curriculum)
    first = preview(curriculum).json()
    assert first["required_reading_minutes"] == 60
    assert first["habit"]["baseline_minutes"] is None
    StudySheetDifficulty.objects.create(sheet=curriculum["sheet"], level=5)
    second = preview(curriculum).json()
    assert second["required_reading_minutes"] > first["required_reading_minutes"]
    assert second["assignments"][0]["difficulty_level"] == 5
    assert second["habit"]["estimate_scope"] == "reading_active_review_only"
    assert difficulty_multiplier(0) == 1.0
