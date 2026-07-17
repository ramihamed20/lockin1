import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from apps.education.models import EducationNode
from apps.questions.models import QuestionVersion


class Quiz(models.Model):
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
        related_name="owned_quizzes",
    )
    current_version = models.ForeignKey(
        "QuizVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="current_for",
    )
    published_version = models.ForeignKey(
        "QuizVersion",
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
                name="quiz_owner_flow_idx",
            ),
            models.Index(
                fields=("workflow_status", "-published_at"),
                name="quiz_publication_idx",
            ),
        ]

    def __str__(self) -> str:
        version = self.current_version
        return version.title if version is not None else str(self.id)


class QuizVersion(models.Model):
    class Mode(models.TextChoices):
        QUIZ = "quiz", "Quiz"
        PRACTICE = "practice", "Practice"
        MASTERY = "mastery", "Mastery test"

    class SelectionMode(models.TextChoices):
        FIXED = "fixed", "Fixed questions"
        POOL = "pool", "Question pool"

    class ResultRelease(models.TextChoices):
        IMMEDIATE = "immediate", "Immediately"
        AFTER_CLOSE = "after_close", "After availability closes"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quiz = models.ForeignKey(Quiz, on_delete=models.PROTECT, related_name="versions")
    version_number = models.PositiveIntegerField()
    academic_node = models.ForeignKey(
        EducationNode,
        on_delete=models.PROTECT,
        related_name="quiz_versions",
    )
    title = models.CharField(max_length=220)
    instructions = models.TextField(blank=True)
    mode = models.CharField(max_length=12, choices=Mode.choices)
    selection_mode = models.CharField(max_length=12, choices=SelectionMode.choices)
    question_count = models.PositiveSmallIntegerField()
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    maximum_attempts = models.PositiveSmallIntegerField(default=0)
    available_from = models.DateTimeField(null=True, blank=True)
    available_until = models.DateTimeField(null=True, blank=True)
    randomize_questions = models.BooleanField(default=True)
    randomize_options = models.BooleanField(default=True)
    result_release = models.CharField(
        max_length=16,
        choices=ResultRelease.choices,
        default=ResultRelease.IMMEDIATE,
    )
    pass_percent = models.DecimalField(max_digits=5, decimal_places=2, default=60)
    ranking_eligible = models.BooleanField(default=False)
    achievement_eligible = models.BooleanField(default=False)
    focus_required = models.BooleanField(default=False)
    allowed_difficulties = models.JSONField(default=list, blank=True)
    language = models.CharField(max_length=12, default="en")
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_quiz_versions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-version_number",)
        constraints = [
            models.UniqueConstraint(
                fields=("quiz", "version_number"),
                name="quiz_version_number_unique",
            ),
            models.CheckConstraint(
                condition=Q(question_count__gte=1) & Q(question_count__lte=100),
                name="quiz_question_count_valid",
            ),
            models.CheckConstraint(
                condition=Q(pass_percent__gte=0) & Q(pass_percent__lte=100),
                name="quiz_pass_percent_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(available_from__isnull=True)
                    | Q(available_until__isnull=True)
                    | Q(available_until__gt=F("available_from"))
                ),
                name="quiz_availability_order",
            ),
        ]
        indexes = [
            models.Index(
                fields=("academic_node", "mode", "-created_at"),
                name="quiz_scope_mode_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.title} v{self.version_number}"


class QuizVersionQuestion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quiz_version = models.ForeignKey(
        QuizVersion,
        on_delete=models.PROTECT,
        related_name="question_links",
    )
    question_version = models.ForeignKey(
        QuestionVersion,
        on_delete=models.PROTECT,
        related_name="quiz_links",
    )
    position = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ("position", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("quiz_version", "position"),
                name="quiz_question_position_unique",
            ),
            models.UniqueConstraint(
                fields=("quiz_version", "question_version"),
                name="quiz_question_version_unique",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.quiz_version_id}:{self.position}"


class Attempt(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUBMITTED = "submitted", "Submitted"
        EXPIRED = "expired", "Expired and submitted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assessment_attempts",
    )
    quiz = models.ForeignKey(Quiz, on_delete=models.PROTECT, related_name="attempts")
    quiz_version = models.ForeignKey(
        QuizVersion,
        on_delete=models.PROTECT,
        related_name="attempts",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    start_idempotency_key = models.UUIDField()
    requested_question_count = models.PositiveSmallIntegerField()
    review_only = models.BooleanField(default=False)
    server_revision = models.PositiveBigIntegerField(default=1)
    started_at = models.DateTimeField(default=timezone.now)
    deadline_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-started_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "start_idempotency_key"),
                name="attempt_start_key_unique",
            ),
            models.CheckConstraint(
                condition=Q(deadline_at__isnull=True) | Q(deadline_at__gt=F("started_at")),
                name="attempt_deadline_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status="active", completed_at__isnull=True)
                    | Q(status__in=("submitted", "expired"), completed_at__isnull=False)
                ),
                name="attempt_completion_consistent",
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "status", "-started_at"),
                name="attempt_user_status_idx",
            ),
            models.Index(
                fields=("quiz", "user", "-started_at"),
                name="attempt_quiz_user_idx",
            ),
            models.Index(fields=("status", "deadline_at"), name="attempt_deadline_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.quiz_id}:{self.status}"


class AttemptQuestion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name="questions")
    question_version = models.ForeignKey(
        QuestionVersion,
        on_delete=models.PROTECT,
        related_name="attempt_snapshots",
    )
    position = models.PositiveSmallIntegerField()
    prompt = models.TextField()
    question_type = models.CharField(max_length=24)
    difficulty = models.CharField(max_length=12)
    language = models.CharField(max_length=12)
    explanation = models.TextField(blank=True)
    option_snapshot = models.JSONField(default=list)
    correct_option_ids = models.JSONField(default=list)
    max_points = models.DecimalField(max_digits=6, decimal_places=2, default=1)

    class Meta:
        ordering = ("position", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("attempt", "position"),
                name="attempt_question_position_unique",
            ),
            models.UniqueConstraint(
                fields=("attempt", "question_version"),
                name="attempt_question_version_unique",
            ),
        ]
        indexes = [models.Index(fields=("attempt", "position"), name="attempt_question_order_idx")]

    def __str__(self) -> str:
        return f"{self.attempt_id}:{self.position}"


class AttemptAnswer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    attempt_question = models.OneToOneField(
        AttemptQuestion,
        on_delete=models.CASCADE,
        related_name="answer",
    )
    selected_option_ids = models.JSONField(default=list)
    client_revision = models.PositiveBigIntegerField()
    server_revision = models.PositiveBigIntegerField()
    saved_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=("attempt_question", "saved_at"), name="answer_saved_idx")]

    def __str__(self) -> str:
        return f"{self.attempt_question_id}:r{self.server_revision}"


class AttemptResult(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    attempt = models.OneToOneField(Attempt, on_delete=models.PROTECT, related_name="result")
    score_points = models.DecimalField(max_digits=8, decimal_places=2)
    maximum_points = models.DecimalField(max_digits=8, decimal_places=2)
    percentage = models.DecimalField(max_digits=5, decimal_places=2)
    passed = models.BooleanField()
    answered_count = models.PositiveSmallIntegerField()
    unanswered_count = models.PositiveSmallIntegerField()
    ranking_eligible = models.BooleanField(default=False)
    achievement_eligible = models.BooleanField(default=False)
    submitted_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=("attempt", "submitted_at"),
                name="result_attempt_time_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.attempt_id}:{self.percentage}%"


class AttemptSubmissionReceipt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    attempt = models.ForeignKey(
        Attempt,
        on_delete=models.PROTECT,
        related_name="submission_receipts",
    )
    result = models.ForeignKey(AttemptResult, on_delete=models.PROTECT, related_name="receipts")
    idempotency_key = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "idempotency_key"),
                name="submission_user_key_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.attempt_id}:{self.idempotency_key}"


class AttemptActivity(models.Model):
    class ActivityType(models.TextChoices):
        WORKSPACE_ENTERED = "workspace_entered", "Workspace entered"
        PAGE_HIDDEN = "page_hidden", "Page hidden"
        PAGE_VISIBLE = "page_visible", "Page visible"
        CONNECTION_LOST = "connection_lost", "Connection lost"
        CONNECTION_RESTORED = "connection_restored", "Connection restored"
        WORKSPACE_EXITED = "workspace_exited", "Workspace exited"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name="activities")
    client_event_id = models.UUIDField()
    activity_type = models.CharField(max_length=24, choices=ActivityType.choices)
    client_occurred_at = models.DateTimeField(null=True, blank=True)
    server_received_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("server_received_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("attempt", "client_event_id"),
                name="attempt_activity_event_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("attempt", "server_received_at"),
                name="attempt_activity_time_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.attempt_id}:{self.activity_type}"


class QuestionIssueReport(models.Model):
    class Category(models.TextChoices):
        ANSWER_KEY = "answer_key", "Answer key"
        AMBIGUOUS = "ambiguous", "Ambiguous wording"
        OUTDATED = "outdated", "Outdated content"
        TYPO = "typo", "Typographical error"
        EXPLANATION = "explanation", "Incorrect explanation"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESOLVED = "resolved", "Resolved"
        DISMISSED = "dismissed", "Dismissed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="question_issue_reports",
    )
    result = models.ForeignKey(
        AttemptResult,
        on_delete=models.PROTECT,
        related_name="issue_reports",
    )
    attempt_question = models.ForeignKey(
        AttemptQuestion,
        on_delete=models.PROTECT,
        related_name="issue_reports",
    )
    category = models.CharField(max_length=16, choices=Category.choices)
    details = models.TextField()
    evidence_snapshot = models.JSONField(default=dict)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("reporter", "result", "attempt_question"),
                name="question_report_once_unique",
            )
        ]
        indexes = [
            models.Index(fields=("status", "-created_at"), name="question_report_status_idx")
        ]

    def __str__(self) -> str:
        return f"{self.result_id}:{self.attempt_question_id}:{self.status}"
