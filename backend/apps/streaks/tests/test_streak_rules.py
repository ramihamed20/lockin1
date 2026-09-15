"""What the streak counts, and what the reader is shown.

The streak is a count of days, not of activities: two study sessions in one
evening are one day, a day missed ends the run, and the number on the dashboard
is the number the server holds. These are the rules a reader checks their own
streak against, so each one is pinned here.
"""

from datetime import timedelta
from typing import Any
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.focus.events import FocusSessionCompleted
from apps.progress.events import LessonCompleted
from apps.streaks.models import StreakActivity, UserStreak
from apps.streaks.services import record_activity
from platform_core.events import domain_events

pytestmark = pytest.mark.django_db


def _record(user, *, source: str, days_ago: int = 0, activity: str = "lesson.completed"):
    return record_activity(
        user_id=user.id,
        source_key=source,
        activity_type=activity,
        source_object_id=uuid4(),
        occurred_at=timezone.now() - timedelta(days=days_ago),
    )


def test_a_second_activity_on_the_same_day_does_not_add_a_day() -> None:
    user = create_user()

    _record(user, source="lesson:morning")
    state, created = _record(user, source="assessment:evening", activity="assessment.passed")

    assert created is True
    assert state.current_days == 1
    assert StreakActivity.objects.filter(user=user).count() == 2


def test_the_same_activity_reported_twice_is_counted_once() -> None:
    """Events can be redelivered; the evidence is keyed by its source."""

    user = create_user()

    first, created = _record(user, source="lesson:same")
    repeated, repeated_created = _record(user, source="lesson:same")

    assert created is True
    assert repeated_created is False
    assert repeated.current_days == first.current_days == 1
    assert StreakActivity.objects.filter(user=user).count() == 1


def test_consecutive_days_count_up_and_a_missed_day_ends_the_run() -> None:
    user = create_user()

    for days_ago in (2, 1, 0):
        _record(user, source=f"lesson:{days_ago}", days_ago=days_ago)
    unbroken = UserStreak.objects.get(user=user)

    broken_user = create_user(email="broken@example.com", username="broken")
    _record(broken_user, source="lesson:old", days_ago=5)
    _record(broken_user, source="lesson:older", days_ago=4)
    broken = UserStreak.objects.get(user=broken_user)

    assert unbroken.current_days == 3
    assert unbroken.longest_days == 3
    # The run is over, but the best run it reached is still on record.
    assert broken.current_days == 0
    assert broken.longest_days == 2


def test_yesterday_still_counts_because_today_is_not_over() -> None:
    user = create_user()

    _record(user, source="lesson:yesterday", days_ago=1)

    assert UserStreak.objects.get(user=user).current_days == 1


def test_the_number_shown_is_the_number_the_server_holds() -> None:
    """Dashboard, Profile and Progress all read this one endpoint."""

    user = create_user()
    for days_ago in (1, 0):
        _record(user, source=f"lesson:{days_ago}", days_ago=days_ago)
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/progression/streak")

    state = UserStreak.objects.get(user=user)
    assert response.status_code == 200
    body = response.json()
    assert body["current_days"] == state.current_days == 2
    assert body["longest_days"] == state.longest_days == 2
    assert body["last_qualified_on"] == state.last_qualified_on.isoformat()


def test_a_stale_run_reads_as_zero_even_before_the_next_activity(settings: Any) -> None:
    """Nothing runs at midnight to end a streak, so the read has to end it.

    Without this the dashboard kept showing the last number the run reached --
    a streak that ended on Tuesday still reading "5" on Friday.
    """

    user = create_user()
    _record(user, source="lesson:stale", days_ago=6)
    client = APIClient()
    client.force_authenticate(user=user)

    body = client.get("/api/v1/progression/streak").json()

    assert body["current_days"] == 0
    assert body["longest_days"] == 1


def test_real_study_activity_moves_the_streak_and_a_short_session_does_not(
    django_capture_on_commit_callbacks: Any,
) -> None:
    """The streak follows the events the product already publishes."""

    user = create_user()

    with django_capture_on_commit_callbacks(execute=True):
        domain_events.publish(
            FocusSessionCompleted(
                user_id=user.id,
                session_id=uuid4(),
                context_type="sheet",
                context_id=uuid4(),
                active_duration_seconds=600,
            )
        )
    assert UserStreak.objects.filter(user=user).exists() is False

    with django_capture_on_commit_callbacks(execute=True):
        domain_events.publish(
            FocusSessionCompleted(
                user_id=user.id,
                session_id=uuid4(),
                context_type="sheet",
                context_id=uuid4(),
                active_duration_seconds=1_500,
            )
        )
        domain_events.publish(LessonCompleted(user_id=user.id, lesson_id=uuid4()))

    # A deep session and a lesson on the same day: one day, not two.
    assert UserStreak.objects.get(user=user).current_days == 1
