from typing import Any
from uuid import UUID

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import User

from . import rescue
from .rescue_models import RescueSession


class RescueWriteSerializer(serializers.Serializer[Any]):
    account_id = serializers.UUIDField()
    device_mutation_id = serializers.UUIDField()
    expected_revision = serializers.IntegerField(min_value=0)
    catalog_document_id = serializers.UUIDField()
    learning_object_version_id = serializers.UUIDField()
    managed_file_id = serializers.UUIDField()
    edition = serializers.ChoiceField(choices=["university", "lockin"])
    task_type = serializers.ChoiceField(choices=["read", "summary", "explain"])
    page_start = serializers.IntegerField(min_value=1, max_value=10000)
    page_end = serializers.IntegerField(min_value=1, max_value=10000)
    started_at = serializers.DateTimeField(allow_null=True)
    ended_at = serializers.DateTimeField(allow_null=True)
    active_duration_seconds = serializers.IntegerField(min_value=0, max_value=180)
    status = serializers.ChoiceField(choices=RescueSession.Status.values)
    exit_reason = serializers.ChoiceField(
        choices=[
            "",
            "user_pause",
            "background",
            "interrupted",
            "target_reached",
            "user_stop",
            "enough_today",
            "continue",
            "changed_task",
            "workspace_left",
            "source_changed",
            "unavailable",
        ]
    )
    # Continuation in V1 leaves the same reader open; it does not invent a timed session.
    continued_into_study_session_id = serializers.UUIDField(allow_null=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        start, end, status = attrs["started_at"], attrs["ended_at"], attrs["status"]
        if attrs["page_end"] < attrs["page_start"]:
            raise serializers.ValidationError("The source range is invalid.")
        if attrs["continued_into_study_session_id"] is not None:
            raise serializers.ValidationError("V1 continuation keeps the current reader open.")
        if status == "proposed" and (start or end or attrs["active_duration_seconds"]):
            raise serializers.ValidationError("A proposal has no recorded activity.")
        if status in {"active", "paused", "continued", "finished"} and start is None:
            raise serializers.ValidationError("This state needs a start timestamp.")
        if (status in rescue.TERMINAL) != (end is not None):
            raise serializers.ValidationError("Only an ended start has an end timestamp.")
        if end and start and end < start:
            raise serializers.ValidationError("The start must precede its end.")
        if attrs["active_duration_seconds"] and start is None:
            raise serializers.ValidationError("Duration needs a start timestamp.")
        if status == "finished" and (
            attrs["active_duration_seconds"] != 180 or attrs["exit_reason"] != "enough_today"
        ):
            raise serializers.ValidationError(
                "Finished means the target was reached and the student chose to stop."
            )
        if status == "active" and attrs["active_duration_seconds"] >= 180:
            raise serializers.ValidationError("The target already offers a choice.")
        return attrs


class RescueQuerySerializer(serializers.Serializer[Any]):
    document_id = serializers.UUIDField(required=False)
    page = serializers.IntegerField(min_value=1, max_value=10000, required=False)


class RescueThrottle(UserRateThrottle):
    scope = "rescue_write"
    rate = "120/min"


def actor(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


class RescueSuggestionsView(APIView):
    @extend_schema(parameters=[RescueQuerySerializer], responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        query = RescueQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        return Response(
            {
                "activities": rescue.suggestions(
                    actor(request), data.get("document_id"), data.get("page")
                )
            }
        )


class RescueSessionView(APIView):
    throttle_classes = [RescueThrottle]

    @extend_schema(request=RescueWriteSerializer, responses={200: OpenApiTypes.OBJECT})
    def put(self, request: Request, session_id: UUID) -> Response:
        serializer = RescueWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(rescue.save_session(actor(request), session_id, serializer.validated_data))
