from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import StudyPlanItem


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
    }
