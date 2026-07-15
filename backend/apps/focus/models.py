import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


class FocusSession(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        ABANDONED = "abandoned", "Abandoned"

    class ContextType(models.TextChoices):
        INDEPENDENT = "independent", "Independent"
        STUDY = "study", "Study"
        QUIZ = "quiz", "Quiz"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="focus_sessions"
    )
    context_type = models.CharField(
        max_length=16, choices=ContextType.choices, default=ContextType.INDEPENDENT
    )
    context_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    planned_duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    active_duration_seconds = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-started_at",)
        indexes = [
            models.Index(fields=("user", "-started_at"), name="focus_user_started_idx"),
            models.Index(fields=("status", "-started_at"), name="focus_status_started_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(context_type="independent", context_id__isnull=True)
                    | (~Q(context_type="independent") & Q(context_id__isnull=False))
                ),
                name="focus_context_reference_valid",
            ),
            models.CheckConstraint(
                condition=Q(ended_at__isnull=True) | Q(ended_at__gte=F("started_at")),
                name="focus_end_after_start",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status__in=("active", "paused"), ended_at__isnull=True)
                    | Q(status__in=("completed", "abandoned"), ended_at__isnull=False)
                ),
                name="focus_status_end_consistent",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.started_at.isoformat()}"

    def clean(self) -> None:
        super().clean()
        if self.context_type == self.ContextType.INDEPENDENT and self.context_id is not None:
            raise ValidationError({"context_id": "Independent sessions cannot have context_id."})
        if self.context_type != self.ContextType.INDEPENDENT and self.context_id is None:
            raise ValidationError({"context_id": "Study and quiz sessions require context_id."})


class FocusSessionActivity(models.Model):
    class ActivityType(models.TextChoices):
        STARTED = "started", "Started"
        PAUSED = "paused", "Paused"
        RESUMED = "resumed", "Resumed"
        COMPLETED = "completed", "Completed"
        ABANDONED = "abandoned", "Abandoned"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(FocusSession, on_delete=models.CASCADE, related_name="timeline")
    sequence = models.PositiveIntegerField()
    activity_type = models.CharField(max_length=16, choices=ActivityType.choices)
    occurred_at = models.DateTimeField(default=timezone.now)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(
                fields=("session", "sequence"), name="focus_timeline_sequence_unique"
            )
        ]
        indexes = [models.Index(fields=("session", "occurred_at"), name="focus_timeline_time_idx")]

    def __str__(self) -> str:
        return f"{self.session_id}:{self.sequence}:{self.activity_type}"
