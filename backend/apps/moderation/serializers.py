from typing import Any

from rest_framework import serializers

from apps.accounts.models import User
from platform_core.api.serializers import StrictSerializer

from .models import ModerationAuditEntry, Report
from .policies import can_manage_report


class ReportSerializer(serializers.ModelSerializer[Report]):
    reporter_name = serializers.CharField(source="reporter.full_name", read_only=True)
    assigned_to_name = serializers.CharField(
        source="assigned_to.full_name",
        read_only=True,
        allow_null=True,
    )
    duplicate_of_id = serializers.UUIDField(read_only=True, allow_null=True)
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = (
            "id",
            "reporter_id",
            "reporter_name",
            "target_type",
            "target_id",
            "target_label",
            "context_type",
            "context_id",
            "private_space_id",
            "reason",
            "description",
            "status",
            "priority",
            "assigned_to_id",
            "assigned_to_name",
            "duplicate_of_id",
            "resolution_notes",
            "revision",
            "resolved_at",
            "created_at",
            "updated_at",
            "can_manage",
        )
        read_only_fields = fields

    def get_can_manage(self, report: Report) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return isinstance(user, User) and can_manage_report(user=user, report=report)


class ModeratorReportSerializer(ReportSerializer):
    evidence_snapshot = serializers.JSONField(read_only=True)
    target_author_id = serializers.UUIDField(read_only=True, allow_null=True)
    target_version_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta(ReportSerializer.Meta):
        fields = ReportSerializer.Meta.fields + (  # type: ignore[assignment]
            "target_author_id",
            "target_version_id",
            "evidence_snapshot",
        )


class ModerationAuditSerializer(serializers.ModelSerializer[ModerationAuditEntry]):
    actor_name = serializers.CharField(source="actor.full_name", read_only=True)

    class Meta:
        model = ModerationAuditEntry
        fields = (
            "id",
            "report_id",
            "actor_id",
            "actor_name",
            "action",
            "target_type",
            "target_id",
            "reason",
            "metadata",
            "created_at",
        )
        read_only_fields = fields


class ReportWriteSerializer(StrictSerializer):
    target_type = serializers.ChoiceField(choices=Report.TargetType.choices)
    target_id = serializers.UUIDField()
    reason = serializers.ChoiceField(choices=Report.Reason.choices)
    description = serializers.CharField(max_length=4000, trim_whitespace=True)
    client_request_id = serializers.UUIDField()


class ReportAssignSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    assignee_id = serializers.UUIDField()


class ReportTransitionSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    status = serializers.ChoiceField(
        choices=(
            Report.Status.TRIAGED,
            Report.Status.IN_PROGRESS,
            Report.Status.RESOLVED,
            Report.Status.REJECTED,
            Report.Status.DUPLICATE,
        )
    )
    resolution_notes = serializers.CharField(
        max_length=4000,
        trim_whitespace=True,
        required=False,
        default="",
    )
    duplicate_of_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    content_action = serializers.ChoiceField(
        choices=("remove", "restore", "lock", "unlock"),
        required=False,
        allow_null=True,
        default=None,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs.get("status") == Report.Status.DUPLICATE and attrs.get("duplicate_of_id") is None:
            raise serializers.ValidationError(
                {"duplicate_of_id": "Choose the original report for this duplicate."}
            )
        return attrs
