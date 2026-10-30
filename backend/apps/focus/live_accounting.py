"""Versioned participation accounting. V1 rows are never retroactively rewarded.

Connection intervals are evidence of a running client, not proof of attention.
Every writer holds the session row lock; intervals from two devices therefore
form one union, and a stale client can never extend an ended session.
"""

from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from platform_core.events import publish_after_commit

from .events import FocusSessionCompleted
from .models import FocusSession, FocusSessionParticipant

HEARTBEAT_GRACE_SECONDS = 75


def participant_microseconds(participant: FocusSessionParticipant, until: datetime) -> int:
    end = min(until, participant.last_seen_at + timedelta(seconds=HEARTBEAT_GRACE_SECONDS))
    if participant.session.ended_at:
        end = min(end, participant.session.ended_at)
    if participant.session.deadline_at:
        end = min(end, participant.session.deadline_at)
    pending = (
        max(0, (end - participant.active_since) // timedelta(microseconds=1))
        if participant.active_since
        else 0
    )
    return participant.active_microseconds + pending


def participant_seconds(participant: FocusSessionParticipant, until: datetime) -> int:
    return participant_microseconds(participant, until) // 1_000_000


def settle_participant(participant: FocusSessionParticipant, until: datetime) -> None:
    participant.active_microseconds = participant_microseconds(participant, until)
    participant.active_since = None
    participant.save(update_fields=("active_microseconds", "active_since"))


def publish_participant_completions(session: FocusSession, ended_at: datetime) -> None:
    for participant in session.participants.select_for_update().select_related("session"):
        if participant.credited_at is not None:
            continue
        settle_participant(participant, ended_at)
        participant.credited_at = ended_at
        participant.save(update_fields=("credited_at",))
        seconds = participant.active_microseconds // 1_000_000
        if seconds:
            publish_after_commit(
                FocusSessionCompleted(
                    session_id=session.id,
                    user_id=participant.user_id,
                    context_type=session.context_type,
                    context_id=session.context_id,
                    active_duration_seconds=seconds,
                    occurred_at=ended_at,
                    actor_id=participant.user_id,
                )
            )


@transaction.atomic
def settle_expired_session(session: FocusSession) -> FocusSession:
    """Settle at the actual deadline, even if no browser was open at that time."""
    from .services import complete_focus_session, focus_session_durations

    if session.experience_version != 2 or not session.lock_in_live:
        return session
    # All mutations acquire team -> session. Do not invert this order on expiry.
    if session.team_id:
        from .models import FocusTeam

        FocusTeam.objects.select_for_update().get(id=session.team_id)
    locked = FocusSession.objects.select_for_update().get(id=session.id)
    if locked.status != FocusSession.Status.ACTIVE or not locked.planned_duration_seconds:
        return locked
    now = timezone.now()
    deadline = locked.deadline_at
    if deadline is None:
        elapsed, _ = focus_session_durations(session=locked, until=now)
        if elapsed < locked.planned_duration_seconds:
            return locked
        deadline = now - timedelta(seconds=elapsed - locked.planned_duration_seconds)
    if now < deadline:
        return locked
    return complete_focus_session(
        session_id=locked.id,
        active_duration_seconds=locked.planned_duration_seconds,
        completed_at=deadline,
        actor_id=locked.user_id,
    )
