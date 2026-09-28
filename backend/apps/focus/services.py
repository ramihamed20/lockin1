from datetime import datetime
from typing import cast
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.utils import timezone

from apps.accounts.models import User
from platform_core.events import publish_after_commit

from .domain_types import FocusDocumentReference
from .events import (
    FocusSessionAbandoned,
    FocusSessionCompleted,
    FocusSessionPaused,
    FocusSessionResumed,
    FocusSessionStarted,
)
from .models import (
    FocusSession,
    FocusSessionActivity,
    FocusSessionNote,
    FocusSessionParticipant,
    FocusSessionTask,
    FocusTeam,
    FocusTeamMembership,
    FocusTeamMessage,
    FocusWorkspaceSnapshot,
    focus_team_invite_code,
)


class FocusSessionStateError(ValueError):
    pass


UNFINISHED_STATUSES = (
    FocusSession.Status.ACTIVE,
    FocusSession.Status.PAUSED,
    FocusSession.Status.ON_BREAK,
)


def active_lock_in_session_for_user(*, user: User) -> FocusSession | None:
    owned = FocusSession.objects.filter(user=user, status__in=UNFINISHED_STATUSES).filter(
        Q(team__isnull=True) | Q(lock_in_live=False)
    )
    shared = FocusSession.objects.filter(
        participants__user=user,
        participants__left_at__isnull=True,
        status__in=UNFINISHED_STATUSES,
    )
    return (owned | shared).order_by("-started_at").first()


def active_team_lock_in_session(*, team: FocusTeam) -> FocusSession | None:
    return (
        FocusSession.objects.filter(team=team, lock_in_live=True, status__in=UNFINISHED_STATUSES)
        .order_by("-started_at")
        .first()
    )


def _finish_participant_break(participant: FocusSessionParticipant, now: datetime) -> None:
    if participant.break_started_at is not None:
        participant.break_seconds += max(
            0, int((now - participant.break_started_at).total_seconds())
        )
        participant.break_started_at = None


def _fresh_team_code(*, exclude_team_id: UUID | None = None) -> str:
    for _ in range(30):
        code = focus_team_invite_code()
        existing = FocusTeam.objects.filter(invite_code=code)
        if exclude_team_id is not None:
            existing = existing.exclude(id=exclude_team_id)
        if not existing.exists():
            return code
    raise FocusSessionStateError("A team code could not be generated. Try again.")


def create_focus_team(
    *, user: User, name: str, max_members: int = 8, anonymous: bool = False
) -> FocusTeam:
    for _ in range(5):
        try:
            with transaction.atomic():
                team = FocusTeam(
                    owner=user,
                    name=name.strip(),
                    max_members=max_members,
                    invite_code=_fresh_team_code(),
                )
                team.full_clean()
                team.save()
                FocusTeamMembership.objects.create(
                    team=team,
                    user=user,
                    role=FocusTeamMembership.Role.OWNER,
                    anonymous=anonymous,
                    anonymous_alias="Anonymous 01" if anonymous else "",
                )
                return team
        except IntegrityError:
            continue
    raise FocusSessionStateError("A team code could not be generated. Try again.")


@transaction.atomic
def join_focus_team(
    *, user: User, invite_code: str, anonymous: bool = False
) -> tuple[FocusTeam, bool]:
    try:
        team = FocusTeam.objects.select_for_update().get(invite_code=invite_code.strip().upper())
    except FocusTeam.DoesNotExist as error:
        raise FocusSessionStateError("That team invite code was not found.") from error
    if team.closed_at:
        raise FocusSessionStateError("This team has ended.")
    if FocusTeamMembership.objects.filter(team=team, user=user).exists():
        raise FocusSessionStateError("You are already in this team.")
    if team.joining_locked:
        raise FocusSessionStateError("Joining is locked.")
    members = list(FocusTeamMembership.objects.filter(team=team).only("anonymous_alias"))
    if len(members) >= team.max_members:
        raise FocusSessionStateError("This team is full.")
    aliases = {member.anonymous_alias for member in members}
    alias = ""
    if anonymous:
        next_number = 1
        while f"Anonymous {next_number:02d}" in aliases:
            next_number += 1
        alias = f"Anonymous {next_number:02d}"
    FocusTeamMembership.objects.create(
        team=team, user=user, anonymous=anonymous, anonymous_alias=alias
    )
    live_session = active_team_lock_in_session(team=team)
    if live_session is not None and active_lock_in_session_for_user(user=user) is None:
        FocusSessionParticipant.objects.create(
            session=live_session, user=user, presence=FocusSessionParticipant.Presence.AWAY
        )
    return team, True


@transaction.atomic
def manage_focus_team(
    *, user: User, team_id: UUID, action: str, data: dict[str, object]
) -> FocusTeam:
    team = FocusTeam.objects.select_for_update().get(id=team_id)
    membership = FocusTeamMembership.objects.filter(team=team, user=user).first()
    if membership is None:
        raise FocusSessionStateError("This team is not available.")
    if action == "leave":
        now = timezone.now()
        for participant in FocusSessionParticipant.objects.select_for_update().filter(
            session__team=team,
            session__status__in=UNFINISHED_STATUSES,
            user=user,
            left_at__isnull=True,
        ):
            _finish_participant_break(participant, now)
            participant.left_at = now
            participant.save(update_fields=("left_at", "break_seconds", "break_started_at"))
        if team.owner_id == user.id:
            successor = (
                FocusTeamMembership.objects.filter(team=team)
                .exclude(user=user)
                .order_by("joined_at", "id")
                .first()
            )
            if successor:
                team.owner = successor.user
                successor.role = FocusTeamMembership.Role.OWNER
                successor.save(update_fields=("role",))
                team.save(update_fields=("owner", "updated_at"))
            else:
                live_session = active_team_lock_in_session(team=team)
                if live_session is not None:
                    complete_live_lock_in_session(user=user, session_id=live_session.id)
                team.closed_at = timezone.now()
                team.save(update_fields=("closed_at", "updated_at"))
        membership.delete()
        return team
    if team.owner_id != user.id or team.closed_at:
        raise FocusSessionStateError("Only the host can manage this team.")
    if action == "update":
        if "name" in data:
            team.name = str(data["name"]).strip()
        if "max_members" in data:
            team.max_members = int(str(data["max_members"]))
            if team.max_members < FocusTeamMembership.objects.filter(team=team).count():
                raise FocusSessionStateError("Maximum members is below the current count.")
        if "joining_locked" in data:
            team.joining_locked = bool(data["joining_locked"])
        team.full_clean()
        team.save()
    elif action == "regenerate-code":
        for _ in range(5):
            team.invite_code = _fresh_team_code(exclude_team_id=team.id)
            try:
                with transaction.atomic():
                    team.save(update_fields=("invite_code", "updated_at"))
                break
            except IntegrityError:
                continue
        else:
            raise FocusSessionStateError("A team code could not be generated. Try again.")
    elif action in {"kick", "transfer-host"}:
        target = FocusTeamMembership.objects.filter(
            team=team, id=cast(UUID, data["member_id"])
        ).first()
        if target is None or target.user_id == user.id:
            raise FocusSessionStateError("Choose another current member.")
        if action == "kick":
            now = timezone.now()
            for participant in FocusSessionParticipant.objects.select_for_update().filter(
                session__team=team,
                session__status__in=UNFINISHED_STATUSES,
                user=target.user,
                left_at__isnull=True,
            ):
                _finish_participant_break(participant, now)
                participant.left_at = now
                participant.save(update_fields=("left_at", "break_seconds", "break_started_at"))
            target.delete()
        else:
            membership.role = FocusTeamMembership.Role.MEMBER
            membership.save(update_fields=("role",))
            target.role = FocusTeamMembership.Role.OWNER
            target.save(update_fields=("role",))
            team.owner = target.user
            team.save(update_fields=("owner", "updated_at"))
    elif action == "end":
        live_session = active_team_lock_in_session(team=team)
        if live_session is not None:
            complete_live_lock_in_session(user=user, session_id=live_session.id)
        team.closed_at = timezone.now()
        team.save(update_fields=("closed_at", "updated_at"))
    else:
        raise FocusSessionStateError("Unsupported team action.")
    return team


def focus_team_for_member(*, user: User, team_id: UUID) -> FocusTeam:
    try:
        return FocusTeam.objects.get(id=team_id, memberships__user=user)
    except FocusTeam.DoesNotExist as error:
        raise FocusSessionStateError("That study team is not available to this account.") from error


@transaction.atomic
def add_focus_team_message(*, user: User, team_id: UUID, body: str) -> FocusTeamMessage:
    team = focus_team_for_member(user=user, team_id=team_id)
    if team.closed_at:
        raise FocusSessionStateError("This team has ended.")
    membership = FocusTeamMembership.objects.get(team=team, user=user)
    message = FocusTeamMessage(
        team=team,
        author=user,
        body=body.strip(),
        author_alias=membership.anonymous_alias if membership.anonymous else "",
        author_membership_id=membership.id,
    )
    message.full_clean()
    message.save()
    team.updated_at = timezone.now()
    team.save(update_fields=("updated_at",))
    return message


@transaction.atomic
def start_focus_session(
    *,
    user: User,
    planned_duration_seconds: int | None = None,
    context_type: str = FocusSession.ContextType.INDEPENDENT,
    context_id: UUID | None = None,
    client_instance_id: UUID | None = None,
) -> FocusSession:
    session = FocusSession(
        user=user,
        planned_duration_seconds=planned_duration_seconds,
        context_type=context_type,
        context_id=context_id,
        client_instance_id=client_instance_id,
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


def _settle_open_reading_sessions(*, user: User) -> int:
    """Complete this reader's still-open study sessions, at their last activity.

    ``complete_owned_focus_session`` measures up to *now*, which is right for a
    session the reader is closing and wrong for one they walked away from: an
    overnight tab would otherwise be credited with eight hours of reading on
    the wrong day. Measuring up to ``last_activity_at`` keeps both the duration
    and the day honest.
    """

    stale = list(
        FocusSession.objects.filter(
            user=user,
            context_type=FocusSession.ContextType.STUDY,
            status__in=(
                FocusSession.Status.ACTIVE,
                FocusSession.Status.PAUSED,
                FocusSession.Status.ON_BREAK,
            ),
        )
    )
    for session in stale:
        complete_focus_session(
            session_id=session.id,
            active_duration_seconds=_active_duration(
                session=session, until=session.last_activity_at
            ),
            completed_at=session.last_activity_at,
        )
    return len(stale)


def touch_reading_session(*, user: User, document_version_id: UUID) -> bool:
    """Record that this reader is still reading this document.

    The reader reports its state as the page, zoom or marks change, and those
    saves are the only continuous evidence of a reading sitting. Carrying them
    onto the session's ``last_activity_at`` is what lets an abandoned session be
    measured afterwards instead of discarded -- and it is a single UPDATE, so it
    adds nothing measurable to a save the reader already makes.
    """

    return (
        FocusSession.objects.filter(
            user=user,
            context_type=FocusSession.ContextType.STUDY,
            context_id=document_version_id,
            status=FocusSession.Status.ACTIVE,
        ).update(last_activity_at=timezone.now())
        > 0
    )


@transaction.atomic
def start_workspace_session(
    *,
    user: User,
    document: FocusDocumentReference,
    client_instance_id: UUID,
    planned_duration_seconds: int | None = None,
) -> tuple[FocusSession, FocusWorkspaceSnapshot, bool]:
    User.objects.select_for_update().get(id=user.id)
    existing = (
        FocusSession.objects.select_for_update()
        .filter(user=user, client_instance_id=client_instance_id)
        .first()
    )
    if existing is not None:
        if (
            existing.context_type != FocusSession.ContextType.STUDY
            or existing.context_id != document.document_version_id
        ):
            raise FocusSessionStateError(
                "The client session identifier was already used for another workspace."
            )
        return existing, existing.workspace, False

    # A reader who closed the tab left their last session open, and an open
    # session is never measured, so its study time was lost. Settling it here
    # is what makes the previous sitting count without a scheduler: the clamp
    # to its own last activity keeps an abandoned session from being credited
    # with the hours the tab sat idle.
    _settle_open_reading_sessions(user=user)

    previous = (
        FocusWorkspaceSnapshot.objects.filter(
            user=user,
            document_version_id=document.document_version_id,
        )
        .order_by("-updated_at")
        .first()
    )
    session = start_focus_session(
        user=user,
        planned_duration_seconds=planned_duration_seconds,
        context_type=FocusSession.ContextType.STUDY,
        context_id=document.document_version_id,
        client_instance_id=client_instance_id,
    )
    workspace = FocusWorkspaceSnapshot.objects.create(
        session=session,
        user=user,
        document_id=document.document_id,
        document_version_id=document.document_version_id,
        file_id=document.file_id,
        current_page=previous.current_page if previous is not None else 1,
        page_count=document.page_count or (previous.page_count if previous is not None else None),
        zoom=previous.zoom if previous is not None else 1,
        sidebar=previous.sidebar if previous is not None else FocusWorkspaceSnapshot.Sidebar.CLOSED,
        active_tool=previous.active_tool if previous is not None else "",
        layout=previous.layout if previous is not None else {},
        open_tabs=previous.open_tabs if previous is not None else [],
    )
    return session, workspace, True


@transaction.atomic
def start_lock_in_session(
    *,
    user: User,
    document: FocusDocumentReference | None,
    client_instance_id: UUID,
    planned_duration_seconds: int | None,
    break_duration_seconds: int | None,
    session_type: str,
    team: FocusTeam | None,
    team_name: str,
    anonymous: bool,
    goal: str,
    topic: str,
    note: str,
    tasks: tuple[tuple[UUID, str], ...],
) -> tuple[FocusSession, bool]:
    """Create one durable Lock In session, or return the user's unfinished one.

    Locking the user row serializes two tabs pressing Start at the same time.
    The client id makes retries of the same request idempotent as well.
    """
    members: list[FocusTeamMembership] = []
    if team is not None:
        team = FocusTeam.objects.select_for_update().get(id=team.id)
        if team.closed_at or team.owner_id != user.id:
            raise FocusSessionStateError("Only the host can start this team Lockin.")
        live_session = active_team_lock_in_session(team=team)
        if live_session is not None:
            return live_session, False
        members = list(FocusTeamMembership.objects.filter(team=team).order_by("joined_at", "id"))
        list(
            User.objects.select_for_update()
            .filter(id__in=[member.user_id for member in members])
            .order_by("id")
            .values_list("id", flat=True)
        )
        if any(active_lock_in_session_for_user(user=member.user) is not None for member in members):
            raise FocusSessionStateError("A member already has an active Lockin.")
    else:
        User.objects.select_for_update().get(id=user.id)
        shared = active_lock_in_session_for_user(user=user)
        if shared is not None and shared.user_id != user.id:
            return shared, False
    existing = (
        FocusSession.objects.select_for_update()
        .filter(
            user=user,
            status__in=(
                FocusSession.Status.ACTIVE,
                FocusSession.Status.PAUSED,
                FocusSession.Status.ON_BREAK,
            ),
        )
        .order_by("-last_activity_at")
        .first()
    )
    if existing is not None:
        return existing, False

    replay = (
        FocusSession.objects.select_for_update()
        .filter(user=user, client_instance_id=client_instance_id)
        .first()
    )
    if replay is not None:
        return replay, False

    context_type = (
        FocusSession.ContextType.STUDY
        if document is not None
        else FocusSession.ContextType.INDEPENDENT
    )
    session = start_focus_session(
        user=user,
        planned_duration_seconds=planned_duration_seconds,
        context_type=context_type,
        context_id=document.document_version_id if document is not None else None,
        client_instance_id=client_instance_id,
    )
    session.break_duration_seconds = break_duration_seconds
    session.session_type = session_type
    session.team = team
    session.team_name = team.name if team is not None else team_name.strip()
    session.anonymous = anonymous
    session.lock_in_live = document is None
    session.goal = goal.strip()
    session.topic = topic.strip()
    session.full_clean()
    session.save(
        update_fields=(
            "break_duration_seconds",
            "session_type",
            "team",
            "team_name",
            "anonymous",
            "lock_in_live",
            "goal",
            "topic",
            "updated_at",
        )
    )
    if team is not None and session.lock_in_live:
        FocusSessionParticipant.objects.bulk_create(
            [
                FocusSessionParticipant(
                    session=session,
                    user=member.user,
                    presence=(
                        FocusSessionParticipant.Presence.FOCUSED
                        if member.user_id == user.id
                        else FocusSessionParticipant.Presence.AWAY
                    ),
                )
                for member in members
            ]
        )
        team.updated_at = timezone.now()
        team.save(update_fields=("updated_at",))
    if document is not None:
        previous = (
            FocusWorkspaceSnapshot.objects.filter(
                user=user, document_version_id=document.document_version_id
            )
            .order_by("-updated_at")
            .first()
        )
        FocusWorkspaceSnapshot.objects.create(
            session=session,
            user=user,
            document_id=document.document_id,
            document_version_id=document.document_version_id,
            file_id=document.file_id,
            current_page=previous.current_page if previous is not None else 1,
            page_count=document.page_count
            or (previous.page_count if previous is not None else None),
            zoom=previous.zoom if previous is not None else 1,
            sidebar=previous.sidebar
            if previous is not None
            else FocusWorkspaceSnapshot.Sidebar.CLOSED,
            active_tool=previous.active_tool if previous is not None else "",
            layout=previous.layout if previous is not None else {},
            open_tabs=previous.open_tabs if previous is not None else [],
        )
    if note.strip():
        FocusSessionNote.objects.create(session=session, body=note.strip())
    for client_task_id, title in tasks:
        FocusSessionTask.objects.create(
            session=session, client_task_id=client_task_id, title=title.strip()
        )
    return session, True


def _append_activity(
    *,
    session: FocusSession,
    activity_type: str,
    occurred_at: datetime,
    metadata: dict[str, object] | None = None,
) -> None:
    last_sequence = session.timeline.aggregate(last=Max("sequence"))["last"] or 0
    FocusSessionActivity.objects.create(
        session=session,
        sequence=int(last_sequence) + 1,
        activity_type=activity_type,
        occurred_at=occurred_at,
        metadata=metadata or {},
    )


def _session_durations(*, session: FocusSession, until: datetime) -> tuple[int, int]:
    opened_at: datetime | None = None
    break_opened_at: datetime | None = None
    active_total = 0.0
    break_total = 0.0
    for activity in session.timeline.order_by("sequence"):
        if activity.activity_type in {
            FocusSessionActivity.ActivityType.STARTED,
            FocusSessionActivity.ActivityType.RESUMED,
            FocusSessionActivity.ActivityType.BREAK_ENDED,
        }:
            opened_at = activity.occurred_at
        elif activity.activity_type == FocusSessionActivity.ActivityType.BREAK_STARTED:
            if opened_at is not None:
                active_total += max(0.0, (activity.occurred_at - opened_at).total_seconds())
                opened_at = None
            break_opened_at = activity.occurred_at
        elif (
            activity.activity_type
            in {
                FocusSessionActivity.ActivityType.PAUSED,
                FocusSessionActivity.ActivityType.COMPLETED,
                FocusSessionActivity.ActivityType.ABANDONED,
            }
            and opened_at is not None
        ):
            active_total += max(0.0, (activity.occurred_at - opened_at).total_seconds())
            opened_at = None
        if (
            activity.activity_type
            in {
                FocusSessionActivity.ActivityType.BREAK_ENDED,
                FocusSessionActivity.ActivityType.COMPLETED,
                FocusSessionActivity.ActivityType.ABANDONED,
            }
            and break_opened_at is not None
        ):
            break_total += max(0.0, (activity.occurred_at - break_opened_at).total_seconds())
            break_opened_at = None
    if opened_at is not None:
        active_total += max(0.0, (until - opened_at).total_seconds())
    if break_opened_at is not None:
        break_total += max(0.0, (until - break_opened_at).total_seconds())
    return int(active_total), int(break_total)


def focus_session_durations(
    *, session: FocusSession, until: datetime | None = None
) -> tuple[int, int]:
    """Return server-derived active and break seconds without trusting clients."""
    if session.ended_at is not None:
        return session.active_duration_seconds, _session_durations(
            session=session, until=session.ended_at
        )[1]
    return _session_durations(session=session, until=until or timezone.now())


def _active_duration(*, session: FocusSession, until: datetime) -> int:
    return _session_durations(session=session, until=until)[0]


def _owned_locked_session(*, user: User, session_id: UUID) -> FocusSession:
    try:
        return FocusSession.objects.select_for_update().get(id=session_id, user=user)
    except FocusSession.DoesNotExist as error:
        raise FocusSessionStateError("Focus session was not found.") from error


@transaction.atomic
def pause_focus_session(*, user: User, session_id: UUID) -> FocusSession:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status == FocusSession.Status.PAUSED:
        return session
    if session.status != FocusSession.Status.ACTIVE:
        raise FocusSessionStateError("Only an active Focus session can be paused.")
    occurred_at = timezone.now()
    session.status = FocusSession.Status.PAUSED
    session.last_activity_at = occurred_at
    session.revision += 1
    session.save(update_fields=("status", "last_activity_at", "revision", "updated_at"))
    _append_activity(
        session=session,
        activity_type=FocusSessionActivity.ActivityType.PAUSED,
        occurred_at=occurred_at,
    )
    publish_after_commit(
        FocusSessionPaused(
            session_id=session.id,
            user_id=user.id,
            context_type=session.context_type,
            context_id=session.context_id,
            actor_id=user.id,
        )
    )
    return session


@transaction.atomic
def resume_focus_session(*, user: User, session_id: UUID) -> FocusSession:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status == FocusSession.Status.ACTIVE:
        return session
    if session.status != FocusSession.Status.PAUSED:
        raise FocusSessionStateError("Only a paused Focus session can be resumed.")
    occurred_at = timezone.now()
    session.status = FocusSession.Status.ACTIVE
    session.last_activity_at = occurred_at
    session.revision += 1
    session.save(update_fields=("status", "last_activity_at", "revision", "updated_at"))
    _append_activity(
        session=session,
        activity_type=FocusSessionActivity.ActivityType.RESUMED,
        occurred_at=occurred_at,
    )
    publish_after_commit(
        FocusSessionResumed(
            session_id=session.id,
            user_id=user.id,
            context_type=session.context_type,
            context_id=session.context_id,
            actor_id=user.id,
        )
    )
    return session


@transaction.atomic
def start_focus_break(*, user: User, session_id: UUID) -> FocusSession:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status == FocusSession.Status.ON_BREAK:
        return session
    if session.status != FocusSession.Status.ACTIVE:
        raise FocusSessionStateError("Only an active Focus session can start a break.")
    occurred_at = timezone.now()
    session.status = FocusSession.Status.ON_BREAK
    session.last_activity_at = occurred_at
    session.revision += 1
    session.save(update_fields=("status", "last_activity_at", "revision", "updated_at"))
    _append_activity(
        session=session,
        activity_type=FocusSessionActivity.ActivityType.BREAK_STARTED,
        occurred_at=occurred_at,
    )
    return session


@transaction.atomic
def end_focus_break(*, user: User, session_id: UUID) -> FocusSession:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status == FocusSession.Status.ACTIVE:
        return session
    if session.status != FocusSession.Status.ON_BREAK:
        raise FocusSessionStateError("Only a Focus session on break can resume focus.")
    occurred_at = timezone.now()
    session.status = FocusSession.Status.ACTIVE
    session.last_activity_at = occurred_at
    session.revision += 1
    session.save(update_fields=("status", "last_activity_at", "revision", "updated_at"))
    _append_activity(
        session=session,
        activity_type=FocusSessionActivity.ActivityType.BREAK_ENDED,
        occurred_at=occurred_at,
    )
    return session


@transaction.atomic
def join_live_team_session(*, user: User, team_id: UUID) -> FocusSession:
    team = FocusTeam.objects.select_for_update().get(id=team_id)
    if team.closed_at or not FocusTeamMembership.objects.filter(team=team, user=user).exists():
        raise FocusSessionStateError("This team is not available.")
    session = active_team_lock_in_session(team=team)
    if session is None:
        raise FocusSessionStateError("There is no active team Lockin.")
    current = active_lock_in_session_for_user(user=user)
    if current is not None and current.id != session.id:
        raise FocusSessionStateError("Resume your active Lockin first.")
    now = timezone.now()
    participant, _ = FocusSessionParticipant.objects.select_for_update().get_or_create(
        session=session,
        user=user,
        defaults={"presence": FocusSessionParticipant.Presence.FOCUSED},
    )
    if participant.left_at is not None:
        participant.left_at = None
        participant.joined_at = now
    participant.presence = FocusSessionParticipant.Presence.FOCUSED
    participant.last_seen_at = now
    participant.save(update_fields=("left_at", "joined_at", "presence", "last_seen_at"))
    return session


@transaction.atomic
def set_live_team_presence(*, user: User, session_id: UUID, presence: str) -> FocusSession:
    session = FocusSession.objects.select_for_update().select_related("team").get(id=session_id)
    if (
        not session.lock_in_live
        or session.team_id is None
        or session.status != FocusSession.Status.ACTIVE
    ):
        raise FocusSessionStateError("This team Lockin is not active.")
    if not FocusTeamMembership.objects.filter(team_id=session.team_id, user=user).exists():
        raise FocusSessionStateError("This team is not available.")
    try:
        participant = FocusSessionParticipant.objects.select_for_update().get(
            session=session, user=user, left_at__isnull=True
        )
    except FocusSessionParticipant.DoesNotExist as error:
        raise FocusSessionStateError("Join this Lockin to update your status.") from error
    now = timezone.now()
    if presence != FocusSessionParticipant.Presence.BREAK:
        _finish_participant_break(participant, now)
    elif participant.presence != FocusSessionParticipant.Presence.BREAK:
        participant.break_started_at = now
    participant.presence = presence
    participant.last_seen_at = now
    participant.save(
        update_fields=("presence", "last_seen_at", "break_started_at", "break_seconds")
    )
    return session


@transaction.atomic
def leave_live_team_session(*, user: User, session_id: UUID) -> FocusSession:
    session = FocusSession.objects.select_for_update().get(id=session_id)
    if session.team_id is None or not session.lock_in_live:
        raise FocusSessionStateError("Solo Lockins must be ended, not left.")
    try:
        participant = FocusSessionParticipant.objects.select_for_update().get(
            session=session, user=user, left_at__isnull=True
        )
    except FocusSessionParticipant.DoesNotExist as error:
        raise FocusSessionStateError("You are not in this Lockin.") from error
    now = timezone.now()
    _finish_participant_break(participant, now)
    participant.left_at = now
    participant.save(update_fields=("left_at", "break_started_at", "break_seconds"))
    return session


@transaction.atomic
def complete_live_lock_in_session(*, user: User, session_id: UUID) -> FocusSession:
    try:
        session = FocusSession.objects.select_related("team").get(id=session_id)
    except FocusSession.DoesNotExist as error:
        raise FocusSessionStateError("Lockin was not found.") from error
    if session.team_id is None:
        return complete_owned_focus_session(user=user, session_id=session_id)
    team = FocusTeam.objects.select_for_update().get(id=session.team_id)
    if (
        team.owner_id != user.id
        or not FocusTeamMembership.objects.filter(team=team, user=user).exists()
    ):
        raise FocusSessionStateError("Only the host can end this Lockin.")
    session = FocusSession.objects.select_for_update().get(id=session_id, team=team)
    if session.status == FocusSession.Status.COMPLETED:
        return session
    if session.status not in UNFINISHED_STATUSES:
        raise FocusSessionStateError("This Lockin has already ended.")
    now = timezone.now()
    for participant in FocusSessionParticipant.objects.select_for_update().filter(
        session=session, break_started_at__isnull=False
    ):
        _finish_participant_break(participant, now)
        participant.save(update_fields=("break_started_at", "break_seconds"))
    return complete_focus_session(
        session_id=session.id,
        active_duration_seconds=_active_duration(session=session, until=now),
        completed_at=now,
        actor_id=user.id,
    )


@transaction.atomic
def complete_focus_session(
    *,
    session_id: UUID,
    active_duration_seconds: int,
    completed_at: datetime | None = None,
    actor_id: UUID | None = None,
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
    session.last_activity_at = finished_at
    session.active_duration_seconds = active_duration_seconds
    session.revision += 1
    session.full_clean()
    session.save(
        update_fields=(
            "status",
            "ended_at",
            "last_activity_at",
            "active_duration_seconds",
            "revision",
            "updated_at",
        )
    )
    _append_activity(
        session=session,
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
            # When the sitting ended, not when this ran. A session settled the
            # next morning was otherwise credited to the wrong day, which for a
            # streak is the difference between a run continuing and restarting.
            occurred_at=finished_at,
            actor_id=actor_id or session.user_id,
        )
    )
    return session


@transaction.atomic
def complete_owned_focus_session(*, user: User, session_id: UUID) -> FocusSession:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status == FocusSession.Status.COMPLETED:
        return session
    if session.status == FocusSession.Status.ABANDONED:
        raise FocusSessionStateError("An abandoned focus session cannot be completed.")
    completed_at = timezone.now()
    active_duration_seconds = _active_duration(session=session, until=completed_at)
    return complete_focus_session(
        session_id=session.id,
        active_duration_seconds=active_duration_seconds,
        completed_at=completed_at,
    )


@transaction.atomic
def abandon_focus_session(*, user: User, session_id: UUID) -> FocusSession:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status == FocusSession.Status.ABANDONED:
        return session
    if session.status == FocusSession.Status.COMPLETED:
        raise FocusSessionStateError("A completed Focus session cannot be abandoned.")
    occurred_at = timezone.now()
    session.status = FocusSession.Status.ABANDONED
    session.ended_at = occurred_at
    session.last_activity_at = occurred_at
    session.active_duration_seconds = _active_duration(session=session, until=occurred_at)
    session.revision += 1
    session.full_clean()
    session.save(
        update_fields=(
            "status",
            "ended_at",
            "last_activity_at",
            "active_duration_seconds",
            "revision",
            "updated_at",
        )
    )
    _append_activity(
        session=session,
        activity_type=FocusSessionActivity.ActivityType.ABANDONED,
        occurred_at=occurred_at,
        metadata={"active_duration_seconds": session.active_duration_seconds},
    )
    publish_after_commit(
        FocusSessionAbandoned(
            session_id=session.id,
            user_id=user.id,
            context_type=session.context_type,
            context_id=session.context_id,
            active_duration_seconds=session.active_duration_seconds,
            actor_id=user.id,
        )
    )
    return session


@transaction.atomic
def save_focus_session_note(
    *, user: User, session_id: UUID, body: str, expected_revision: int | None
) -> FocusSessionNote:
    session = _owned_locked_session(user=user, session_id=session_id)
    note, created = FocusSessionNote.objects.select_for_update().get_or_create(
        session=session, defaults={"body": body.strip()}
    )
    if not created:
        if expected_revision is not None and note.revision != expected_revision:
            raise FocusSessionStateError("The session note changed. Reload it before saving.")
        note.body = body.strip()
        note.revision += 1
        note.save(update_fields=("body", "revision", "updated_at"))
    return note


@transaction.atomic
def add_focus_session_task(
    *, user: User, session_id: UUID, client_task_id: UUID, title: str
) -> FocusSessionTask:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status in {FocusSession.Status.COMPLETED, FocusSession.Status.ABANDONED}:
        raise FocusSessionStateError("Tasks cannot be changed after a Focus session ends.")
    task, _ = FocusSessionTask.objects.get_or_create(
        session=session,
        client_task_id=client_task_id,
        defaults={"title": title.strip()},
    )
    return task


@transaction.atomic
def toggle_focus_session_task(*, user: User, session_id: UUID, task_id: UUID) -> FocusSessionTask:
    session = _owned_locked_session(user=user, session_id=session_id)
    if session.status in {FocusSession.Status.COMPLETED, FocusSession.Status.ABANDONED}:
        raise FocusSessionStateError("Tasks cannot be changed after a Focus session ends.")
    try:
        task = FocusSessionTask.objects.select_for_update().get(id=task_id, session=session)
    except FocusSessionTask.DoesNotExist as error:
        raise FocusSessionStateError("Focus session task was not found.") from error
    task.completed_at = None if task.completed_at is not None else timezone.now()
    task.save(update_fields=("completed_at", "updated_at"))
    return task
