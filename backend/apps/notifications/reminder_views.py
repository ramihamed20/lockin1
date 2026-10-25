from typing import Any, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from platform_core.api.serializers import StrictSerializer

from .reminders import get_reminder, save_reminder


class ReminderSerializer(StrictSerializer):
    enabled = serializers.BooleanField()
    time = serializers.TimeField(input_formats=["%H:%M"])
    timezone = serializers.CharField(max_length=64)
    locale = serializers.ChoiceField(choices=("ar", "en"))
    expected_revision = serializers.IntegerField(min_value=0)

    def validate_timezone(self, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise serializers.ValidationError("Choose a valid timezone.") from error
        return value


class StudyReminderView(APIView):
    def get(self, request: Request) -> Response:
        return Response(get_reminder(cast(User, request.user)))

    def put(self, request: Request) -> Response:
        serializer = ReminderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: dict[str, Any] = serializer.validated_data
        return Response(save_reminder(cast(User, request.user), data))
