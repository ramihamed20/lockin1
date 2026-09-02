import uuid

from django.db import models
from django.utils import timezone


class ScheduledJobState(models.Model):
    """Durable lease and health record for an idempotent scheduled command."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    code = models.CharField(max_length=80, primary_key=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    claim_token = models.UUIDField(null=True, blank=True, editable=False)
    next_run_at = models.DateTimeField(default=timezone.now, db_index=True)
    last_started_at = models.DateTimeField(null=True, blank=True)
    last_succeeded_at = models.DateTimeField(null=True, blank=True)
    last_failed_at = models.DateTimeField(null=True, blank=True)
    last_duration_ms = models.PositiveBigIntegerField(null=True, blank=True)
    run_count = models.PositiveBigIntegerField(default=0)
    failure_count = models.PositiveBigIntegerField(default=0)
    last_error_code = models.CharField(max_length=120, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("next_run_at", "code")
        indexes = [
            models.Index(fields=("status", "next_run_at"), name="ops_job_due_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.code}:{self.status}"

    @classmethod
    def new_claim_token(cls) -> uuid.UUID:
        return uuid.uuid4()
