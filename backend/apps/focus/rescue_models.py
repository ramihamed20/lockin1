"""Behavioral starts; these records never contribute learning or XP events."""

import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class RescueSession(models.Model):
    class Status(models.TextChoices):
        PROPOSED = "proposed", "Proposed"
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        STOPPED = "stopped", "Stopped"
        CONTINUED = "continued", "Continued"
        FINISHED = "finished", "Finished"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    catalog_document = models.ForeignKey("content.CatalogDocument", on_delete=models.PROTECT)
    learning_object_version = models.ForeignKey(
        "content.LearningObjectVersion", on_delete=models.PROTECT
    )
    managed_file = models.ForeignKey("files.ManagedFile", on_delete=models.PROTECT)
    edition = models.CharField(max_length=16)
    task_type = models.CharField(
        max_length=16, choices=[("read", "Read"), ("summary", "Summary"), ("explain", "Explain")]
    )
    page_start = models.PositiveIntegerField()
    page_end = models.PositiveIntegerField()
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    active_duration_seconds = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices)
    exit_reason = models.CharField(max_length=32, blank=True)
    continued_into_study_session = models.ForeignKey(
        "focus.FocusSession", on_delete=models.SET_NULL, null=True, blank=True
    )
    device_mutation_id = models.UUIDField()
    sync_revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=("account", "-updated_at"), name="rescue_account_recent_idx")
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(page_start__gte=1) & Q(page_end__gte=F("page_start")),
                name="rescue_page_range_valid",
            ),
            models.CheckConstraint(
                condition=Q(active_duration_seconds__lte=180), name="rescue_duration_bounded"
            ),
            models.CheckConstraint(
                condition=Q(ended_at__isnull=True) | Q(ended_at__gte=F("started_at")),
                name="rescue_end_after_start",
            ),
            models.UniqueConstraint(
                fields=("account",),
                condition=Q(status__in=["active", "paused"]),
                name="rescue_one_open_per_account",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.account_id}:{self.id}:{self.status}"


class RescueMutationReceipt(models.Model):
    account = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    mutation_id = models.UUIDField()
    digest = models.CharField(max_length=64)
    response = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("account", "mutation_id"), name="rescue_mutation_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.account_id}:{self.mutation_id}"
