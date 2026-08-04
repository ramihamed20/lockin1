from decimal import Decimal
from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import (
    FocusSession,
    FocusSessionNote,
    FocusSessionTask,
    FocusTeam,
    FocusTeamMessage,
    FocusWorkspaceSnapshot,
)
from .validation import FOCUS_TOOLS, WORKSPACE_TOOLS


class FocusWorkspaceSerializer(serializers.ModelSerializer[FocusWorkspaceSnapshot]):
    session_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = FocusWorkspaceSnapshot
        fields = (
            "session_id",
            "document_id",
            "document_version_id",
            "file_id",
            "current_page",
            "page_count",
            "zoom",
            "sidebar",
            "active_tool",
            "layout",
            "open_tabs",
            "revision",
            "updated_at",
        )
        read_only_fields = fields


class FocusSessionSerializer(serializers.ModelSerializer[FocusSession]):
    workspace = serializers.SerializerMethodField()
    team_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = FocusSession
        fields = (
            "id",
            "context_type",
            "context_id",
            "status",
            "started_at",
            "last_activity_at",
            "ended_at",
            "planned_duration_seconds",
            "break_duration_seconds",
            "session_type",
            "team_id",
            "team_name",
            "goal",
            "topic",
            "active_duration_seconds",
            "revision",
            "workspace",
        )
        read_only_fields = fields

    def get_workspace(self, session: FocusSession) -> dict[str, Any] | None:
        try:
            workspace = session.workspace
        except FocusWorkspaceSnapshot.DoesNotExist:
            return None
        return dict(FocusWorkspaceSerializer(workspace).data)


class FocusSessionStartSerializer(StrictSerializer):
    document_version_id = serializers.UUIDField()
    client_instance_id = serializers.UUIDField()
    planned_duration_seconds = serializers.IntegerField(
        min_value=60,
        max_value=8 * 60 * 60,
        allow_null=True,
        required=False,
        default=None,
    )


class FocusSessionActionSerializer(StrictSerializer):
    pass


class FocusSessionNoteSerializer(serializers.ModelSerializer[FocusSessionNote]):
    class Meta:
        model = FocusSessionNote
        fields = ("body", "revision", "updated_at")
        read_only_fields = fields


class FocusSessionTaskSerializer(serializers.ModelSerializer[FocusSessionTask]):
    class Meta:
        model = FocusSessionTask
        fields = ("id", "client_task_id", "title", "completed_at", "created_at")
        read_only_fields = fields


class LockInInitialTaskSerializer(StrictSerializer):
    client_task_id = serializers.UUIDField()
    title = serializers.CharField(max_length=280, trim_whitespace=True)

    def validate_title(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A task title is required.")
        return value


class LockInStartSerializer(StrictSerializer):
    document_version_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    client_instance_id = serializers.UUIDField()
    session_type = serializers.ChoiceField(choices=FocusSession.SessionType.choices)
    planned_duration_seconds = serializers.IntegerField(
        min_value=60, max_value=8 * 60 * 60, allow_null=True, required=False, default=None
    )
    break_duration_seconds = serializers.IntegerField(
        min_value=60, max_value=60 * 60, allow_null=True, required=False, default=None
    )
    team_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    team_name = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    goal = serializers.CharField(max_length=280, required=False, allow_blank=True, default="")
    topic = serializers.CharField(max_length=280, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=10_000, required=False, allow_blank=True, default="")
    tasks = LockInInitialTaskSerializer(many=True, required=False, default=list, max_length=20)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        session_type = str(attrs["session_type"])
        planned = attrs.get("planned_duration_seconds")
        if session_type in {FocusSession.SessionType.TIMED, FocusSession.SessionType.MATERIAL} and planned is None:
            raise serializers.ValidationError({"planned_duration_seconds": "A duration is required for this session type."})
        if session_type == FocusSession.SessionType.MATERIAL and attrs.get("document_version_id") is None:
            raise serializers.ValidationError({"document_version_id": "A study material is required for a material-based session."})
        if attrs.get("team_name", "").strip() != attrs.get("team_name", ""):
            attrs["team_name"] = attrs["team_name"].strip()
        return attrs


class LockInNoteUpdateSerializer(StrictSerializer):
    body = serializers.CharField(max_length=10_000, allow_blank=True)
    expected_revision = serializers.IntegerField(min_value=1, required=False, allow_null=True, default=None)


class LockInTaskCreateSerializer(StrictSerializer):
    client_task_id = serializers.UUIDField()
    title = serializers.CharField(max_length=280, trim_whitespace=True)

    def validate_title(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A task title is required.")
        return value


class LockInTeamCreateSerializer(StrictSerializer):
    name = serializers.CharField(max_length=80, trim_whitespace=True)

    def validate_name(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A team name is required.")
        return value


class LockInTeamJoinSerializer(StrictSerializer):
    invite_code = serializers.CharField(max_length=12, trim_whitespace=True)

    def validate_invite_code(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("An invite code is required.")
        return value.upper()


class LockInTeamMessageCreateSerializer(StrictSerializer):
    body = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_body(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("A message is required.")
        return value


class LockInTeamMessageSerializer(serializers.ModelSerializer[FocusTeamMessage]):
    author_id = serializers.UUIDField(read_only=True)
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = FocusTeamMessage
        fields = ("id", "author_id", "author_name", "body", "created_at")
        read_only_fields = fields


class LockInTeamSerializer(serializers.ModelSerializer[FocusTeam]):
    class Meta:
        model = FocusTeam
        fields = ("id", "name", "invite_code", "created_at")
        read_only_fields = fields


class WorkspaceStateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    current_page = serializers.IntegerField(min_value=1, max_value=10_000)
    page_count = serializers.IntegerField(
        min_value=1,
        max_value=10_000,
        allow_null=True,
        required=False,
        default=None,
    )
    zoom = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal("0.50"),
        max_value=Decimal("4.00"),
    )
    sidebar = serializers.ChoiceField(choices=FocusWorkspaceSnapshot.Sidebar.choices)
    active_tool = serializers.ChoiceField(
        choices=[("", "None"), *((tool, tool) for tool in sorted(WORKSPACE_TOOLS))],
        allow_blank=True,
    )
    layout = serializers.JSONField(required=False, default=dict)
    open_tabs = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
        max_length=8,
    )


class AnnotationMutationSerializer(StrictSerializer):
    id = serializers.UUIDField()
    page_number = serializers.IntegerField(min_value=1, max_value=10_000)
    tool = serializers.ChoiceField(choices=sorted(FOCUS_TOOLS))
    layer_key = serializers.RegexField(
        regex=r"^[a-z0-9][a-z0-9._-]{0,63}$",
        required=False,
        default="personal",
    )
    bounds = serializers.JSONField()
    payload = serializers.JSONField()
    color = serializers.RegexField(regex=r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
    thickness = serializers.DecimalField(
        max_digits=6,
        decimal_places=2,
        min_value=Decimal("0.01"),
        max_value=Decimal("64.00"),
    )
    opacity = serializers.DecimalField(
        max_digits=4,
        decimal_places=3,
        min_value=Decimal("0"),
        max_value=Decimal("1"),
    )


class AnnotationSyncSerializer(StrictSerializer):
    expected_collection_revision = serializers.IntegerField(min_value=0)
    idempotency_key = serializers.UUIDField()
    annotations = AnnotationMutationSerializer(many=True, required=False, default=list)
    deleted_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
        max_length=100,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        annotations = attrs.get("annotations", [])
        deleted_ids = attrs.get("deleted_ids", [])
        if len(annotations) + len(deleted_ids) > 100:
            raise serializers.ValidationError("A Focus sync can contain at most 100 mutations.")
        return attrs
