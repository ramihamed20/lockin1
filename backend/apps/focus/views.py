import hashlib
from datetime import timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from django.conf import settings
from django.db.models import Count, Prefetch, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.avatars import avatar_payload
from apps.accounts.models import User
from apps.content.editions import (
    UNIVERSITY,
    UnknownEditionError,
    normalize_edition,
    normalize_view,
)
from apps.content.models import LearningObject, LearningObjectAsset, LearningObjectVersion
from apps.content.policies import can_view_learning_object, is_version_available
from apps.education.policies import is_content_administrator
from apps.entitlements.services import require_entitlement
from apps.files.models import ManagedFile

from .active_study import (
    ActiveStudyRuleError,
    active_quiz,
    active_study_payload,
    continue_active_study,
    submit_active_quiz,
)
from .annotation_services import (
    FocusAnnotationConflictError,
    annotation_payload,
    sync_annotations,
)
from .domain_types import AnnotationMutation, WorkspaceStateInput
from .integrations import resolve_focus_document
from .managed_active_study import (
    ManagedActiveStudyRuleError,
    complete_part_reading,
)
from .managed_active_study import (
    abandon as abandon_managed_active_study,
)
from .managed_active_study import (
    answer as answer_managed_active_study,
)
from .managed_active_study import (
    availability as managed_active_study_availability,
)
from .managed_active_study import (
    continue_anyway as continue_managed_active_study,
)
from .managed_active_study import (
    discard_open_attempt as discard_managed_active_study_attempt,
)
from .managed_active_study import (
    questions as managed_active_study_questions,
)
from .managed_active_study import (
    restart as restart_managed_active_study,
)
from .managed_active_study import (
    retry_final as retry_managed_active_study,
)
from .managed_active_study import (
    run_payload as managed_active_study_run_payload,
)
from .managed_active_study import (
    start as start_managed_active_study,
)
from .managed_active_study import (
    study_again as managed_active_study_again,
)
from .managed_active_study import (
    submit as submit_managed_active_study,
)
from .models import (
    FocusSession,
    FocusSessionNote,
    FocusSessionParticipant,
    FocusTeam,
    FocusTeamMembership,
    FocusTeamMessage,
)
from .selectors import (
    annotations_for_pages,
    focus_session_history,
    get_focus_summary,
    latest_workspace,
)
from .serializers import (
    ActiveStudyStartSerializer,
    ActiveStudySubmitSerializer,
    AnnotationSyncSerializer,
    FocusSessionActionSerializer,
    FocusSessionNoteSerializer,
    FocusSessionSerializer,
    FocusSessionStartSerializer,
    FocusSessionTaskSerializer,
    FocusWorkspaceSerializer,
    LockInNoteUpdateSerializer,
    LockInPresenceSerializer,
    LockInStartSerializer,
    LockInTaskCreateSerializer,
    LockInTeamCreateSerializer,
    LockInTeamJoinSerializer,
    LockInTeamMemberActionSerializer,
    LockInTeamMessageCreateSerializer,
    LockInTeamMessageSerializer,
    LockInTeamSerializer,
    LockInTeamUpdateSerializer,
    ManagedActiveStudyAnswerSerializer,
    ManagedActiveStudyStartSerializer,
    ManagedActiveStudySubmitSerializer,
    WorkspaceStateSerializer,
)
from .services import (
    FocusSessionStateError,
    abandon_focus_session,
    active_lock_in_session_for_user,
    active_team_lock_in_session,
    add_focus_session_task,
    add_focus_team_message,
    complete_live_lock_in_session,
    complete_owned_focus_session,
    create_focus_team,
    end_focus_break,
    focus_session_durations,
    focus_team_for_member,
    join_focus_team,
    join_live_team_session,
    leave_live_team_session,
    manage_focus_team,
    pause_focus_session,
    resume_focus_session,
    save_focus_session_note,
    set_live_team_presence,
    start_focus_break,
    start_lock_in_session,
    start_workspace_session,
    toggle_focus_session_task,
)
from .validation import FocusValidationError
from .workspace_services import FocusWorkspaceConflictError, update_workspace_state


class FocusConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "focus_revision_conflict"
    default_detail = "Focus state changed. Reload it and try again."


class FocusRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "focus_rule_rejected"


class FocusAnnotationPagination(PageNumberPagination):
    page_size = 250
    page_size_query_param = "page_size"
    max_page_size = 1000


class ActiveStudyStartView(APIView):
    @extend_schema(
        operation_id="active_study_start",
        request=ActiveStudyStartSerializer,
        responses={200: OpenApiTypes.OBJECT, 201: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request) -> Response:
        _authorize(request)
        raise FocusRejected(
            "New legacy Active Study sessions are disabled. Start from the managed sheet reader."
        )


class ActiveStudyQuizView(APIView):
    @extend_schema(operation_id="active_study_quiz", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, run_id: UUID) -> Response:
        user = _authorize(request)
        try:
            run, questions = active_quiz(user=user, run_id=run_id)
        except ActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error
        return Response({"run": active_study_payload(run), "questions": questions})

    @extend_schema(
        operation_id="active_study_quiz_submit",
        request=ActiveStudySubmitSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request, run_id: UUID) -> Response:
        user = _authorize(request)
        serializer = ActiveStudySubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            run, result = submit_active_quiz(
                user=user,
                run_id=run_id,
                answers={
                    str(key): str(value)
                    for key, value in serializer.validated_data["answers"].items()
                },
            )
        except ActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error
        return Response({"run": active_study_payload(run), "result": result})


class ActiveStudyContinueView(APIView):
    @extend_schema(operation_id="active_study_continue", responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, run_id: UUID) -> Response:
        user = _authorize(request)
        try:
            run = continue_active_study(user=user, run_id=run_id)
        except ActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error
        return Response({"run": active_study_payload(run)})


def _edition(request: Request) -> str:
    """Which edition of the sheet the student is reading."""

    try:
        return normalize_edition(request.query_params.get("edition"))
    except UnknownEditionError as error:
        raise FocusRejected(str(error)) from error


def _view(request: Request) -> str:
    """Whether the reader has the study PDF open or its Sheet Summary."""

    try:
        return normalize_view(request.query_params.get("view"))
    except UnknownEditionError as error:
        raise FocusRejected(str(error)) from error


class ManagedActiveStudyAvailabilityView(APIView):
    @extend_schema(
        operation_id="managed_active_study_availability",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request: Request, sheet_id: UUID) -> Response:
        try:
            return Response(
                managed_active_study_availability(
                    user=_authorize(request),
                    sheet_id=sheet_id,
                    edition=_edition(request),
                )
            )
        except ManagedActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error


class ManagedActiveStudyStartView(APIView):
    @extend_schema(
        operation_id="managed_active_study_start",
        request=ManagedActiveStudyStartSerializer,
    )
    def post(self, request: Request) -> Response:
        serializer = ManagedActiveStudyStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            run, created = start_managed_active_study(
                user=_authorize(request),
                sheet_id=serializer.validated_data["sheet_id"],
                difficulty=str(serializer.validated_data["difficulty"]),
                edition=str(serializer.validated_data.get("edition") or UNIVERSITY),
            )
        except ManagedActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error
        return Response(
            {"run": managed_active_study_run_payload(run), "resumed": not created},
            status=(status.HTTP_201_CREATED if created else status.HTTP_200_OK),
        )


class ManagedActiveStudyRunView(APIView):
    def post(self, request: Request, run_id: UUID, action: str) -> Response:
        user = _authorize(request)
        try:
            if action == "complete-reading":
                run = complete_part_reading(user=user, run_id=run_id)
                return Response({"run": managed_active_study_run_payload(run)})
            if action == "continue":
                run = continue_managed_active_study(user=user, run_id=run_id)
                return Response({"run": managed_active_study_run_payload(run)})
            if action == "study-again":
                run = managed_active_study_again(user=user, run_id=run_id)
                return Response({"run": managed_active_study_run_payload(run)})
            if action == "retry-final":
                run = retry_managed_active_study(user=user, run_id=run_id)
                return Response({"run": managed_active_study_run_payload(run)})
            if action == "abandon":
                run = abandon_managed_active_study(user=user, run_id=run_id)
                return Response({"run": managed_active_study_run_payload(run)})
            if action == "restart":
                run = restart_managed_active_study(user=user, run_id=run_id)
                return Response({"run": managed_active_study_run_payload(run)})
            if action == "discard-attempt":
                run = discard_managed_active_study_attempt(user=user, run_id=run_id)
                return Response({"run": managed_active_study_run_payload(run)})
        except ManagedActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error
        raise FocusRejected("Active Study action is invalid.")


class ManagedActiveStudyQuestionsView(APIView):
    def get(self, request: Request, run_id: UUID) -> Response:
        try:
            return Response(managed_active_study_questions(user=_authorize(request), run_id=run_id))
        except ManagedActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error


class ManagedActiveStudyAnswerView(APIView):
    def post(self, request: Request, run_id: UUID) -> Response:
        serializer = ManagedActiveStudyAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            return Response(
                answer_managed_active_study(
                    user=_authorize(request),
                    run_id=run_id,
                    **serializer.validated_data,
                )
            )
        except ManagedActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error


class ManagedActiveStudySubmitView(APIView):
    def post(self, request: Request, run_id: UUID) -> Response:
        serializer = ManagedActiveStudySubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            run, result = submit_managed_active_study(
                user=_authorize(request),
                run_id=run_id,
                attempt_id=serializer.validated_data["attempt_id"],
            )
        except ManagedActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error
        return Response({"run": managed_active_study_run_payload(run), "result": result})


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _authorize(request: Request) -> User:
    user = _user(request)
    require_entitlement(user=user, entitlement_code="focus.workspace")
    return user


def _rule_error(error: ValueError) -> APIException:
    if isinstance(error, (FocusWorkspaceConflictError, FocusAnnotationConflictError)):
        return FocusConflict(str(error))
    return FocusRejected(str(error))


def _document_payload(document: Any) -> dict[str, object]:
    return {
        "document_id": str(document.document_id),
        "document_version_id": str(document.document_version_id),
        "file_id": str(document.file_id),
        "title": document.title,
        "language": document.language,
        "view_url": document.view_url,
        "size_bytes": document.size_bytes,
        "checksum_sha256": document.checksum_sha256,
        "page_count": document.page_count,
    }


def _lock_in_materials(*, user: User) -> list[dict[str, object]]:
    """Return only accessible, published PDF materials; access is rechecked per row.

    Resolved in bulk. This used to call ``resolve_focus_document`` per candidate,
    which is two queries each, so opening Lock In cost around a hundred round
    trips before anything rendered. The joins below fetch the same rows in one
    query and the checks are applied in Python against them.

    The checks themselves are unchanged and still per row -- discoverability and
    availability windows are read from the same fields ``can_view_learning_object``
    and ``is_version_available`` use, so a material nobody may open is still
    excluded. The payload and its ordering are identical.
    """

    candidates = (
        LearningObject.objects.filter(
            archived_at__isnull=True,
            published_version__content_type=LearningObjectVersion.ContentType.PDF,
        )
        .select_related("published_version__academic_node")
        .prefetch_related(
            Prefetch(
                "published_version__assets",
                queryset=LearningObjectAsset.objects.filter(
                    role=LearningObjectAsset.Role.PRIMARY,
                    managed_file__validation_status=ManagedFile.ValidationStatus.READY,
                )
                .select_related("managed_file")
                .order_by("position", "id"),
                to_attr="primary_assets",
            )
        )
        .order_by("-published_at", "-updated_at")[:50]
    )

    cohort_enforced = bool(getattr(settings, "COHORT_CONTENT_ENFORCEMENT", False))
    content_admin = is_content_administrator(user) if cohort_enforced else False
    materials: list[dict[str, object]] = []
    for learning_object in candidates:
        version = learning_object.published_version
        if (
            version is None
            or not version.academic_node.is_discoverable
            or not is_version_available(version)
        ):
            continue
        if (
            cohort_enforced
            and not content_admin
            and not can_view_learning_object(user=user, learning_object=learning_object)
        ):
            continue
        asset = next(iter(getattr(version, "primary_assets", [])), None)
        if asset is None or asset.managed_file.content_type != "application/pdf":
            continue
        page_count = version.page_count
        materials.append(
            {
                "document_id": str(learning_object.id),
                "document_version_id": str(version.id),
                "file_id": str(asset.managed_file_id),
                "title": version.title,
                "language": version.language,
                "view_url": f"/api/v1/files/{asset.managed_file_id}/view",
                "size_bytes": asset.managed_file.size_bytes,
                "checksum_sha256": asset.managed_file.checksum_sha256,
                "page_count": page_count,
            }
        )
    return materials


def _team_payload(*, user: User, team: FocusTeam) -> dict[str, object]:
    memberships = list(
        FocusTeamMembership.objects.filter(team=team)
        .select_related("user", "user__profile_image")
        .order_by("joined_at")
    )
    active_sessions = {
        session.user_id: session
        for session in FocusSession.objects.filter(
            team=team,
            status__in=(
                FocusSession.Status.ACTIVE,
                FocusSession.Status.PAUSED,
                FocusSession.Status.ON_BREAK,
            ),
        ).prefetch_related("timeline")
    }
    members: list[dict[str, object]] = []
    for membership in memberships:
        session = active_sessions.get(membership.user_id)
        active_seconds = 0
        progress = None
        if session is not None:
            active_seconds, _ = focus_session_durations(session=session)
            if session.planned_duration_seconds:
                progress = min(100, round(active_seconds * 100 / session.planned_duration_seconds))
        members.append(
            {
                "member_id": str(membership.id),
                "user_id": None if membership.anonymous else str(membership.user_id),
                "name": (
                    membership.anonymous_alias
                    if membership.anonymous
                    else membership.user.full_name
                ),
                "avatar": (
                    {"source": "default", "default_id": "", "url": None}
                    if membership.anonymous
                    else avatar_payload(membership.user)
                ),
                "anonymous": membership.anonymous,
                "role": membership.role,
                "status": session.status if session is not None else "offline",
                "active_seconds": active_seconds,
                "progress": progress,
            }
        )
    week_start = timezone.localdate() - timedelta(days=6)
    weekly = FocusSession.objects.filter(
        team=team,
        status=FocusSession.Status.COMPLETED,
        ended_at__date__gte=week_start,
    ).aggregate(
        active_seconds=Coalesce(Sum("active_duration_seconds"), 0),
        completed_sessions=Count("id"),
    )
    team_data = dict(LockInTeamSerializer(team).data)
    live = active_team_lock_in_session(team=team)
    team_data.update(
        {
            "active_session_id": str(live.id) if live else None,
            "can_resume_session": bool(
                live
                and FocusSessionParticipant.objects.filter(
                    session=live, user=user, left_at__isnull=True
                ).exists()
            ),
            "role": next(
                (member.role for member in memberships if member.user_id == user.id), "member"
            ),
            "member_count": len(members),
            "self_member_id": next(
                (str(member.id) for member in memberships if member.user_id == user.id), None
            ),
            "members": members,
            "weekly_active_seconds": int(weekly["active_seconds"]),
            "weekly_completed_sessions": int(weekly["completed_sessions"]),
        }
    )
    return team_data


def _live_lock_in_payload(*, user: User, session: FocusSession) -> dict[str, object]:
    now = timezone.now()
    if session.team_id is not None:
        membership = FocusTeamMembership.objects.filter(team_id=session.team_id, user=user).first()
        participant = FocusSessionParticipant.objects.filter(
            session=session, user=user, left_at__isnull=True
        ).first()
        if membership is None or participant is None:
            raise FocusRejected("This Lockin is not available.")
        members = list(
            FocusTeamMembership.objects.filter(team_id=session.team_id)
            .select_related("user")
            .order_by("joined_at", "id")
        )
        participants = {
            item.user_id: item
            for item in FocusSessionParticipant.objects.filter(
                session=session, left_at__isnull=True
            )
        }
        presence = [
            {
                "member_id": str(member.id),
                "name": member.anonymous_alias if member.anonymous else member.user.full_name,
                "anonymous": member.anonymous,
                "role": member.role,
                "presence": (
                    "away"
                    if participants[member.user_id].last_seen_at < now - timedelta(seconds=75)
                    else participants[member.user_id].presence
                ),
            }
            for member in members
            if member.user_id in participants
        ]
        team = _team_payload(user=user, team=cast(FocusTeam, session.team))
        own_break = participant.break_seconds + (
            max(0, int((now - participant.break_started_at).total_seconds()))
            if participant.break_started_at
            else 0
        )
        self_presence: str | None = participant.presence
        is_host = membership.role == FocusTeamMembership.Role.OWNER
        member_count = session.participants.count()
    else:
        if session.user_id != user.id:
            raise FocusRejected("This Lockin is not available.")
        presence = []
        team = None
        own_break = 0
        self_presence = None
        is_host = True
        member_count = 1
    active_seconds, solo_break_seconds = focus_session_durations(session=session, until=now)
    return {
        "session": {
            "id": str(session.id),
            "status": session.status,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "planned_duration_seconds": session.planned_duration_seconds,
            "team_id": str(session.team_id) if session.team_id else None,
            "team_name": session.team_name,
            "lock_in_live": True,
        },
        "timing": {
            "server_now": now,
            "active_elapsed_seconds": active_seconds,
            "break_elapsed_seconds": own_break if team else solo_break_seconds,
            "remaining_seconds": (
                max(0, session.planned_duration_seconds - active_seconds)
                if session.planned_duration_seconds is not None
                else None
            ),
        },
        "team": team,
        "participants": presence,
        "member_count": member_count,
        "self_presence": self_presence,
        "is_host": is_host,
    }


def _team_rankings_payload(period: str = "weekly") -> list[dict[str, object]]:
    """The weekly leaderboard, in one query.

    This walked every row of FocusTeam and issued two queries per team -- an
    aggregate and a count -- so the cost of the Lock In screen grew with the
    number of teams in the product, for every reader who opened it. Both totals
    are now annotations, ordering happens in the database, and the slice is a
    LIMIT rather than a Python sort over everything.

    The payload is unchanged, including the ordering rule: most active first,
    ties broken by name.
    """

    week_start = timezone.localdate() - timedelta(days=6)
    completed_this_week = Q(sessions__status=FocusSession.Status.COMPLETED)
    if period == "weekly":
        completed_this_week &= Q(sessions__ended_at__date__gte=week_start)
    teams = FocusTeam.objects.annotate(
        weekly_active_seconds=Coalesce(
            Sum("sessions__active_duration_seconds", filter=completed_this_week),
            0,
        ),
        # distinct=True: the sessions join above multiplies membership rows,
        # and without it every team with sessions would over-count members.
        member_total=Count("memberships", distinct=True),
    ).order_by("-weekly_active_seconds", "name")[:10]
    return [
        {
            "id": str(team.id),
            "name": team.name,
            "weekly_active_seconds": int(team.weekly_active_seconds),
            "member_count": int(team.member_total),
        }
        for team in teams
    ]


def _solo_rankings_payload(period: str = "weekly") -> list[dict[str, object]]:
    solo = FocusSession.objects.filter(team__isnull=True, status=FocusSession.Status.COMPLETED)
    anonymous = FocusSession.objects.filter(team__isnull=True, anonymous=True)
    if period == "weekly":
        week_start = timezone.localdate() - timedelta(days=6)
        solo = solo.filter(ended_at__date__gte=week_start)
        anonymous = anonymous.filter(started_at__date__gte=week_start)
    rows = list(
        solo.values("user_id", "user__full_name")
        .annotate(active_seconds=Coalesce(Sum("active_duration_seconds"), 0))
        .order_by("-active_seconds", "user_id")[:10]
    )
    anonymous_ids = set(
        anonymous.filter(user_id__in=[row["user_id"] for row in rows]).values_list(
            "user_id", flat=True
        )
    )
    return [
        {
            "name": (
                f"Anonymous {hashlib.sha256(str(row['user_id']).encode()).hexdigest()[:4].upper()}"
                if row["user_id"] in anonymous_ids
                else row["user__full_name"]
            ),
            "active_seconds": row["active_seconds"],
        }
        for row in rows
    ]


def _lock_in_payload(*, user: User, session: FocusSession) -> dict[str, object]:
    now = timezone.now()
    active_seconds, break_seconds = focus_session_durations(session=session, until=now)
    try:
        note = session.session_note
    except FocusSessionNote.DoesNotExist:
        note = None
    document = None
    if session.context_type == FocusSession.ContextType.STUDY and session.context_id is not None:
        try:
            document = _document_payload(
                resolve_focus_document(user=user, document_version_id=session.context_id)
            )
        except APIException:
            # A retired material remains historically visible through its session metadata.
            document = None
    today = timezone.localdate()
    daily = FocusSession.objects.filter(
        user=user,
        status=FocusSession.Status.COMPLETED,
        ended_at__date=today,
    )
    daily_totals = daily.aggregate(
        active_seconds=Coalesce(Sum("active_duration_seconds"), 0), completed_sessions=Count("id")
    )
    return {
        "session": FocusSessionSerializer(session).data,
        "material": document,
        "note": FocusSessionNoteSerializer(note).data if note is not None else None,
        "tasks": FocusSessionTaskSerializer(session.tasks.all(), many=True).data,
        "team": (
            _team_payload(user=user, team=cast(FocusTeam, session.team))
            if session.team_id
            and FocusTeamMembership.objects.filter(team_id=session.team_id, user=user).exists()
            else None
        ),
        "timing": {
            "server_now": now,
            "active_elapsed_seconds": active_seconds,
            "break_elapsed_seconds": break_seconds,
            "remaining_seconds": (
                max(0, session.planned_duration_seconds - active_seconds)
                if session.planned_duration_seconds is not None
                else None
            ),
        },
        "daily_summary": {
            "completed_active_seconds": int(daily_totals["active_seconds"]),
            "completed_sessions": int(daily_totals["completed_sessions"]),
        },
    }


def _lock_in_session(*, user: User, session_id: UUID) -> FocusSession:
    try:
        session = (
            FocusSession.objects.select_related("team")
            .prefetch_related("timeline")
            .get(id=session_id)
        )
    except FocusSession.DoesNotExist as error:
        raise FocusRejected("Focus session was not found.") from error
    if session.team_id and session.lock_in_live:
        if not FocusTeamMembership.objects.filter(
            team_id=session.team_id, user=user
        ).exists() or not (
            FocusSessionParticipant.objects.filter(
                session=session, user=user, left_at__isnull=True
            ).exists()
        ):
            raise FocusRejected("This Lockin is not available.")
    elif session.user_id != user.id:
        raise FocusRejected("Focus session was not found.")
    return session


def _session_payload(*, user: User, session: FocusSession) -> dict[str, object]:
    if session.lock_in_live:
        return _live_lock_in_payload(user=user, session=session)
    return _lock_in_payload(user=user, session=session)


class FocusDocumentView(APIView):
    @extend_schema(operation_id="focus_document_retrieve", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_version_id: UUID) -> Response:
        user = _authorize(request)
        document = resolve_focus_document(
            user=user,
            document_version_id=document_version_id,
            edition=_edition(request),
            view=_view(request),
        )
        workspace = latest_workspace(user_id=user.id, document_id=document.document_id)
        annotation_revision, _ = annotations_for_pages(
            user_id=user.id,
            document_id=document.document_id,
            page_numbers=(1,),
        )
        summary = get_focus_summary(user_id=user.id)
        return Response(
            {
                "document": _document_payload(document),
                "latest_workspace": (
                    FocusWorkspaceSerializer(workspace).data if workspace is not None else None
                ),
                "annotation_revision": annotation_revision,
                "summary": {
                    "completed_sessions": summary.completed_sessions,
                    "active_seconds": summary.active_seconds,
                    "last_completed_at": summary.last_completed_at,
                },
            }
        )


class FocusSessionListCreateView(ListAPIView[Any]):
    serializer_class = FocusSessionSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        return focus_session_history(user_id=_authorize(self.request).id)

    @extend_schema(
        operation_id="focus_session_start",
        request=FocusSessionStartSerializer,
        responses={200: FocusSessionSerializer, 201: FocusSessionSerializer},
    )
    def post(self, request: Request) -> Response:
        user = _authorize(request)
        serializer = FocusSessionStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        document = resolve_focus_document(
            user=user,
            document_version_id=data["document_version_id"],
        )
        try:
            session, _, created = start_workspace_session(
                user=user,
                document=document,
                client_instance_id=data["client_instance_id"],
                planned_duration_seconds=data.get("planned_duration_seconds"),
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(
            FocusSessionSerializer(session).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FocusSessionActionView(APIView):
    @extend_schema(
        operation_id="focus_session_action",
        request=FocusSessionActionSerializer,
        responses={200: FocusSessionSerializer},
    )
    def post(self, request: Request, session_id: UUID, action: str) -> Response:
        user = _authorize(request)
        serializer = FocusSessionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actions = {
            "pause": pause_focus_session,
            "resume": resume_focus_session,
            "complete": complete_owned_focus_session,
            "abandon": abandon_focus_session,
        }
        service = actions.get(action)
        if service is None:
            raise ValidationError("Focus session action is not supported.")
        try:
            session = service(user=user, session_id=session_id)
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(FocusSessionSerializer(session).data)


class LockInBootstrapView(APIView):
    """Authenticated entry/setup contract for the dedicated Lock In route."""

    @extend_schema(operation_id="lock_in_bootstrap", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        user = _authorize(request)
        active = active_lock_in_session_for_user(user=user)
        teams = [
            _team_payload(user=user, team=membership.team)
            for membership in FocusTeamMembership.objects.filter(user=user)
            .select_related("team")
            .order_by("-team__updated_at")
        ]
        return Response(
            {
                "active_session": _session_payload(user=user, session=active) if active else None,
                "materials": _lock_in_materials(user=user),
                "teams": teams,
                "team_rankings": _team_rankings_payload(),
                "server_now": timezone.now(),
            }
        )

    @extend_schema(
        operation_id="lock_in_start",
        request=LockInStartSerializer,
        responses={200: OpenApiTypes.OBJECT, 201: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request) -> Response:
        user = _authorize(request)
        serializer = LockInStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        document = None
        team = None
        if data.get("document_version_id") is not None:
            document = resolve_focus_document(
                user=user, document_version_id=data["document_version_id"]
            )
        try:
            if data.get("team_id") is not None:
                team = focus_team_for_member(user=user, team_id=data["team_id"])
                if team.closed_at:
                    raise FocusSessionStateError("This team has ended.")
            session, created = start_lock_in_session(
                user=user,
                document=document,
                client_instance_id=data["client_instance_id"],
                planned_duration_seconds=data.get("planned_duration_seconds"),
                break_duration_seconds=data.get("break_duration_seconds"),
                session_type=str(data["session_type"]),
                team=team,
                team_name=str(data.get("team_name", "")),
                anonymous=bool(data.get("anonymous", False)),
                goal=str(data.get("goal", "")),
                topic=str(data.get("topic", "")),
                note=str(data.get("note", "")),
                tasks=tuple(
                    (task["client_task_id"], str(task["title"])) for task in data.get("tasks", [])
                ),
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        session = _lock_in_session(user=user, session_id=session.id)
        return Response(
            _session_payload(user=user, session=session),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class LockInTeamsView(APIView):
    @extend_schema(operation_id="lock_in_teams_list", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        user = _authorize(request)
        teams = [
            _team_payload(user=user, team=membership.team)
            for membership in FocusTeamMembership.objects.filter(user=user)
            .select_related("team")
            .order_by("-team__updated_at")
        ]
        return Response({"teams": teams, "team_rankings": _team_rankings_payload()})

    @extend_schema(
        operation_id="lock_in_team_create",
        request=LockInTeamCreateSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request) -> Response:
        user = _authorize(request)
        serializer = LockInTeamCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            team = create_focus_team(
                user=user,
                name=str(serializer.validated_data["name"]),
                max_members=int(serializer.validated_data["max_members"]),
                anonymous=bool(serializer.validated_data["anonymous"]),
            )
        except ValueError as error:
            raise _rule_error(error) from error
        return Response(
            {"team": _team_payload(user=user, team=team)}, status=status.HTTP_201_CREATED
        )


class LockInLeaderboardView(APIView):
    @extend_schema(operation_id="lock_in_leaderboard", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        _authorize(request)
        period = request.query_params.get("period", "weekly")
        if period not in {"weekly", "all_time"}:
            raise ValidationError({"period": "Choose weekly or all time."})
        return Response(
            {
                "solo": _solo_rankings_payload(period),
                "teams": _team_rankings_payload(period),
            }
        )


class LockInTeamJoinView(APIView):
    @extend_schema(
        operation_id="lock_in_team_join",
        request=LockInTeamJoinSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request) -> Response:
        user = _authorize(request)
        serializer = LockInTeamJoinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            team, _ = join_focus_team(
                user=user,
                invite_code=str(serializer.validated_data["invite_code"]),
                anonymous=bool(serializer.validated_data["anonymous"]),
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response({"team": _team_payload(user=user, team=team)})


class LockInTeamDetailView(APIView):
    @extend_schema(operation_id="lock_in_team_detail", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, team_id: UUID) -> Response:
        user = _authorize(request)
        try:
            team = focus_team_for_member(user=user, team_id=team_id)
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response({"team": _team_payload(user=user, team=team)})

    @extend_schema(operation_id="lock_in_team_update", request=LockInTeamUpdateSerializer)
    def patch(self, request: Request, team_id: UUID) -> Response:
        user = _authorize(request)
        serializer = LockInTeamUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            team = manage_focus_team(
                user=user, team_id=team_id, action="update", data=serializer.validated_data
            )
        except FocusTeam.DoesNotExist as error:
            raise _rule_error(FocusSessionStateError("This team is not available.")) from error
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response({"team": _team_payload(user=user, team=team)})


class LockInTeamActionView(APIView):
    @extend_schema(operation_id="lock_in_team_action", responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, team_id: UUID, action: str) -> Response:
        user = _authorize(request)
        if action == "join-session":
            try:
                session = join_live_team_session(user=user, team_id=team_id)
            except (FocusTeam.DoesNotExist, FocusSessionStateError) as error:
                raise _rule_error(FocusSessionStateError(str(error))) from error
            return Response(_session_payload(user=user, session=session))
        if action not in {"regenerate-code", "kick", "transfer-host", "leave", "end"}:
            raise _rule_error(FocusSessionStateError("Unsupported team action."))
        data: dict[str, object] = {}
        if action in {"kick", "transfer-host"}:
            serializer = LockInTeamMemberActionSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
        try:
            team = manage_focus_team(user=user, team_id=team_id, action=action, data=data)
        except FocusTeam.DoesNotExist as error:
            raise _rule_error(FocusSessionStateError("This team is not available.")) from error
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        payload = None if action == "leave" else _team_payload(user=user, team=team)
        return Response({"team": payload})


class LockInTeamMessagesView(APIView):
    def _messages(self, *, user: User, team_id: UUID) -> Response:
        try:
            team = focus_team_for_member(user=user, team_id=team_id)
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        messages = list(
            FocusTeamMessage.objects.filter(team=team)
            .select_related("author", "author__profile_image")
            .order_by("-created_at")[:50]
        )
        messages.reverse()
        memberships_by_user = {
            member.user_id: member for member in FocusTeamMembership.objects.filter(team=team)
        }
        return Response(
            {
                "team": _team_payload(user=user, team=team),
                "messages": LockInTeamMessageSerializer(
                    messages, many=True, context={"memberships_by_user": memberships_by_user}
                ).data,
            }
        )

    @extend_schema(operation_id="lock_in_team_messages_list", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, team_id: UUID) -> Response:
        return self._messages(user=_authorize(request), team_id=team_id)

    @extend_schema(
        operation_id="lock_in_team_message_create",
        request=LockInTeamMessageCreateSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request, team_id: UUID) -> Response:
        user = _authorize(request)
        serializer = LockInTeamMessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            add_focus_team_message(
                user=user, team_id=team_id, body=str(serializer.validated_data["body"])
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        response = self._messages(user=user, team_id=team_id)
        response.status_code = status.HTTP_201_CREATED
        return response


class LockInSessionView(APIView):
    @extend_schema(operation_id="lock_in_session_retrieve", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, session_id: UUID) -> Response:
        user = _authorize(request)
        return Response(
            _session_payload(user=user, session=_lock_in_session(user=user, session_id=session_id))
        )


class LockInActionView(APIView):
    @extend_schema(
        operation_id="lock_in_session_action",
        request=FocusSessionActionSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request, session_id: UUID, action: str) -> Response:
        user = _authorize(request)
        session = _lock_in_session(user=user, session_id=session_id)
        if session.lock_in_live and session.team_id and action in {"presence", "leave-session"}:
            try:
                if action == "presence":
                    presence = LockInPresenceSerializer(data=request.data)
                    presence.is_valid(raise_exception=True)
                    set_live_team_presence(
                        user=user,
                        session_id=session_id,
                        presence=str(presence.validated_data["presence"]),
                    )
                else:
                    leave_live_team_session(user=user, session_id=session_id)
                    return Response({"left": True, "team_id": str(session.team_id)})
            except FocusSessionStateError as error:
                raise _rule_error(error) from error
            return Response(
                _session_payload(
                    user=user, session=_lock_in_session(user=user, session_id=session_id)
                )
            )
        if session.lock_in_live and session.team_id and action not in {"complete"}:
            raise _rule_error(
                FocusSessionStateError("This action is not available in Team Lockin.")
            )
        serializer = FocusSessionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actions = {
            "pause": pause_focus_session,
            "resume": resume_focus_session,
            "complete": (
                complete_live_lock_in_session
                if session.lock_in_live
                else complete_owned_focus_session
            ),
            "abandon": abandon_focus_session,
            "start-break": start_focus_break,
            "end-break": end_focus_break,
        }
        service = actions.get(action)
        if service is None:
            raise ValidationError("Lock In action is not supported.")
        try:
            session = service(user=user, session_id=session_id)
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(
            _session_payload(user=user, session=_lock_in_session(user=user, session_id=session.id))
        )


class LockInNoteView(APIView):
    @extend_schema(
        operation_id="lock_in_note_update",
        request=LockInNoteUpdateSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def patch(self, request: Request, session_id: UUID) -> Response:
        user = _authorize(request)
        serializer = LockInNoteUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            save_focus_session_note(
                user=user,
                session_id=session_id,
                body=str(data["body"]),
                expected_revision=data.get("expected_revision"),
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(
            _lock_in_payload(user=user, session=_lock_in_session(user=user, session_id=session_id))
        )


class LockInTasksView(APIView):
    @extend_schema(
        operation_id="lock_in_task_create",
        request=LockInTaskCreateSerializer,
        responses={201: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request, session_id: UUID) -> Response:
        user = _authorize(request)
        serializer = LockInTaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            add_focus_session_task(
                user=user,
                session_id=session_id,
                client_task_id=data["client_task_id"],
                title=str(data["title"]),
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(
            _lock_in_payload(user=user, session=_lock_in_session(user=user, session_id=session_id)),
            status=status.HTTP_201_CREATED,
        )


class LockInTaskToggleView(APIView):
    @extend_schema(operation_id="lock_in_task_toggle", responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, session_id: UUID, task_id: UUID) -> Response:
        user = _authorize(request)
        try:
            toggle_focus_session_task(user=user, session_id=session_id, task_id=task_id)
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response(
            _lock_in_payload(user=user, session=_lock_in_session(user=user, session_id=session_id))
        )


class FocusWorkspaceStateView(APIView):
    @extend_schema(
        operation_id="focus_workspace_update",
        request=WorkspaceStateSerializer,
        responses={200: FocusWorkspaceSerializer},
    )
    def patch(self, request: Request, session_id: UUID) -> Response:
        user = _authorize(request)
        serializer = WorkspaceStateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        state = WorkspaceStateInput(
            current_page=data["current_page"],
            page_count=data.get("page_count"),
            zoom=Decimal(data["zoom"]),
            sidebar=str(data["sidebar"]),
            active_tool=str(data["active_tool"]),
            layout=dict(data.get("layout", {})),
            open_tabs=[str(value) for value in data.get("open_tabs", [])],
        )
        try:
            workspace = update_workspace_state(
                user=user,
                session_id=session_id,
                expected_revision=data["expected_revision"],
                state=state,
            )
        except (FocusValidationError, FocusWorkspaceConflictError) as error:
            raise _rule_error(error) from error
        return Response(FocusWorkspaceSerializer(workspace).data)


def _page_numbers(value: str | None) -> tuple[int, ...]:
    if value is None:
        return (1,)
    try:
        pages = tuple(dict.fromkeys(int(item) for item in value.split(",")))
    except ValueError as error:
        raise ValidationError("Focus pages must be comma-separated positive integers.") from error
    if not pages or len(pages) > 10 or any(page < 1 or page > 10_000 for page in pages):
        raise ValidationError("Focus annotations can load at most ten valid pages at once.")
    return pages


class FocusAnnotationsView(APIView):
    @extend_schema(operation_id="focus_annotations_list", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_version_id: UUID) -> Response:
        user = _authorize(request)
        document = resolve_focus_document(
            user=user,
            document_version_id=document_version_id,
            edition=_edition(request),
            view=_view(request),
        )
        pages = _page_numbers(request.query_params.get("pages"))
        previous_workspace = latest_workspace(user_id=user.id, document_id=document.document_id)
        page_count = document.page_count or (
            previous_workspace.page_count if previous_workspace is not None else None
        )
        if page_count is not None and any(page > page_count for page in pages):
            raise ValidationError("A requested annotation page is outside the document.")
        revision, annotations = annotations_for_pages(
            user_id=user.id,
            document_id=document.document_id,
            page_numbers=pages,
        )
        paginator = FocusAnnotationPagination()
        page = paginator.paginate_queryset(annotations, request, view=self)
        response = paginator.get_paginated_response(
            [annotation_payload(item) for item in page or []]
        )
        response.data = {
            "collection_revision": revision,
            **dict(response.data),
        }
        return response

    @extend_schema(
        operation_id="focus_annotations_sync",
        request=AnnotationSyncSerializer,
        responses={200: OpenApiTypes.OBJECT},
    )
    def post(self, request: Request, document_version_id: UUID) -> Response:
        user = _authorize(request)
        document = resolve_focus_document(
            user=user,
            document_version_id=document_version_id,
            edition=_edition(request),
            view=_view(request),
        )
        serializer = AnnotationSyncSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        previous_workspace = latest_workspace(user_id=user.id, document_id=document.document_id)
        page_count = document.page_count or (
            previous_workspace.page_count if previous_workspace is not None else None
        )
        annotations = tuple(
            AnnotationMutation(
                annotation_id=item["id"],
                page_number=item["page_number"],
                tool=str(item["tool"]),
                layer_key=str(item["layer_key"]),
                bounds=dict(item["bounds"]),
                payload=dict(item["payload"]),
                color=str(item["color"]),
                thickness=Decimal(item["thickness"]),
                opacity=Decimal(item["opacity"]),
            )
            for item in data.get("annotations", [])
        )
        try:
            result = sync_annotations(
                user=user,
                document_id=document.document_id,
                document_version_id=document.document_version_id,
                page_count=page_count,
                expected_revision=data["expected_collection_revision"],
                idempotency_key=data["idempotency_key"],
                annotations=annotations,
                deleted_ids=tuple(data.get("deleted_ids", [])),
            )
        except (
            FocusValidationError,
            FocusAnnotationConflictError,
        ) as error:
            raise _rule_error(error) from error
        return Response(
            {
                "collection_revision": result.collection_revision,
                "saved_at": result.saved_at,
                "annotations": result.annotations,
                "deleted_ids": result.deleted_ids,
                "replayed": result.replayed,
            }
        )
