import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class StudyPlanItem(models.Model):
    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        COMPLETED = "completed", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="study_plan_items",
    )
    title = models.CharField(max_length=180)
    subject = models.CharField(max_length=120, blank=True)
    scheduled_date = models.DateField()
    duration_minutes = models.PositiveSmallIntegerField(default=25)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("scheduled_date", "created_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=Q(duration_minutes__gte=5) & Q(duration_minutes__lte=480),
                name="study_plan_duration_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "scheduled_date", "status"),
                name="study_plan_user_date_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.scheduled_date}:{self.title}"
