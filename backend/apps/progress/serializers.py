from rest_framework import serializers

from apps.content.models import LearningObjectVersion
from apps.content.serializers import PublicLearningObjectSerializer
from platform_core.api.serializers import StrictSerializer

from .models import Bookmark, LearningProgress


class BookmarkSerializer(serializers.ModelSerializer[Bookmark]):
    learning_object = PublicLearningObjectSerializer(read_only=True)

    class Meta:
        model = Bookmark
        fields = (
            "id",
            "learning_object",
            "catalog_material_slug",
            "catalog_material_title",
            "catalog_sheet_slug",
            "catalog_sheet_title",
            "position",
            "created_at",
        )
        read_only_fields = fields


class BookmarkCreateSerializer(StrictSerializer):
    learning_object_id = serializers.UUIDField(required=False)
    catalog_material_slug = serializers.RegexField(
        r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64, required=False
    )
    catalog_material_title = serializers.CharField(max_length=160, required=False)
    catalog_sheet_slug = serializers.RegexField(
        r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64, required=False
    )
    catalog_sheet_title = serializers.CharField(max_length=240, required=False)
    position = serializers.JSONField(default=dict)

    def validate_position(self, value: object) -> dict[str, object]:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Bookmark position must be an object.")
        return value

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        learning_target = "learning_object_id" in attrs
        catalog_fields = (
            "catalog_material_slug",
            "catalog_material_title",
            "catalog_sheet_slug",
            "catalog_sheet_title",
        )
        catalog_target = any(field in attrs for field in catalog_fields)
        if learning_target == catalog_target:
            raise serializers.ValidationError("Choose exactly one bookmark target.")
        catalog_complete = all(str(attrs.get(field, "")).strip() for field in catalog_fields)
        if catalog_target and not catalog_complete:
            raise serializers.ValidationError(
                "Catalog bookmarks require material and sheet details."
            )
        return attrs


class LearningProgressSerializer(serializers.ModelSerializer[LearningProgress]):
    learning_object_id = serializers.UUIDField(read_only=True)
    version_id = serializers.UUIDField(read_only=True)
    focus_document_version_id = serializers.SerializerMethodField()

    class Meta:
        model = LearningProgress
        fields = (
            "id",
            "learning_object_id",
            "version_id",
            "focus_document_version_id",
            "status",
            "completion_percent",
            "position",
            "revision",
            "completed_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_focus_document_version_id(self, progress: LearningProgress) -> str | None:
        if progress.version.content_type != LearningObjectVersion.ContentType.PDF:
            return None
        return str(progress.version_id)


class LearningProgressUpdateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    status = serializers.ChoiceField(choices=LearningProgress.Status.choices)
    completion_percent = serializers.IntegerField(min_value=0, max_value=100)
    position = serializers.JSONField(default=dict)


class LessonCompleteSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
