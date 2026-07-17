import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Report(models.Model):
    class TargetType(models.TextChoices):
        DISCUSSION = "discussion", "Discussion"
        COMMENT = "comment", "Comment"
        QUESTION = "question", "Question"
        ANSWER = "answer", "Answer"
        EXPLANATION = "explanation", "Explanation"
        LEARNING_OBJECT = "learning_object", "Learning object"

    class Reason(models.TextChoices):
        SPAM = "spam", "Spam"
        ABUSE = "abuse", "Abuse or harassment"
        INCORRECT_QUESTION = "incorrect_question", "Incorrect question"
        INCORRECT_ANSWER = "incorrect_answer", "Incorrect answer"
        INCORRECT_EXPLANATION = "incorrect_explanation", "Incorrect explanation"
        DUPLICATE = "duplicate", "Duplicate"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        TRIAGED = "triaged", "Triaged"
        IN_PROGRESS = "in_progress", "In progress"
        RESOLVED = "resolved", "Resolved"
        REJECTED = "rejected", "Rejected"
        DUPLICATE = "duplicate", "Duplicate"

    class Priority(models.TextChoices):
        ROUTINE = "routine", "Routine"
        IMPORTANT = "important", "Important"
        URGENT = "urgent", "Urgent"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="moderation_reports",
    )
    target_type = models.CharField(max_length=24, choices=TargetType.choices)
    target_id = models.UUIDField()
    target_version_id = models.UUIDField(null=True, blank=True)
    target_author_id = models.UUIDField(null=True, blank=True)
    target_label = models.CharField(max_length=220)
    context_type = models.CharField(max_length=24, blank=True)
    context_id = models.UUIDField(null=True, blank=True)
    private_space_id = models.UUIDField(null=True, blank=True)
    reason = models.CharField(max_length=28, choices=Reason.choices)
    description = models.TextField()
    evidence_snapshot = models.JSONField(default=dict)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    priority = models.CharField(
        max_length=12,
        choices=Priority.choices,
        default=Priority.ROUTINE,
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="assigned_moderation_reports",
    )
    duplicate_of = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="duplicates",
    )
    resolution_notes = models.TextField(blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    client_request_id = models.UUIDField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("reporter", "client_request_id"),
                name="moderation_report_request_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status__in=("open", "triaged", "in_progress"), resolved_at__isnull=True)
                    | Q(status__in=("resolved", "rejected", "duplicate"), resolved_at__isnull=False)
                ),
                name="moderation_report_resolution_consistent",
            ),
            models.CheckConstraint(
                condition=~Q(id=F("duplicate_of_id")),
                name="moderation_report_not_own_duplicate",
            ),
        ]
        indexes = [
            models.Index(
                fields=("status", "priority", "-created_at"),
                name="moderation_queue_status_idx",
            ),
            models.Index(
                fields=("assigned_to", "status", "-updated_at"),
                name="moderation_assignment_idx",
            ),
            models.Index(
                fields=("target_type", "target_id", "status"),
                name="moderation_target_status_idx",
            ),
            models.Index(
                fields=("reporter", "-created_at"),
                name="moderation_reporter_time_idx",
            ),
            models.Index(
                fields=("private_space_id", "status", "-created_at"),
                name="moderation_private_queue_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.target_type}:{self.target_id}:{self.status}"


class ModerationAuditEntry(models.Model):
    class Action(models.TextChoices):
        REPORT_CREATED = "report_created", "Report created"
        TRIAGED = "triaged", "Triaged"
        ASSIGNED = "assigned", "Assigned"
        STARTED = "started", "Started"
        RESOLVED = "resolved", "Resolved"
        REJECTED = "rejected", "Rejected"
        MARKED_DUPLICATE = "marked_duplicate", "Marked duplicate"
        CONTENT_REMOVED = "content_removed", "Content removed"
        CONTENT_RESTORED = "content_restored", "Content restored"
        DISCUSSION_LOCKED = "discussion_locked", "Discussion locked"
        DISCUSSION_UNLOCKED = "discussion_unlocked", "Discussion unlocked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(
        Report,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="audit_entries",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="moderation_audit_actions",
    )
    action = models.CharField(max_length=24, choices=Action.choices)
    target_type = models.CharField(max_length=24)
    target_id = models.UUIDField()
    reason = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("actor", "-created_at"), name="moderation_actor_audit_idx"),
            models.Index(
                fields=("target_type", "target_id", "-created_at"),
                name="moderation_target_audit_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.action}:{self.target_type}:{self.target_id}"


class ModerationRateBucket(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="moderation_rate_buckets",
    )
    window_started_at = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "window_started_at"),
                name="moderation_rate_bucket_unique",
            )
        ]
        indexes = [models.Index(fields=("window_started_at",), name="moderation_rate_cleanup_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.window_started_at.isoformat()}"
