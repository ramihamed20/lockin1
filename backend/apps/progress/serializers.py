from rest_framework import serializers

from apps.content.serializers import PublicLearningObjectSerializer
from platform_core.api.serializers import StrictSerializer

from .models import Bookmark, LearningProgress


class BookmarkSerializer(serializers.ModelSerializer[Bookmark]):
    learning_object = PublicLearningObjectSerializer(read_only=True)

    class Meta:
        model = Bookmark
        fields = ("id", "learning_object", "created_at")
        read_only_fields = fields


class BookmarkCreateSerializer(StrictSerializer):
    learning_object_id = serializers.UUIDField()


class LearningProgressSerializer(serializers.ModelSerializer[LearningProgress]):
    learning_object_id = serializers.UUIDField(read_only=True)
    version_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = LearningProgress
        fields = (
            "id",
            "learning_object_id",
            "version_id",
            "status",
            "completion_percent",
            "position",
            "revision",
            "completed_at",
            "updated_at",
        )
        read_only_fields = fields


class LearningProgressUpdateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    status = serializers.ChoiceField(choices=LearningProgress.Status.choices)
    completion_percent = serializers.IntegerField(min_value=0, max_value=100)
    position = serializers.JSONField(default=dict)


class LessonCompleteSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
