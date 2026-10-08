import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower

from apps.education.models import EducationNode, StudentCohort
from apps.files.models import ManagedFile

from .editions import UNIVERSITY


class CatalogSubject(models.Model):
    """A flat, cohort-owned Catalog branch exposed by Materials and Content Studio."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cohort = models.ForeignKey(
        StudentCohort,
        on_delete=models.PROTECT,
        related_name="catalog_subjects",
    )
    source_node = models.OneToOneField(
        EducationNode,
        on_delete=models.PROTECT,
        related_name="catalog_subject",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=180)
    slug = models.SlugField(max_length=180)
    # This is the public Materials route key.  It is cohort-qualified so a
    # repeated subject title can never accidentally resolve to another college.
    material_slug = models.SlugField(max_length=240, unique=True)
    position = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("cohort__position", "position", "title", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("cohort", "slug"),
                name="catalog_subject_cohort_slug_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.cohort}: {self.title}"


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
    position = models.PositiveIntegerField(default=0)
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
            models.Index(fields=("position", "updated_at"), name="content_position_idx"),
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
    page_count = models.PositiveIntegerField(null=True, blank=True)
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
        SUMMARY = "summary", "Sheet summary PDF"
        # The Lock-in edition's own PDF and summary. Separate roles, identical
        # handling: publication, access policy and delivery treat them exactly
        # as they treat the university file.
        LOCKIN_PRIMARY = "lockin_primary", "Lock-in edition PDF"
        LOCKIN_SUMMARY = "lockin_summary", "Lock-in edition summary PDF"
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


class CatalogDocument(models.Model):
    """Authoritative catalog alias for one immutable published PDF version."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    material_slug = models.SlugField(max_length=120)
    sheet_slug = models.SlugField(max_length=120)
    version = models.ForeignKey(
        LearningObjectVersion, on_delete=models.PROTECT, related_name="catalog_documents"
    )
    edition = models.CharField(max_length=16, default=UNIVERSITY)
    managed_file = models.ForeignKey(
        ManagedFile, on_delete=models.PROTECT, related_name="catalog_documents"
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("material_slug", "sheet_slug"), name="content_catalog_alias_unique"
            ),
            models.UniqueConstraint(
                fields=("version", "edition"), name="content_catalog_version_edition_unique"
            ),
        ]
        indexes = [
            models.Index(
                fields=("material_slug", "sheet_slug", "is_active"),
                name="content_catalog_lookup_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.material_slug}/{self.sheet_slug}:{self.edition} -> {self.version_id}"


class CatalogWorkspaceSnapshot(models.Model):
    """User-owned durable reader state; annotation bytes remain in Focus collections."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="catalog_workspaces"
    )
    document = models.ForeignKey(
        CatalogDocument, on_delete=models.CASCADE, related_name="workspaces"
    )
    state = models.JSONField(default=dict, blank=True)
    revision = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "document"), name="content_catalog_workspace_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.document_id}:{self.revision}"


class CatalogWorkspaceReceipt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        CatalogWorkspaceSnapshot, on_delete=models.CASCADE, related_name="receipts"
    )
    idempotency_key = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    response_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("workspace", "idempotency_key"), name="content_catalog_receipt_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.workspace_id}:{self.idempotency_key}"


class ActiveStudySettings(models.Model):
    """Durable configuration for future Active Study question/template content."""

    sheet = models.ForeignKey(
        LearningObject,
        on_delete=models.CASCADE,
        related_name="active_study_settings_set",
    )
    edition = models.CharField(max_length=16, default=UNIVERSITY)
    enabled = models.BooleanField(default=False)
    total_pdf_pages = models.PositiveIntegerField(null=True, blank=True)
    source_version = models.ForeignKey(
        LearningObjectVersion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="active_study_settings_sources",
    )
    page_count_verified_at = models.DateTimeField(null=True, blank=True)
    excluded_start_pages = models.PositiveIntegerField(default=0)
    excluded_end_pages = models.PositiveIntegerField(default=0)
    questions_per_checkpoint = models.PositiveIntegerField(default=15)
    final_exam_questions = models.PositiveIntegerField(default=50)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("sheet", "edition"), name="content_active_sheet_edition_unique"
            )
        ]
        indexes = [models.Index(fields=("enabled",), name="content_active_enabled_idx")]

    def __str__(self) -> str:
        return f"{self.sheet_id}:{self.edition}:active-study"


class ActiveStudyQuestionContent(models.Model):
    """One ordered, validated JSON document per sheet and Active Study difficulty."""

    class Difficulty(models.TextChoices):
        EASY = "easy", "Easy"
        MEDIUM = "medium", "Medium"
        HARD = "hard", "Hard"

    sheet = models.ForeignKey(
        LearningObject,
        on_delete=models.CASCADE,
        related_name="active_study_question_content",
    )
    difficulty = models.CharField(max_length=12, choices=Difficulty.choices)
    payload = models.JSONField()
    # Captures the server-computed part/page boundaries at import time.
    plan_signature = models.JSONField()
    source_version = models.ForeignKey(
        LearningObjectVersion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="active_study_question_sources",
    )
    checkpoint_question_count = models.PositiveIntegerField()
    final_exam_question_count = models.PositiveIntegerField()
    revision = models.PositiveBigIntegerField(default=1)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_active_study_question_content",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="updated_active_study_question_content",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("sheet", "difficulty"),
                name="active_study_content_sheet_difficulty_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("sheet", "difficulty"),
                name="content_active_q_scope_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.sheet_id}:{self.difficulty}:active-study-questions"


class PersonalSheet(models.Model):
    """A PDF a student added to one of their own subjects, visible only to them."""

    class ActiveStudyStatus(models.TextChoices):
        # Personal sheets have no generated questions yet. The status is stored
        # so enabling Active Study later is a state change, not a schema change.
        UNAVAILABLE = "unavailable", "Not available"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="personal_sheets",
    )
    subject = models.ForeignKey(
        CatalogSubject,
        on_delete=models.PROTECT,
        related_name="personal_sheets",
    )
    managed_file = models.OneToOneField(
        ManagedFile,
        on_delete=models.PROTECT,
        related_name="personal_sheet",
    )
    title = models.CharField(max_length=120)
    page_count = models.PositiveIntegerField(null=True, blank=True)
    active_study_status = models.CharField(
        max_length=24,
        choices=ActiveStudyStatus.choices,
        default=ActiveStudyStatus.UNAVAILABLE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                Lower("title"),
                "owner",
                "subject",
                name="personal_sheet_owner_subject_title_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("owner", "subject", "-created_at"),
                name="content_personal_sheet_idx",
            )
        ]

    def __str__(self) -> str:
        return self.title


class PersonalSheetWorkspace(models.Model):
    """Reader state for a personal sheet; its ink lives in a Focus annotation collection."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sheet = models.OneToOneField(PersonalSheet, on_delete=models.CASCADE, related_name="workspace")
    state = models.JSONField(default=dict, blank=True)
    revision = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.sheet_id}:{self.revision}"


class PersonalSheetWorkspaceReceipt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        PersonalSheetWorkspace, on_delete=models.CASCADE, related_name="receipts"
    )
    idempotency_key = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    response_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("workspace", "idempotency_key"),
                name="content_personal_receipt_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.workspace_id}:{self.idempotency_key}"


class PracticeSet(models.Model):
    """An ordered run of image slides a student names by typing, owned by one subject."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(
        CatalogSubject,
        on_delete=models.PROTECT,
        related_name="practice_sets",
    )
    title = models.CharField(max_length=120)
    is_published = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                Lower("title"),
                "subject",
                name="content_practice_set_title_unique",
            )
        ]

    def __str__(self) -> str:
        return self.title


class PracticeSlide(models.Model):
    """One image and the name that must be typed for it, in the set's order."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    practice_set = models.ForeignKey(
        PracticeSet,
        on_delete=models.CASCADE,
        related_name="slides",
    )
    managed_file = models.OneToOneField(
        ManagedFile,
        on_delete=models.PROTECT,
        related_name="practice_slide",
    )
    position = models.PositiveIntegerField(default=0)
    answer = models.CharField(max_length=200, blank=True)
    # Where on the image the question points, as a fraction of its width and height.
    hotspot_x = models.FloatField(null=True, blank=True)
    hotspot_y = models.FloatField(null=True, blank=True)
    hotspot_shape = models.CharField(max_length=10, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position", "created_at", "id")
        indexes = [
            models.Index(fields=("practice_set", "position"), name="content_practice_slide_pos")
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(hotspot_x__isnull=True, hotspot_y__isnull=True, hotspot_shape="")
                    | Q(
                        hotspot_x__gte=0,
                        hotspot_x__lte=1,
                        hotspot_y__gte=0,
                        hotspot_y__lte=1,
                        hotspot_shape__in=("circle", "arrow"),
                    )
                ),
                name="content_practice_slide_hotspot_valid",
            )
        ]

    def __str__(self) -> str:
        return f"{self.practice_set_id}:{self.position}"


class PracticeSlideProgress(models.Model):
    """What one student has done with one slide, which drives review and stats."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="practice_progress",
    )
    slide = models.ForeignKey(
        PracticeSlide,
        on_delete=models.CASCADE,
        related_name="progress",
    )
    attempts = models.PositiveIntegerField(default=0)
    miss_count = models.PositiveIntegerField(default=0)
    # Consecutive clean answers; a miss resets it and a hinted answer keeps it.
    streak = models.PositiveSmallIntegerField(default=0)
    last_correct = models.BooleanField(default=False)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    # A first-letter hint was shown and the next check has not been made yet.
    hint_pending = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("user", "slide"), name="content_practice_progress_once")
        ]
        indexes = [models.Index(fields=("user", "due_at"), name="content_practice_prog_due")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.slide_id}"
