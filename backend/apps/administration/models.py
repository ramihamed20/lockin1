import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector
from django.db import models


class OperationalCapability(models.Model):
    code = models.CharField(max_length=80, primary_key=True)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300)

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.code


class OperationalRole(models.Model):
    code = models.CharField(max_length=40, primary_key=True)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300)
    capabilities = models.ManyToManyField(OperationalCapability, related_name="roles")

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.code


class OperationalRoleAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_role_assignments",
    )
    role = models.ForeignKey(OperationalRole, on_delete=models.PROTECT, related_name="assignments")
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="operational_roles_granted",
    )
    reason = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("user_id", "role_id")
        constraints = [
            models.UniqueConstraint(fields=("user", "role"), name="administration_user_role_unique")
        ]
        indexes = [models.Index(fields=("role", "user"), name="admin_role_user_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.role_id}"


class OperationalCapabilityAssignment(models.Model):
    """Explicit, exceptional capability grants outside the standard role bundles."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_capability_assignments",
    )
    capability = models.ForeignKey(
        OperationalCapability,
        on_delete=models.PROTECT,
        related_name="assignments",
    )
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="operational_capabilities_granted",
    )
    reason = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("user_id", "capability_id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "capability"), name="administration_user_capability_unique"
            )
        ]
        indexes = [models.Index(fields=("capability", "user"), name="admin_capability_user_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.capability_id}"


class AutomationJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PREPARING = "preparing", "Preparing"
        READY_FOR_AI = "ready_for_ai", "Ready for AI"
        PROCESSING = "processing", "Processing"
        VALIDATING = "validating", "Validating"
        NEEDS_REVIEW = "needs_review", "Needs review"
        APPROVED = "approved", "Approved"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"
        BLOCKED = "blocked", "Blocked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_type = models.CharField(max_length=40)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    academic_subject = models.ForeignKey(
        "education.EducationNode", on_delete=models.SET_NULL, null=True, blank=True
    )
    learning_object = models.ForeignKey(
        "content.LearningObject", on_delete=models.SET_NULL, null=True, blank=True
    )
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    priority = models.PositiveSmallIntegerField(default=0)
    progress = models.PositiveSmallIntegerField(default=0)
    input_manifest = models.JSONField(default=dict)
    output_manifest = models.JSONField(default=dict)
    error_code = models.CharField(max_length=40, blank=True)
    error_message = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    lease_expires_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    idempotency_key = models.UUIDField()

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(
                fields=("status", "-priority", "created_at", "id"), name="automation_queue_idx"
            ),
            models.Index(fields=("job_type", "-created_at"), name="automation_type_created_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("requested_by", "idempotency_key"), name="automation_request_key_unique"
            ),
            models.UniqueConstraint(
                fields=("learning_object",),
                condition=models.Q(
                    status__in=(
                        "queued",
                        "preparing",
                        "ready_for_ai",
                        "processing",
                        "validating",
                        "needs_review",
                        "approved",
                    ),
                    learning_object__isnull=False,
                ),
                name="automation_active_sheet_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(progress__lte=100), name="automation_progress_range"
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=(
                        "queued",
                        "preparing",
                        "ready_for_ai",
                        "processing",
                        "validating",
                        "needs_review",
                        "approved",
                        "completed",
                        "failed",
                        "cancelled",
                        "blocked",
                    )
                ),
                name="automation_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.job_type}:{self.id}"


class AutomationAttempt(models.Model):
    class Result(models.TextChoices):
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        ABANDONED = "abandoned", "Abandoned"
        CANCELLED = "cancelled", "Cancelled"
        BLOCKED = "blocked", "Blocked"

    job = models.ForeignKey(AutomationJob, on_delete=models.CASCADE, related_name="attempts")
    attempt_number = models.PositiveSmallIntegerField()
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    result = models.CharField(max_length=12, choices=Result.choices, default=Result.RUNNING)
    error_details = models.JSONField(default=dict)

    class Meta:
        ordering = ("attempt_number",)
        constraints = [
            models.UniqueConstraint(
                fields=("job", "attempt_number"), name="automation_attempt_number_unique"
            ),
            models.UniqueConstraint(
                fields=("job",),
                condition=models.Q(finished_at__isnull=True),
                name="automation_open_attempt_unique",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.job_id}:{self.attempt_number}"


class SubjectReference(models.Model):
    class Kind(models.TextChoices):
        PAST_EXAM = "past_exam", "Previous-year exam"
        PROFESSOR_SAMPLE = "professor_sample", "Professor sample"
        TEXTBOOK = "textbook", "Textbook"
        SUPPLEMENT = "supplement", "Lecture supplement"
        QUESTION_BANK = "question_bank", "Question bank"
        ANSWER_KEY = "answer_key", "Answer key"
        INSTRUCTIONS = "instructions", "Exam instructions"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    family_id = models.UUIDField(default=uuid.uuid4, editable=False)
    revision = models.PositiveIntegerField(default=1)
    subject = models.ForeignKey("education.EducationNode", on_delete=models.PROTECT)
    file = models.ForeignKey("files.ManagedFile", on_delete=models.PROTECT)
    title = models.CharField(max_length=220)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    tags = models.JSONField(default=list)
    checksum = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    indexed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("subject", "checksum"), name="reference_subject_checksum_unique"
            ),
            models.UniqueConstraint(
                fields=("family_id", "revision"), name="reference_family_revision_unique"
            ),
        ]
        indexes = [
            models.Index(
                fields=("subject", "kind", "-created_at"), name="reference_subject_kind_idx"
            )
        ]

    def __str__(self) -> str:
        return self.title


class SubjectReferencePage(models.Model):
    reference = models.ForeignKey(SubjectReference, on_delete=models.CASCADE, related_name="pages")
    page = models.PositiveIntegerField()
    text = models.TextField()
    needs_visual_review = models.BooleanField(default=False)

    class Meta:
        ordering = ("page",)
        indexes = [
            GinIndex(SearchVector("text", config="simple"), name="reference_page_search_idx")
        ]
        constraints = [
            models.UniqueConstraint(fields=("reference", "page"), name="reference_page_unique"),
            models.CheckConstraint(condition=models.Q(page__gte=1), name="reference_page_positive"),
        ]

    def __str__(self) -> str:
        return f"{self.reference_id}:{self.page}"
