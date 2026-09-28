import uuid

from django.conf import settings
from django.db import models


class OfflineOperationReceipt(models.Model):
    """One durable response per account and client operation ID."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    operation_id = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    response_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "operation_id"), name="offline_user_operation_unique"
            )
        ]
        indexes = [
            models.Index(fields=("user", "-created_at"), name="offline_user_receipt_time_idx")
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.operation_id}"
