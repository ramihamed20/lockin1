from typing import Any, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from platform_core.api.serializers import StrictSerializer

from .reminders import get_reminder, save_reminder


class ReminderSettingsSerializer(StrictSerializer):
    enabled = serializers.BooleanField()
    time = serializers.TimeField(input_formats=["%H:%M"])
    timezone = serializers.CharField(max_length=64)
    locale = serializers.ChoiceField(choices=("ar", "en"))
    weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        min_length=1,
        max_length=7,
        required=False,
    )
    study_enabled = serializers.BooleanField(required=False)
    review_enabled = serializers.BooleanField(required=False)
    weekly_enabled = serializers.BooleanField(required=False)
    weekly_day = serializers.IntegerField(min_value=0, max_value=6, required=False)
    skip_if_studied = serializers.BooleanField(required=False)
    quiet_enabled = serializers.BooleanField(required=False)
    quiet_start = serializers.TimeField(input_formats=["%H:%M"], required=False)
    quiet_end = serializers.TimeField(input_formats=["%H:%M"], required=False)
    push_preview = serializers.BooleanField(required=False)

    def validate_weekdays(self, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Choose each weekday once.")
        return sorted(value)

    def validate_timezone(self, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise serializers.ValidationError("Choose a valid timezone.") from error
        return value


class ReminderSerializer(ReminderSettingsSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    pause_hours = serializers.ChoiceField(choices=(0, 24, 168), required=False)


class ReminderResponseSerializer(ReminderSettingsSerializer):
    revision = serializers.IntegerField(read_only=True)
    next_due_at = serializers.DateTimeField(read_only=True, allow_null=True)
    paused_until = serializers.DateTimeField(read_only=True, allow_null=True)


class StudyReminderView(APIView):
    @extend_schema(responses=ReminderResponseSerializer)
    def get(self, request: Request) -> Response:
        return Response(get_reminder(cast(User, request.user)))

    @extend_schema(request=ReminderSerializer, responses=ReminderResponseSerializer)
    def put(self, request: Request) -> Response:
        serializer = ReminderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: dict[str, Any] = serializer.validated_data
        return Response(save_reminder(cast(User, request.user), data))
