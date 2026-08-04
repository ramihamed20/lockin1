from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Max
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
    FocusSessionTask,
    FocusTeam,
    FocusTeamMembership,
    FocusTeamMessage,
    FocusWorkspaceSnapshot,
)


class FocusSessionStateError(ValueError):
    pass


@transaction.atomic
def create_focus_team(*, user: User, name: str) -> FocusTeam:
    team = FocusTeam(owner=user, name=name.strip())
    team.full_clean()
    team.save()
    FocusTeamMembership.objects.create(
        team=team, user=user, role=FocusTeamMembership.Role.OWNER
    )
    return team


@transaction.atomic
def join_focus_team(*, user: User, invite_code: str) -> tuple[FocusTeam, bool]:
    try:
        team = FocusTeam.objects.select_for_update().get(invite_code=invite_code.strip().upper())
    except FocusTeam.DoesNotExist as error:
        raise FocusSessionStateError("That team invite code was not found.") from error
    _, created = FocusTeamMembership.objects.get_or_create(
        team=team,
        user=user,
        defaults={"role": FocusTeamMembership.Role.MEMBER},
    )
    return team, created


def focus_team_for_member(*, user: User, team_id: UUID) -> FocusTeam:
    try:
        return FocusTeam.objects.get(id=team_id, memberships__user=user)
    except FocusTeam.DoesNotExist as error:
        raise FocusSessionStateError("That study team is not available to this account.") from error


@transaction.atomic
def add_focus_team_message(*, user: User, team_id: UUID, body: str) -> FocusTeamMessage:
    team = focus_team_for_member(user=user, team_id=team_id)
    message = FocusTeamMessage(team=team, author=user, body=body.strip())
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
    goal: str,
    topic: str,
    note: str,
    tasks: tuple[tuple[UUID, str], ...],
) -> tuple[FocusSession, bool]:
    """Create one durable Lock In session, or return the user's unfinished one.

    Locking the user row serializes two tabs pressing Start at the same time.
    The client id makes retries of the same request idempotent as well.
    """
    User.objects.select_for_update().get(id=user.id)
    existing = (
        FocusSession.objects.select_for_update()
        .filter(user=user, status__in=(
            FocusSession.Status.ACTIVE,
            FocusSession.Status.PAUSED,
            FocusSession.Status.ON_BREAK,
        ))
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

    context_type = FocusSession.ContextType.STUDY if document is not None else FocusSession.ContextType.INDEPENDENT
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
    session.goal = goal.strip()
    session.topic = topic.strip()
    session.full_clean()
    session.save(update_fields=("break_duration_seconds", "session_type", "team", "team_name", "goal", "topic", "updated_at"))
    if team is not None:
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
            page_count=document.page_count or (previous.page_count if previous is not None else None),
            zoom=previous.zoom if previous is not None else 1,
            sidebar=previous.sidebar if previous is not None else FocusWorkspaceSnapshot.Sidebar.CLOSED,
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
        if activity.activity_type in {
            FocusSessionActivity.ActivityType.BREAK_ENDED,
            FocusSessionActivity.ActivityType.COMPLETED,
            FocusSessionActivity.ActivityType.ABANDONED,
        } and break_opened_at is not None:
            break_total += max(0.0, (activity.occurred_at - break_opened_at).total_seconds())
            break_opened_at = None
    if opened_at is not None:
        active_total += max(0.0, (until - opened_at).total_seconds())
    if break_opened_at is not None:
        break_total += max(0.0, (until - break_opened_at).total_seconds())
    return int(active_total), int(break_total)


def focus_session_durations(*, session: FocusSession, until: datetime | None = None) -> tuple[int, int]:
    """Return server-derived active and break seconds without trusting clients."""
    if session.ended_at is not None:
        return session.active_duration_seconds, _session_durations(session=session, until=session.ended_at)[1]
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
            actor_id=session.user_id,
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
