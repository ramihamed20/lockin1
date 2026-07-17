from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import CreatorScope, EducationNode


class EducationNodeSerializer(serializers.ModelSerializer[EducationNode]):
    parent_id = serializers.UUIDField(allow_null=True, read_only=True)

    class Meta:
        model = EducationNode
        fields = (
            "id",
            "parent_id",
            "kind",
            "title",
            "slug",
            "description",
            "position",
            "path",
            "depth",
            "status",
            "is_discoverable",
            "revision",
            "updated_at",
        )
        read_only_fields = fields


class EducationNodeCreateSerializer(StrictSerializer):
    parent_id = serializers.UUIDField(allow_null=True, required=False, default=None)
    kind = serializers.ChoiceField(choices=EducationNode.Kind.choices)
    title = serializers.CharField(max_length=180, trim_whitespace=True)
    slug = serializers.CharField(max_length=180, trim_whitespace=True, required=False)
    description = serializers.CharField(max_length=4000, trim_whitespace=True, required=False)
    position = serializers.IntegerField(min_value=0, max_value=1_000_000, default=0)


class EducationNodeUpdateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    title = serializers.CharField(max_length=180, trim_whitespace=True, required=False)
    slug = serializers.CharField(max_length=180, trim_whitespace=True, required=False)
    description = serializers.CharField(max_length=4000, trim_whitespace=True, required=False)
    position = serializers.IntegerField(
        min_value=0,
        max_value=1_000_000,
        required=False,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if len(attrs) == 1:
            raise serializers.ValidationError("Provide at least one field to update.")
        return attrs


class EducationNodeMoveSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    parent_id = serializers.UUIDField(allow_null=True)
    position = serializers.IntegerField(min_value=0, max_value=1_000_000, default=0)


class EducationNodeStatusSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    status = serializers.ChoiceField(
        choices=(EducationNode.Status.PUBLISHED, EducationNode.Status.ARCHIVED)
    )


class CreatorScopeSerializer(serializers.ModelSerializer[CreatorScope]):
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    node_title = serializers.CharField(source="node.title", read_only=True)

    class Meta:
        model = CreatorScope
        fields = (
            "id",
            "user",
            "user_name",
            "user_email",
            "node",
            "node_title",
            "can_create_content",
            "can_review_content",
            "can_publish_content",
            "can_manage_hierarchy",
            "updated_at",
        )
        read_only_fields = fields


class CreatorScopeWriteSerializer(StrictSerializer):
    user_id = serializers.UUIDField()
    node_id = serializers.UUIDField()
    can_create_content = serializers.BooleanField(default=True)
    can_review_content = serializers.BooleanField(default=False)
    can_publish_content = serializers.BooleanField(default=False)
    can_manage_hierarchy = serializers.BooleanField(default=False)
