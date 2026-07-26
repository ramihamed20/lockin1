import uuid
from typing import Any

from django.conf import settings
from django.db import models


class ImmutableAuditQuerySet(models.QuerySet["AuditRecord"]):
    def update(self, **kwargs: Any) -> int:
        raise TypeError("Audit records are immutable.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise TypeError("Audit records are immutable.")


class AuditRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="operational_audit_records",
    )
    action = models.CharField(max_length=120)
    domain = models.CharField(max_length=60)
    target_type = models.CharField(max_length=100)
    target_id = models.CharField(max_length=100)
    reason = models.CharField(max_length=500)
    source = models.CharField(max_length=80)
    correlation_id = models.UUIDField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    previous_state = models.JSONField(default=dict, blank=True)
    new_state = models.JSONField(default=dict, blank=True)
    related_entities = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)
    objects = ImmutableAuditQuerySet.as_manager()

    class Meta:
        ordering = ("-occurred_at", "-id")
        indexes = [
            models.Index(fields=("-occurred_at", "-id"), name="audit_time_id_idx"),
            models.Index(fields=("domain", "-occurred_at"), name="audit_domain_time_idx"),
            models.Index(fields=("target_type", "target_id"), name="audit_target_idx"),
            models.Index(fields=("actor", "-occurred_at"), name="audit_actor_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.action}:{self.target_type}:{self.target_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise TypeError("Audit records are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise TypeError("Audit records are immutable.")
