import uuid

from django.conf import settings
from django.db import models


class FeedbackSuggestion(models.Model):
    class Category(models.TextChoices):
        FEATURE = "feature", "Feature"
        IMPROVEMENT = "improvement", "Improvement"
        PROBLEM = "problem", "Problem"
        GENERAL = "general", "General"

    class Status(models.TextChoices):
        NEW = "new", "New"
        PLANNED = "planned", "Planned"
        DONE = "done", "Done"
        DECLINED = "declined", "Declined"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="feedback_suggestions",
    )
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.FEATURE)
    message = models.TextField(max_length=2000)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.NEW)
    admin_note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "id")
        indexes = [
            models.Index(fields=("status", "-created_at"), name="feedback_status_idx"),
            models.Index(fields=("user", "-created_at"), name="feedback_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.category}: {self.message[:40]}"
