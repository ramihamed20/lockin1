from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer


class QuestionImportValidateSerializer(StrictSerializer):
    payload = serializers.JSONField()


class QuestionImportCommitSerializer(QuestionImportValidateSerializer):
    publish = serializers.BooleanField(default=False)


class QuestionBulkActionSerializer(StrictSerializer):
    question_ids = serializers.ListField(
        child=serializers.UUIDField(),
        min_length=1,
        max_length=200,
    )
    action = serializers.ChoiceField(
        choices=("publish", "unpublish", "archive", "delete", "move")
    )
    target_sheet_id = serializers.UUIDField(allow_null=True, required=False, default=None)

    def validate_question_ids(self, value):  # type: ignore[no-untyped-def]
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Question identifiers must be unique.")
        return value

    def validate(self, attrs):  # type: ignore[no-untyped-def]
        if attrs["action"] == "move" and attrs.get("target_sheet_id") is None:
            raise serializers.ValidationError({"target_sheet_id": "A target sheet is required."})
        return attrs


class QuestionImportUndoSerializer(StrictSerializer):
    confirmation = serializers.CharField(max_length=80, trim_whitespace=True)
