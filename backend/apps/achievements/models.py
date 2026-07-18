import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class AchievementDefinition(models.Model):
    code = models.SlugField(max_length=80, unique=True)
    category = models.CharField(max_length=32)
    icon_key = models.CharField(max_length=48)
    is_active = models.BooleanField(default=True)
    current_version = models.ForeignKey(
        "AchievementVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="current_for_definitions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("category", "code")

    def __str__(self) -> str:
        return self.code


class AchievementVersion(models.Model):
    definition = models.ForeignKey(
        AchievementDefinition, on_delete=models.PROTECT, related_name="versions"
    )
    version = models.PositiveSmallIntegerField()
    title_en = models.CharField(max_length=120)
    title_ar = models.CharField(max_length=120)
    description_en = models.CharField(max_length=240)
    description_ar = models.CharField(max_length=240)
    criteria = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("definition", "-version")
        constraints = [
            models.UniqueConstraint(
                fields=("definition", "version"), name="achievement_version_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.definition.code}:v{self.version}"


class AchievementEvidence(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="achievement_evidence"
    )
    source_key = models.CharField(max_length=180)
    evidence_type = models.CharField(max_length=80)
    source_object_id = models.UUIDField(null=True, blank=True)
    value = models.PositiveIntegerField(default=1)
    occurred_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "source_key"), name="achievement_evidence_unique"
            )
        ]
        indexes = [
            models.Index(fields=("user", "evidence_type"), name="achievement_user_type_idx"),
            models.Index(fields=("evidence_type", "occurred_at"), name="achievement_type_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.evidence_type}:{self.source_key}"


class AchievementProgress(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="achievement_progress"
    )
    definition = models.ForeignKey(AchievementDefinition, on_delete=models.CASCADE)
    version = models.ForeignKey(AchievementVersion, on_delete=models.PROTECT)
    current_value = models.PositiveBigIntegerField(default=0)
    target_value = models.PositiveBigIntegerField()
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "definition"), name="achievement_progress_user_unique"
            ),
            models.CheckConstraint(
                condition=Q(current_value__gte=0), name="achievement_progress_nonnegative"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.definition.code}:{self.current_value}"


class EarnedAchievement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="earned_achievements"
    )
    definition = models.ForeignKey(AchievementDefinition, on_delete=models.PROTECT)
    version = models.ForeignKey(AchievementVersion, on_delete=models.PROTECT)
    evidence_snapshot = models.JSONField(default=dict)
    earned_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-earned_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "definition"), name="achievement_earned_user_unique"
            )
        ]
        indexes = [
            models.Index(fields=("user", "-earned_at"), name="achievement_user_earned_idx"),
            models.Index(fields=("definition", "-earned_at"), name="achievement_def_earned_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.definition.code}"
