"""Per-session, self-reported page goals. Never award XP or ranking credit."""

from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User

from .models import FocusSession, FocusSessionParticipant, FocusTeamMembership
from .services import FocusSessionStateError


class TeamGoalConflict(FocusSessionStateError):
    pass


@transaction.atomic
def save_team_goal(
    *,
    user: User,
    session_id: UUID,
    goal_pages: int | None,
    completed_pages: int,
    expected_revision: int,
) -> None:
    session = FocusSession.objects.select_for_update().get(id=session_id)
    if (
        not session.lock_in_live
        or session.team_id is None
        or session.status != FocusSession.Status.ACTIVE
        or (session.deadline_at is not None and session.deadline_at <= timezone.now())
    ):
        raise FocusSessionStateError("This team Lockin is not active.")
    if not FocusTeamMembership.objects.filter(team_id=session.team_id, user=user).exists():
        raise FocusSessionStateError("This team is not available.")
    try:
        participant = FocusSessionParticipant.objects.select_for_update().get(
            session=session,
            user=user,
            left_at__isnull=True,
        )
    except FocusSessionParticipant.DoesNotExist as error:
        raise FocusSessionStateError("Join this Lockin to update your goal.") from error
    if goal_pages is not None and not 1 <= goal_pages <= 10_000:
        raise FocusSessionStateError("Choose a valid page goal.")
    if not 0 <= completed_pages <= (goal_pages or 0):
        raise FocusSessionStateError("Progress exceeds the goal.")
    # An identical retry is safe even if its first confirmation was lost.
    if participant.goal_pages == goal_pages and participant.completed_pages == completed_pages:
        return
    if participant.goal_revision != expected_revision:
        raise TeamGoalConflict("Your goal changed. Refresh before saving again.")
    participant.goal_pages = goal_pages
    participant.completed_pages = completed_pages
    participant.goal_revision += 1
    participant.save(update_fields=("goal_pages", "completed_pages", "goal_revision"))
    # Existing live response ordering also protects goals from stale heartbeats.
    session.revision += 1
    session.save(update_fields=("revision",))
