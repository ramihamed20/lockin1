from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.accounts.models import User
from apps.focus.events import FocusSessionCompleted, FocusSessionStarted
from apps.focus.models import FocusSession, FocusSessionActivity
from apps.focus.selectors import get_focus_summary
from apps.focus.services import complete_focus_session, start_focus_session
from platform_core.events import DomainEvent, domain_events


@pytest.mark.django_db(transaction=True)
def test_focus_session_lifecycle_emits_events_and_builds_history() -> None:
    user = User.objects.create_user("student@example.com", "Student")
    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(DomainEvent, received.append)
    try:
        session = start_focus_session(user=user, planned_duration_seconds=1500)
        completed = complete_focus_session(
            session_id=session.id,
            active_duration_seconds=1420,
            completed_at=session.started_at + timedelta(seconds=1500),
        )
    finally:
        unsubscribe()

    assert completed.status == FocusSession.Status.COMPLETED
    assert completed.active_duration_seconds == 1420
    assert list(completed.timeline.values_list("activity_type", flat=True)) == [
        FocusSessionActivity.ActivityType.STARTED,
        FocusSessionActivity.ActivityType.COMPLETED,
    ]
    assert any(isinstance(event, FocusSessionStarted) for event in received)
    assert any(isinstance(event, FocusSessionCompleted) for event in received)


@pytest.mark.django_db(transaction=True)
def test_completing_an_already_completed_session_is_idempotent() -> None:
    user = User.objects.create_user("student@example.com", "Student")
    session = start_focus_session(user=user)
    complete_focus_session(session_id=session.id, active_duration_seconds=60)

    completed_again = complete_focus_session(session_id=session.id, active_duration_seconds=99)

    assert completed_again.active_duration_seconds == 60
    assert completed_again.timeline.count() == 2


@pytest.mark.django_db
def test_focus_summary_uses_completed_authoritative_sessions_only() -> None:
    user = User.objects.create_user("student@example.com", "Student")
    first = start_focus_session(user=user)
    second = start_focus_session(user=user)
    start_focus_session(user=user)
    complete_focus_session(session_id=first.id, active_duration_seconds=100)
    complete_focus_session(session_id=second.id, active_duration_seconds=200)

    summary = get_focus_summary(user_id=user.id)

    assert summary.completed_sessions == 2
    assert summary.active_seconds == 300
    assert summary.last_completed_at is not None


@pytest.mark.django_db
def test_study_context_requires_reference() -> None:
    user = User.objects.create_user("student@example.com", "Student")

    with pytest.raises(ValidationError):
        start_focus_session(user=user, context_type=FocusSession.ContextType.STUDY)


@pytest.mark.django_db
def test_completion_time_must_follow_start() -> None:
    user = User.objects.create_user("student@example.com", "Student")
    session = start_focus_session(user=user)

    with pytest.raises(ValueError):
        complete_focus_session(
            session_id=session.id,
            active_duration_seconds=10,
            completed_at=timezone.now() - timedelta(days=1),
        )
