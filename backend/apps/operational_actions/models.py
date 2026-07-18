import uuid

from django.conf import settings
from django.db import models


class OperationalActionRun(models.Model):
    class Status(models.TextChoices):
        PREVIEWED = "previewed", "Previewed"
        EXECUTING = "executing", "Executing"
        COMPLETED = "completed", "Completed"
        PARTIAL = "partial", "Partially completed"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action_code = models.CharField(max_length=80)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="operational_action_runs",
    )
    reason = models.CharField(max_length=500)
    payload = models.JSONField(default=dict)
    preview = models.JSONField(default=dict)
    result_summary = models.JSONField(default=dict, blank=True)
    idempotency_key = models.CharField(max_length=100)
    confirmation_digest = models.CharField(max_length=64, editable=False)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PREVIEWED)
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("requested_by", "idempotency_key"),
                name="operations_user_idempotency_unique",
            )
        ]
        indexes = [
            models.Index(fields=("requested_by", "-created_at"), name="operations_user_time_idx"),
            models.Index(fields=("action_code", "status"), name="operations_action_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.action_code}:{self.id}:{self.status}"
