from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import LearningObject, LearningObjectAsset, LearningObjectVersion


class LearningObjectAssetSerializer(serializers.ModelSerializer[LearningObjectAsset]):
    file_id = serializers.UUIDField(source="managed_file.id", read_only=True)
    original_name = serializers.CharField(source="managed_file.original_name", read_only=True)
    content_type = serializers.CharField(source="managed_file.content_type", read_only=True)
    size_bytes = serializers.IntegerField(source="managed_file.size_bytes", read_only=True)
    view_url = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = LearningObjectAsset
        fields = (
            "id",
            "file_id",
            "role",
            "position",
            "original_name",
            "content_type",
            "size_bytes",
            "view_url",
            "download_url",
        )
        read_only_fields = fields

    def get_view_url(self, asset: LearningObjectAsset) -> str:
        return f"/api/v1/files/{asset.managed_file_id}/view"

    def get_download_url(self, asset: LearningObjectAsset) -> str | None:
        return (
            f"/api/v1/files/{asset.managed_file_id}/download"
            if asset.version.allow_download
            else None
        )


class LearningObjectVersionSerializer(serializers.ModelSerializer[LearningObjectVersion]):
    academic_node_id = serializers.UUIDField(read_only=True)
    academic_node_title = serializers.CharField(source="academic_node.title", read_only=True)
    assets = LearningObjectAssetSerializer(many=True, read_only=True)
    focus_context = serializers.SerializerMethodField()

    class Meta:
        model = LearningObjectVersion
        fields = (
            "id",
            "version_number",
            "academic_node_id",
            "academic_node_title",
            "content_type",
            "title",
            "summary",
            "language",
            "allow_download",
            "metadata",
            "available_from",
            "available_until",
            "assets",
            "focus_context",
            "created_at",
        )
        read_only_fields = fields

    def get_focus_context(self, version: LearningObjectVersion) -> dict[str, str] | None:
        if version.content_type != LearningObjectVersion.ContentType.PDF:
            return None
        return {"context_type": "study", "context_id": str(version.id)}


class PublicLearningObjectSerializer(serializers.ModelSerializer[LearningObject]):
    version = serializers.SerializerMethodField()
    is_bookmarked = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    class Meta:
        model = LearningObject
        fields = ("id", "version", "published_at", "is_bookmarked", "progress")
        read_only_fields = fields

    def get_version(self, learning_object: LearningObject) -> dict[str, Any] | None:
        version = learning_object.published_version
        return LearningObjectVersionSerializer(version).data if version is not None else None

    def get_is_bookmarked(self, learning_object: LearningObject) -> bool:
        bookmarked_ids = self.context.get("bookmarked_ids", set())
        return learning_object.id in bookmarked_ids

    def get_progress(self, learning_object: LearningObject) -> dict[str, Any] | None:
        progress_by_content = self.context.get("progress_by_content", {})
        progress = progress_by_content.get(learning_object.id)
        if progress is None:
            return None
        return {
            "status": progress.status,
            "completion_percent": progress.completion_percent,
            "position": progress.position,
            "revision": progress.revision,
            "updated_at": progress.updated_at,
        }


class ManagementLearningObjectSerializer(serializers.ModelSerializer[LearningObject]):
    owner_name = serializers.CharField(source="owner.full_name", read_only=True)
    owner_email = serializers.EmailField(source="owner.email", read_only=True)
    current_version = LearningObjectVersionSerializer(read_only=True)
    published_version_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = LearningObject
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
            "archived_at",
            "updated_at",
        )
        read_only_fields = fields


class LearningObjectWriteSerializer(StrictSerializer):
    academic_node_id = serializers.UUIDField()
    content_type = serializers.ChoiceField(choices=LearningObjectVersion.ContentType.choices)
    title = serializers.CharField(max_length=220, trim_whitespace=True)
    summary = serializers.CharField(max_length=6000, trim_whitespace=True, required=False)
    language = serializers.CharField(max_length=12, default="en")
    allow_download = serializers.BooleanField(default=False)
    metadata = serializers.JSONField(required=False, default=dict)
    available_from = serializers.DateTimeField(allow_null=True, required=False)
    available_until = serializers.DateTimeField(allow_null=True, required=False)
    primary_file_id = serializers.UUIDField(allow_null=True, required=False)


class LearningObjectUpdateSerializer(LearningObjectWriteSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class RevisionActionSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class RejectActionSerializer(RevisionActionSerializer):
    review_note = serializers.CharField(max_length=4000, trim_whitespace=True)


class TransferActionSerializer(RevisionActionSerializer):
    owner_id = serializers.UUIDField()
