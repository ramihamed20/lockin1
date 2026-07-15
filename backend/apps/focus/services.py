from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.accounts.models import User
from platform_core.events import publish_after_commit

from .events import FocusSessionCompleted, FocusSessionStarted
from .models import FocusSession, FocusSessionActivity


class FocusSessionStateError(ValueError):
    pass


@transaction.atomic
def start_focus_session(
    *,
    user: User,
    planned_duration_seconds: int | None = None,
    context_type: str = FocusSession.ContextType.INDEPENDENT,
    context_id: UUID | None = None,
) -> FocusSession:
    session = FocusSession(
        user=user,
        planned_duration_seconds=planned_duration_seconds,
        context_type=context_type,
        context_id=context_id,
    )
    session.full_clean()
    session.save()
    FocusSessionActivity.objects.create(
        session=session,
        sequence=1,
        activity_type=FocusSessionActivity.ActivityType.STARTED,
        occurred_at=session.started_at,
    )
    publish_after_commit(
        FocusSessionStarted(
            session_id=session.id,
            user_id=user.id,
            context_type=session.context_type,
            context_id=session.context_id,
            actor_id=user.id,
        )
    )
    return session


@transaction.atomic
def complete_focus_session(
    *,
    session_id: UUID,
    active_duration_seconds: int,
    completed_at: datetime | None = None,
) -> FocusSession:
    if active_duration_seconds < 0:
        raise ValueError("active_duration_seconds cannot be negative.")

    session = FocusSession.objects.select_for_update().get(id=session_id)
    if session.status == FocusSession.Status.COMPLETED:
        return session
    if session.status == FocusSession.Status.ABANDONED:
        raise FocusSessionStateError("An abandoned focus session cannot be completed.")

    finished_at = completed_at or timezone.now()
    if finished_at < session.started_at:
        raise ValueError("completed_at cannot be earlier than started_at.")

    session.status = FocusSession.Status.COMPLETED
    session.ended_at = finished_at
    session.active_duration_seconds = active_duration_seconds
    session.full_clean()
    session.save(update_fields=("status", "ended_at", "active_duration_seconds", "updated_at"))
    last_sequence = session.timeline.aggregate(last=Max("sequence"))["last"] or 0
    next_sequence = int(last_sequence) + 1
    FocusSessionActivity.objects.create(
        session=session,
        sequence=next_sequence,
        activity_type=FocusSessionActivity.ActivityType.COMPLETED,
        occurred_at=finished_at,
        metadata={"active_duration_seconds": active_duration_seconds},
    )
    publish_after_commit(
        FocusSessionCompleted(
            session_id=session.id,
            user_id=session.user_id,
            context_type=session.context_type,
            context_id=session.context_id,
            active_duration_seconds=active_duration_seconds,
            actor_id=session.user_id,
        )
    )
    return session
