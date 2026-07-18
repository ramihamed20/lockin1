import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class StreakPolicy(models.Model):
    code = models.SlugField(max_length=64)
    version = models.PositiveSmallIntegerField()
    title = models.CharField(max_length=120)
    qualifying_activity_types = models.JSONField(default=list)
    boundary_timezone = models.CharField(max_length=64, default="UTC")
    grace_days = models.PositiveSmallIntegerField(default=0)
    freeze_tokens_enabled = models.BooleanField(default=False)
    recovery_window_days = models.PositiveSmallIntegerField(default=0)
    rules = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("code", "-version")
        constraints = [
            models.UniqueConstraint(
                fields=("code", "version"), name="streak_policy_version_unique"
            ),
            models.UniqueConstraint(
                fields=("code",), condition=Q(is_active=True), name="streak_one_active_policy"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.code}:v{self.version}"


class StreakActivity(models.Model):
    """Deduplicated qualifying evidence; a streak projection can always be recomputed from it."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="streak_activities"
    )
    policy = models.ForeignKey(StreakPolicy, on_delete=models.PROTECT)
    source_key = models.CharField(max_length=180)
    activity_type = models.CharField(max_length=64)
    source_object_id = models.UUIDField(null=True, blank=True)
    qualified_on = models.DateField()
    occurred_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-qualified_on", "-occurred_at", "-id")
        constraints = [
            models.UniqueConstraint(fields=("user", "source_key"), name="streak_user_source_unique")
        ]
        indexes = [
            models.Index(fields=("user", "qualified_on"), name="streak_user_day_idx"),
            models.Index(fields=("activity_type", "occurred_at"), name="streak_type_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.qualified_on}:{self.activity_type}"


class UserStreak(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="streak_state",
    )
    policy = models.ForeignKey(StreakPolicy, on_delete=models.PROTECT)
    current_days = models.PositiveIntegerField(default=0)
    longest_days = models.PositiveIntegerField(default=0)
    last_qualified_on = models.DateField(null=True, blank=True)
    freeze_tokens_available = models.PositiveSmallIntegerField(default=0)
    grace_days_used = models.PositiveSmallIntegerField(default=0)
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=("-current_days", "user"), name="streak_current_user_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.current_days}"
