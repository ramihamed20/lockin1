import uuid

from django.conf import settings
from django.db import models

from apps.education.models import EducationNode


class Question(models.Model):
    class WorkflowStatus(models.TextChoices):
        DRAFT = "draft", "Draft"
        IN_REVIEW = "in_review", "In review"
        PUBLISHED = "published", "Published"
        REJECTED = "rejected", "Rejected"
        RETIRED = "retired", "Retired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_questions",
    )
    import_batch = models.ForeignKey(
        "QuestionImportBatch",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="questions",
    )
    current_version = models.ForeignKey(
        "QuestionVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="current_for",
    )
    published_version = models.ForeignKey(
        "QuestionVersion",
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
    retired_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "id")
        indexes = [
            models.Index(
                fields=("owner", "workflow_status", "-updated_at"),
                name="question_owner_flow_idx",
            ),
            models.Index(
                fields=("workflow_status", "-published_at"),
                name="question_publication_idx",
            ),
        ]

    def __str__(self) -> str:
        version = self.current_version
        return version.prompt[:80] if version is not None else str(self.id)


class QuestionVersion(models.Model):
    class QuestionType(models.TextChoices):
        SINGLE_CHOICE = "single_choice", "Single choice"
        TRUE_FALSE = "true_false", "True or false"
        COMPLETION_CHOICE = "completion_choice", "Completion from choices"
        MULTIPLE_SELECT = "multiple_select", "Multiple select"

    class Difficulty(models.TextChoices):
        EASY = "easy", "Easy"
        MEDIUM = "medium", "Medium"
        HARD = "hard", "Hard"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question = models.ForeignKey(Question, on_delete=models.PROTECT, related_name="versions")
    version_number = models.PositiveIntegerField()
    academic_node = models.ForeignKey(
        EducationNode,
        on_delete=models.PROTECT,
        related_name="question_versions",
    )
    source_learning_object = models.ForeignKey(
        "content.LearningObject",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="question_versions",
    )
    question_type = models.CharField(max_length=24, choices=QuestionType.choices)
    prompt = models.TextField()
    explanation = models.TextField(blank=True)
    topic = models.CharField(max_length=220, blank=True)
    source_page = models.PositiveIntegerField(null=True, blank=True)
    difficulty = models.CharField(
        max_length=12,
        choices=Difficulty.choices,
        default=Difficulty.MEDIUM,
    )
    language = models.CharField(max_length=12, default="en")
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_question_versions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-version_number",)
        constraints = [
            models.UniqueConstraint(
                fields=("question", "version_number"),
                name="question_version_number_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("academic_node", "difficulty", "question_type"),
                name="question_scope_filter_idx",
            ),
            models.Index(
                fields=("source_learning_object", "question_type"),
                name="question_sheet_type_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.question_id}:v{self.version_number}"


class QuestionOption(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    version = models.ForeignKey(
        QuestionVersion,
        on_delete=models.PROTECT,
        related_name="options",
    )
    text = models.TextField()
    position = models.PositiveSmallIntegerField()
    is_correct = models.BooleanField(default=False)

    class Meta:
        ordering = ("position", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("version", "position"),
                name="question_option_position_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.version_id}:{self.position}"


class QuestionImportBatch(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Imported as draft"
        PUBLISHED = "published", "Imported and published"
        UNDONE = "undone", "Undone"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="question_import_batches",
    )
    academic_node = models.ForeignKey(
        EducationNode,
        on_delete=models.PROTECT,
        related_name="question_import_batches",
    )
    sheet = models.ForeignKey(
        "content.LearningObject",
        on_delete=models.PROTECT,
        related_name="question_import_batches",
    )
    schema_version = models.CharField(max_length=40)
    status = models.CharField(max_length=16, choices=Status.choices)
    question_count = models.PositiveIntegerField()
    type_counts = models.JSONField(default=dict)
    warnings = models.JSONField(default=list, blank=True)
    undone_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="undone_question_import_batches",
    )
    undone_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("sheet", "-created_at"), name="question_import_sheet_idx"),
            models.Index(fields=("status", "-created_at"), name="question_import_status_idx"),
        ]

    def __str__(self) -> str:
        return f"question_import_{self.id}"
