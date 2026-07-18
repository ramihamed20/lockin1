from decimal import Decimal
from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import FocusSession, FocusWorkspaceSnapshot
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
