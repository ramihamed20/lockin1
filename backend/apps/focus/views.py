from datetime import timedelta
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from django.db.models import Count, Sum
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
from apps.content.models import LearningObject, LearningObjectVersion
from apps.entitlements.services import require_entitlement

from .active_study import (
    ActiveStudyRuleError,
    active_quiz,
    active_study_payload,
    continue_active_study,
    start_active_study,
    submit_active_quiz,
)
from .annotation_services import (
    FocusAnnotationConflictError,
    annotation_payload,
    sync_annotations,
)
from .domain_types import AnnotationMutation, WorkspaceStateInput
from .integrations import resolve_focus_document
from .models import FocusSession, FocusSessionNote, FocusTeam, FocusTeamMembership, FocusTeamMessage
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
    LockInStartSerializer,
    LockInTaskCreateSerializer,
    LockInTeamCreateSerializer,
    LockInTeamJoinSerializer,
    LockInTeamMessageCreateSerializer,
    LockInTeamMessageSerializer,
    LockInTeamSerializer,
    WorkspaceStateSerializer,
)
from .services import (
    FocusSessionStateError,
    abandon_focus_session,
    add_focus_session_task,
    add_focus_team_message,
    complete_owned_focus_session,
    create_focus_team,
    end_focus_break,
    focus_session_durations,
    focus_team_for_member,
    join_focus_team,
    pause_focus_session,
    resume_focus_session,
    save_focus_session_note,
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
        user = _authorize(request)
        serializer = ActiveStudyStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            run, created = start_active_study(
                user=user,
                material_slug=str(data["material_slug"]),
                sheet_slug=str(data["sheet_slug"]),
                difficulty=str(data["difficulty"]),
                page_count=int(data["page_count"]),
            )
        except ActiveStudyRuleError as error:
            raise FocusRejected(str(error)) from error
        return Response(
            {"run": active_study_payload(run), "resumed": not created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
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
    """Return only accessible, published PDF materials; access is rechecked per row."""
    candidates = (
        LearningObject.objects.filter(
            archived_at__isnull=True,
            published_version__content_type=LearningObjectVersion.ContentType.PDF,
        )
        .select_related("published_version")
        .order_by("-published_at", "-updated_at")[:50]
    )
    materials: list[dict[str, object]] = []
    for learning_object in candidates:
        if learning_object.published_version_id is None:
            continue
        try:
            document = resolve_focus_document(
                user=user, document_version_id=learning_object.published_version_id
            )
        except APIException:
            continue
        materials.append(_document_payload(document))
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
                "user_id": str(membership.user_id),
                "name": membership.user.full_name,
                "avatar": avatar_payload(membership.user),
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
    team_data.update(
        {
            "role": next(
                (member.role for member in memberships if member.user_id == user.id), "member"
            ),
            "member_count": len(members),
            "members": members,
            "weekly_active_seconds": int(weekly["active_seconds"]),
            "weekly_completed_sessions": int(weekly["completed_sessions"]),
        }
    )
    return team_data


def _team_rankings_payload() -> list[dict[str, object]]:
    week_start = timezone.localdate() - timedelta(days=6)
    rows: list[dict[str, object]] = []
    for team in FocusTeam.objects.all():
        totals = FocusSession.objects.filter(
            team=team,
            status=FocusSession.Status.COMPLETED,
            ended_at__date__gte=week_start,
        ).aggregate(active_seconds=Coalesce(Sum("active_duration_seconds"), 0))
        rows.append(
            {
                "id": str(team.id),
                "name": team.name,
                "weekly_active_seconds": int(totals["active_seconds"]),
                "member_count": FocusTeamMembership.objects.filter(team=team).count(),
            }
        )
    return sorted(
        rows,
        key=lambda row: (-cast(int, row["weekly_active_seconds"]), str(row["name"])),
    )[:10]


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
        return (
            FocusSession.objects.select_related("workspace", "session_note", "team")
            .prefetch_related("tasks", "timeline")
            .get(id=session_id, user=user)
        )
    except FocusSession.DoesNotExist as error:
        raise FocusRejected("Focus session was not found.") from error


class FocusDocumentView(APIView):
    @extend_schema(operation_id="focus_document_retrieve", responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_version_id: UUID) -> Response:
        user = _authorize(request)
        document = resolve_focus_document(user=user, document_version_id=document_version_id)
        workspace = latest_workspace(
            user_id=user.id,
            document_version_id=document.document_version_id,
        )
        annotation_revision, _ = annotations_for_pages(
            user_id=user.id,
            document_version_id=document.document_version_id,
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
        active = (
            FocusSession.objects.select_related("workspace", "session_note")
            .prefetch_related("tasks", "timeline")
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
        teams = [
            _team_payload(user=user, team=membership.team)
            for membership in FocusTeamMembership.objects.filter(user=user)
            .select_related("team")
            .order_by("-team__updated_at")
        ]
        return Response(
            {
                "active_session": _lock_in_payload(user=user, session=active) if active else None,
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
            session, created = start_lock_in_session(
                user=user,
                document=document,
                client_instance_id=data["client_instance_id"],
                planned_duration_seconds=data.get("planned_duration_seconds"),
                break_duration_seconds=data.get("break_duration_seconds"),
                session_type=str(data["session_type"]),
                team=team,
                team_name=str(data.get("team_name", "")),
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
            _lock_in_payload(user=user, session=session),
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
            team = create_focus_team(user=user, name=str(serializer.validated_data["name"]))
        except ValueError as error:
            raise _rule_error(error) from error
        return Response(
            {"team": _team_payload(user=user, team=team)}, status=status.HTTP_201_CREATED
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
                user=user, invite_code=str(serializer.validated_data["invite_code"])
            )
        except FocusSessionStateError as error:
            raise _rule_error(error) from error
        return Response({"team": _team_payload(user=user, team=team)})


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
        return Response(
            {
                "team": _team_payload(user=user, team=team),
                "messages": LockInTeamMessageSerializer(messages, many=True).data,
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
            _lock_in_payload(user=user, session=_lock_in_session(user=user, session_id=session_id))
        )


class LockInActionView(APIView):
    @extend_schema(
        operation_id="lock_in_session_action",
        request=FocusSessionActionSerializer,
        responses={200: OpenApiTypes.OBJECT},
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
            _lock_in_payload(user=user, session=_lock_in_session(user=user, session_id=session.id))
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
        document = resolve_focus_document(user=user, document_version_id=document_version_id)
        pages = _page_numbers(request.query_params.get("pages"))
        previous_workspace = latest_workspace(
            user_id=user.id,
            document_version_id=document.document_version_id,
        )
        page_count = document.page_count or (
            previous_workspace.page_count if previous_workspace is not None else None
        )
        if page_count is not None and any(page > page_count for page in pages):
            raise ValidationError("A requested annotation page is outside the document.")
        revision, annotations = annotations_for_pages(
            user_id=user.id,
            document_version_id=document.document_version_id,
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
        document = resolve_focus_document(user=user, document_version_id=document_version_id)
        serializer = AnnotationSyncSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        previous_workspace = latest_workspace(
            user_id=user.id,
            document_version_id=document.document_version_id,
        )
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
