from typing import Any

from rest_framework import serializers

from .models import OperationalActionRun


class ActionPreviewRequestSerializer(serializers.Serializer[dict[str, Any]]):
    action_code = serializers.CharField(max_length=80)
    payload = serializers.JSONField()
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)
    idempotency_key = serializers.CharField(min_length=8, max_length=100)


class ActionExecuteSerializer(serializers.Serializer[dict[str, Any]]):
    confirmation_token = serializers.CharField(min_length=32, max_length=100, trim_whitespace=False)


class OperationalActionRunSerializer(serializers.ModelSerializer[OperationalActionRun]):
    class Meta:
        model = OperationalActionRun
        fields = (
            "id",
            "action_code",
            "reason",
            "payload",
            "preview",
            "result_summary",
            "status",
            "expires_at",
            "created_at",
            "completed_at",
        )
        read_only_fields = fields
