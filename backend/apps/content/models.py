import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q

from apps.education.models import EducationNode
from apps.files.models import ManagedFile


class LearningObject(models.Model):
    class WorkflowStatus(models.TextChoices):
        DRAFT = "draft", "Draft"
        IN_REVIEW = "in_review", "In review"
        PUBLISHED = "published", "Published"
        REJECTED = "rejected", "Rejected"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_learning_objects",
    )
    current_version = models.ForeignKey(
        "LearningObjectVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="current_for",
    )
    published_version = models.ForeignKey(
        "LearningObjectVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="published_for",
    )
    workflow_status = models.CharField(
        max_length=16,
        choices=WorkflowStatus.choices,
        default=WorkflowStatus.DRAFT,
    )
    review_note = models.TextField(blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    published_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "id")
        indexes = [
            models.Index(
                fields=("owner", "workflow_status", "-updated_at"), name="content_owner_flow_idx"
            ),
            models.Index(fields=("archived_at", "-published_at"), name="content_publication_idx"),
        ]

    def __str__(self) -> str:
        version = self.current_version
        if version is not None:
            return version.title
        return str(self.id)


class LearningObjectVersion(models.Model):
    class ContentType(models.TextChoices):
        PDF = "pdf", "PDF document"
        AUDIO = "audio", "Audio"
        VIDEO = "video", "Video metadata"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    learning_object = models.ForeignKey(
        LearningObject,
        on_delete=models.PROTECT,
        related_name="versions",
    )
    version_number = models.PositiveIntegerField()
    academic_node = models.ForeignKey(
        EducationNode,
        on_delete=models.PROTECT,
        related_name="learning_object_versions",
    )
    content_type = models.CharField(max_length=32, choices=ContentType.choices)
    title = models.CharField(max_length=220)
    summary = models.TextField(blank=True)
    language = models.CharField(max_length=12, default="en")
    allow_download = models.BooleanField(default=False)
    metadata = models.JSONField(default=dict, blank=True)
    available_from = models.DateTimeField(null=True, blank=True)
    available_until = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_learning_object_versions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-version_number",)
        constraints = [
            models.UniqueConstraint(
                fields=("learning_object", "version_number"),
                name="content_version_number_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(available_from__isnull=True)
                    | Q(available_until__isnull=True)
                    | Q(available_until__gt=F("available_from"))
                ),
                name="content_availability_order",
            ),
        ]
        indexes = [
            models.Index(
                fields=("academic_node", "content_type", "-created_at"),
                name="content_node_type_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.title} v{self.version_number}"


class LearningObjectAsset(models.Model):
    class Role(models.TextChoices):
        PRIMARY = "primary", "Primary file"
        TRANSCRIPT = "transcript", "Transcript"
        CAPTION = "caption", "Caption"
        COVER = "cover", "Cover"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    version = models.ForeignKey(
        LearningObjectVersion,
        on_delete=models.PROTECT,
        related_name="assets",
    )
    managed_file = models.ForeignKey(
        ManagedFile,
        on_delete=models.PROTECT,
        related_name="learning_object_assets",
    )
    role = models.CharField(max_length=16, choices=Role.choices)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ("role", "position", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("version", "role", "position"),
                name="content_asset_position_unique",
            )
        ]
        indexes = [models.Index(fields=("managed_file", "role"), name="content_file_role_idx")]

    def __str__(self) -> str:
        return f"{self.version_id}:{self.role}"
