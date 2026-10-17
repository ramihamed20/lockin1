import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


def default_weekdays() -> list[int]:
    return [0, 1, 2, 3, 4]


class StudyPlanProfile(models.Model):
    class Mode(models.TextChoices):
        BEGINNING = "beginning", "Beginning"
        NORMAL = "normal", "Normal"
        CUSTOM = "custom", "Custom"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="study_plan_profile",
    )
    mode = models.CharField(max_length=12, choices=Mode.choices, default=Mode.CUSTOM)
    daily_minutes = models.PositiveSmallIntegerField(default=60)
    session_minutes = models.PositiveSmallIntegerField(default=25)
    weekdays = models.JSONField(default=default_weekdays)
    subjects = models.JSONField(default=list)
    timezone = models.CharField(max_length=80, default="Africa/Tripoli")
    revision = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(daily_minutes__gte=10, daily_minutes__lte=240),
                name="study_profile_daily_valid",
            ),
            models.CheckConstraint(
                condition=Q(session_minutes__gte=10, session_minutes__lte=120),
                name="study_profile_session_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.mode}"


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
    generated_slot = models.PositiveSmallIntegerField(null=True, blank=True)
    plan_mode = models.CharField(max_length=12, default="custom")
    revision = models.PositiveIntegerField(default=1)
    client_request_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("scheduled_date", "created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "client_request_id"),
                condition=Q(client_request_id__isnull=False),
                name="study_request_unique",
            ),
            models.UniqueConstraint(
                fields=("user", "scheduled_date", "generated_slot"),
                condition=Q(generated_slot__isnull=False),
                name="study_generated_slot_unique",
            ),
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
