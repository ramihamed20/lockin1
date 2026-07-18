from typing import Any

from rest_framework import serializers

from .models import ReportExport


class ReportPreviewRequestSerializer(serializers.Serializer[dict[str, Any]]):
    report_code = serializers.CharField(max_length=60)
    filters = serializers.JSONField(required=False, default=dict)


class ReportExecuteSerializer(serializers.Serializer[dict[str, Any]]):
    confirmation_token = serializers.CharField(min_length=32, max_length=100, trim_whitespace=False)


class ReportExportSerializer(serializers.ModelSerializer[ReportExport]):
    class Meta:
        model = ReportExport
        fields = (
            "id",
            "report_code",
            "status",
            "filters",
            "estimated_rows",
            "row_count",
            "truncated",
            "expires_at",
            "created_at",
            "completed_at",
        )
        read_only_fields = fields
