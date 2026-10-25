from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import StudyPlanItem, StudyPlanProfile


class StudyPlanRangeSerializer(StrictSerializer):
    from_date = serializers.DateField(source="from", required=True)
    to_date = serializers.DateField(source="to", required=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        start = attrs["from"]
        end = attrs["to"]
        if end < start:
            raise serializers.ValidationError(
                {"to": "The end date must be on or after the start date."}
            )
        if (end - start).days > 41:
            raise serializers.ValidationError({"to": "A study-plan range cannot exceed 42 days."})
        return attrs


class StudyPlanItemWriteSerializer(StrictSerializer):
    client_request_id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=180, trim_whitespace=True)
    subject = serializers.CharField(
        max_length=120,
        trim_whitespace=True,
        allow_blank=True,
        required=False,
        default="",
    )
    scheduled_date = serializers.DateField()
    duration_minutes = serializers.IntegerField(min_value=5, max_value=480)


class StudyPlanItemUpdateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1, required=False)
    title = serializers.CharField(max_length=180, trim_whitespace=True, required=False)
    subject = serializers.CharField(
        max_length=120, trim_whitespace=True, allow_blank=True, required=False
    )
    scheduled_date = serializers.DateField(required=False)
    duration_minutes = serializers.IntegerField(min_value=5, max_value=480, required=False)
    status = serializers.ChoiceField(choices=StudyPlanItem.Status.choices, required=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs:
            raise serializers.ValidationError(
                {"non_field_errors": ["Provide at least one field to update."]}
            )
        return attrs


def study_plan_item_payload(item: StudyPlanItem) -> dict[str, object]:
    return {
        "id": item.id,
        "title": item.title,
        "subject": item.subject,
        "scheduled_date": item.scheduled_date,
        "duration_minutes": item.duration_minutes,
        "status": item.status,
        "completed_at": item.completed_at,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "revision": item.revision,
        "generated": item.generated_slot is not None,
        "plan_mode": item.plan_mode,
    }


class StudyPlanProfileWriteSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    mode = serializers.ChoiceField(choices=StudyPlanProfile.Mode.choices)
    daily_minutes = serializers.IntegerField(min_value=10, max_value=240)
    session_minutes = serializers.IntegerField(min_value=10, max_value=120)
    weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6), min_length=1, max_length=7
    )
    subjects = serializers.ListField(
        child=serializers.CharField(max_length=120, trim_whitespace=True), max_length=12
    )
    timezone = serializers.CharField(max_length=80)

    def validate_weekdays(self, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Choose each day once.")
        return sorted(value)

    def validate_subjects(self, value: list[str]) -> list[str]:
        if len({subject.casefold() for subject in value}) != len(value):
            raise serializers.ValidationError("Choose each subject once.")
        return value

    def validate_timezone(self, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise serializers.ValidationError("Choose a valid timezone.") from error
        return value


class StudyPlanPreviewSerializer(StrictSerializer):
    start_date = serializers.DateField()

    def validate_start_date(self, value: Any) -> Any:
        if value.weekday() != 0:
            raise serializers.ValidationError("Choose the Monday that starts this week.")
        return value


class StudyPlanGenerateSerializer(StudyPlanPreviewSerializer):
    preview_token = serializers.RegexField(r"^[a-f0-9]{64}$")


class ReadingPlanPreviewSerializer(StrictSerializer):
    edition = serializers.ChoiceField(choices=("university", "lockin"), default="university")
