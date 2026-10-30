from datetime import date
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
    duration_minutes = serializers.IntegerField(min_value=1, max_value=480, required=False)
    pinned = serializers.BooleanField(required=False)
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
        "activity": item.activity,
        "pinned": item.pinned,
        "completed_page_end": item.completed_page_end,
        "priority_reasons": item.priority_reasons,
        "difficulty": item.difficulty,
        "period_id": str(item.planner_run.period_id) if item.planner_run is not None else None,
        "planning_key": item.planning_key,
        "page_start": item.page_start,
        "page_end": item.page_end,
        "start_url": task_start_url(item),
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

    review_minutes = serializers.IntegerField(min_value=1, max_value=15, required=False)
    weekly_minutes = serializers.DictField(
        child=serializers.IntegerField(min_value=0, max_value=240), required=False
    )
    date_minutes = serializers.DictField(
        child=serializers.IntegerField(min_value=0, max_value=240), required=False
    )
    habit_baseline_minutes = serializers.IntegerField(
        min_value=10, max_value=240, allow_null=True, required=False
    )
    habit_block_minutes = serializers.IntegerField(
        min_value=10, max_value=120, allow_null=True, required=False
    )
    study_rhythm = serializers.ChoiceField(
        choices=("mixed", "fragmented", "continuous"), required=False
    )
    gradual_growth = serializers.BooleanField(required=False)

    def validate_weekly_minutes(self, value: dict[str, int]) -> dict[str, int]:
        if any(key not in {str(i) for i in range(7)} for key in value):
            raise serializers.ValidationError("Choose weekdays 0–6.")
        return value

    def validate_date_minutes(self, value: dict[str, int]) -> dict[str, int]:
        if len(value) > 366:
            raise serializers.ValidationError("Use at most 366 day exceptions.")
        for key in value:
            try:
                if date.fromisoformat(key).isoformat() != key:
                    raise ValueError
            except ValueError as error:
                raise serializers.ValidationError("Use dates in YYYY-MM-DD format.") from error
        return value

    def validate_weekdays(self, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Choose each day once.", code="duplicate_day")
        return sorted(value)

    def validate_subjects(self, value: list[str]) -> list[str]:
        if len({subject.casefold() for subject in value}) != len(value):
            raise serializers.ValidationError("Choose each subject once.", code="duplicate_subject")
        return value

    def validate_timezone(self, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise serializers.ValidationError(
                "Choose a valid timezone.", code="invalid_timezone"
            ) from error
        return value


class StudyPlanPreviewSerializer(StrictSerializer):
    start_date = serializers.DateField()

    def validate_start_date(self, value: Any) -> Any:
        if value.weekday() != 0:
            raise serializers.ValidationError(
                "Choose the Monday that starts this week.", code="week_start_required"
            )
        return value


class StudyPlanGenerateSerializer(StudyPlanPreviewSerializer):
    preview_token = serializers.RegexField(r"^[a-f0-9]{64}$")


class ReadingPlanPreviewSerializer(StrictSerializer):
    include_reviews = serializers.BooleanField(default=False)
    include_active_study = serializers.BooleanField(default=False)
    replan = serializers.BooleanField(default=False)
    difficulty = serializers.ChoiceField(choices=("easy", "medium", "hard"), default="medium")
    report_id = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs.get("report_id") and not attrs.get("include_reviews"):
            raise serializers.ValidationError("A report requires review planning.")
        return attrs

    edition = serializers.ChoiceField(choices=("university", "lockin"), default="university")


class PlanApplySerializer(ReadingPlanPreviewSerializer):
    client_request_id = serializers.UUIDField()
    preview_token = serializers.RegexField(r"^[a-f0-9]{64}$")


def task_start_url(item: StudyPlanItem) -> str | None:
    from urllib.parse import quote

    if item.activity == "review" and item.review_item_id:
        review = item.review_item
        if (
            review is not None
            and review.user_id == item.user_id
            and review.state == "active_review"
        ):
            return f"/review/bank/{quote(review.subject_key, safe='')}?item={review.pk}"
    if (
        item.activity in ("reading", "active_study")
        and item.catalog_document_id
        and item.source_file_id
    ):
        doc = item.catalog_document
        if (
            doc
            and doc.is_active
            and doc.version_id == item.content_version_id
            and doc.managed_file_id == item.source_file_id
        ):
            return (
                f"/materials/catalog/{doc.material_slug}/sheets/{doc.sheet_slug}/workspace"
                f"?studyPage={max(item.page_start or 1, (item.completed_page_end or 0) + 1)}"
                f"&studyVersion={item.content_version_id}"
                f"&studyFile={item.source_file_id}"
                + (
                    f"&studyActivity=active_study&studyDifficulty={item.difficulty}"
                    if item.activity == "active_study"
                    else ""
                )
            )
    return None


class ReadingEvidenceSerializer(StrictSerializer):
    client_request_id = serializers.UUIDField()
    version_id = serializers.UUIDField()
    file_id = serializers.UUIDField()
    edition = serializers.ChoiceField(choices=("university", "lockin"))
    page_start = serializers.IntegerField(min_value=1, max_value=10000)
    page_end = serializers.IntegerField(min_value=1, max_value=10000)
    minutes = serializers.IntegerField(min_value=0, max_value=480, default=0)


class TaskProgressSerializer(StrictSerializer):
    client_request_id = serializers.UUIDField()
    expected_revision = serializers.IntegerField(min_value=1)
    page_end = serializers.IntegerField(min_value=1, max_value=10000)
    minutes = serializers.IntegerField(min_value=0, max_value=480, default=0)
