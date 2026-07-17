from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import Question, QuestionOption, QuestionVersion


class QuestionOptionManagementSerializer(serializers.ModelSerializer[QuestionOption]):
    class Meta:
        model = QuestionOption
        fields = ("id", "text", "position", "is_correct")
        read_only_fields = fields


class QuestionVersionManagementSerializer(serializers.ModelSerializer[QuestionVersion]):
    academic_node_id = serializers.UUIDField(read_only=True)
    academic_node_title = serializers.CharField(source="academic_node.title", read_only=True)
    options = QuestionOptionManagementSerializer(many=True, read_only=True)

    class Meta:
        model = QuestionVersion
        fields = (
            "id",
            "version_number",
            "academic_node_id",
            "academic_node_title",
            "question_type",
            "prompt",
            "explanation",
            "difficulty",
            "language",
            "metadata",
            "options",
            "created_at",
        )
        read_only_fields = fields


class QuestionManagementSerializer(serializers.ModelSerializer[Question]):
    owner_name = serializers.CharField(source="owner.full_name", read_only=True)
    owner_email = serializers.EmailField(source="owner.email", read_only=True)
    current_version = QuestionVersionManagementSerializer(read_only=True)
    published_version_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = Question
        fields = (
            "id",
            "owner",
            "owner_name",
            "owner_email",
            "current_version",
            "published_version_id",
            "workflow_status",
            "review_note",
            "revision",
            "published_at",
            "retired_at",
            "updated_at",
        )
        read_only_fields = fields


class QuestionOptionWriteSerializer(StrictSerializer):
    text = serializers.CharField(max_length=2000, trim_whitespace=True)
    is_correct = serializers.BooleanField(default=False)


class QuestionWriteSerializer(StrictSerializer):
    academic_node_id = serializers.UUIDField()
    question_type = serializers.ChoiceField(choices=QuestionVersion.QuestionType.choices)
    prompt = serializers.CharField(max_length=10_000, trim_whitespace=True)
    explanation = serializers.CharField(
        max_length=10_000,
        trim_whitespace=True,
        required=False,
        default="",
    )
    difficulty = serializers.ChoiceField(
        choices=QuestionVersion.Difficulty.choices,
        default=QuestionVersion.Difficulty.MEDIUM,
    )
    language = serializers.CharField(max_length=12, default="en")
    metadata = serializers.JSONField(required=False, default=dict)
    options = QuestionOptionWriteSerializer(many=True)

    def validate_metadata(self, value: Any) -> dict[str, object]:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Metadata must be an object.")
        return value

    def validate_options(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not 2 <= len(value) <= 12:
            raise serializers.ValidationError("Provide between 2 and 12 answer options.")
        return value


class QuestionUpdateSerializer(QuestionWriteSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class RevisionActionSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class RejectQuestionSerializer(RevisionActionSerializer):
    review_note = serializers.CharField(max_length=4000, trim_whitespace=True)
