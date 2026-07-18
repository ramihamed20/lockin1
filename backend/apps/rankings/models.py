import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class RankingDefinition(models.Model):
    class Period(models.TextChoices):
        ALL_TIME = "all_time", "All time"
        MONTHLY = "monthly", "Monthly"

    class TieStrategy(models.TextChoices):
        COMPETITION = "competition", "Competition ranking"
        DENSE = "dense", "Dense ranking"

    code = models.SlugField(max_length=64, unique=True)
    title_en = models.CharField(max_length=120)
    title_ar = models.CharField(max_length=120)
    metric = models.CharField(max_length=40, default="learning_xp")
    period = models.CharField(max_length=16, choices=Period.choices)
    tie_strategy = models.CharField(
        max_length=16, choices=TieStrategy.choices, default=TieStrategy.COMPETITION
    )
    scope = models.CharField(max_length=32, default="global")
    rules = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.code


class RankingFact(models.Model):
    """Ranking-owned evidence projection, populated only through integration events."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="ranking_facts"
    )
    source_transaction_id = models.UUIDField(unique=True)
    source_key = models.CharField(max_length=180)
    points = models.SmallIntegerField()
    category = models.CharField(max_length=32)
    occurred_at = models.DateTimeField()
    is_valid = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=("is_valid", "occurred_at", "user"), name="rank_fact_time_user_idx"
            ),
            models.Index(
                fields=("user", "is_valid", "occurred_at"), name="rank_fact_user_time_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.points}:{self.source_transaction_id}"


class RankingProfile(models.Model):
    class DisplayMode(models.TextChoices):
        FULL_NAME = "full_name", "Full name"
        INITIALS = "initials", "Initials"
        ANONYMOUS = "anonymous", "Anonymous"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="ranking_profile",
    )
    included = models.BooleanField(default=True)
    display_mode = models.CharField(
        max_length=16, choices=DisplayMode.choices, default=DisplayMode.INITIALS
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user_id}:{self.display_mode}"


class RankingSnapshot(models.Model):
    class Status(models.TextChoices):
        BUILDING = "building", "Building"
        PUBLISHED = "published", "Published"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    definition = models.ForeignKey(
        RankingDefinition, on_delete=models.PROTECT, related_name="snapshots"
    )
    definition_revision = models.PositiveBigIntegerField()
    period_start = models.DateTimeField(null=True, blank=True)
    period_end = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices)
    participant_count = models.PositiveBigIntegerField(default=0)
    source_fact_count = models.PositiveBigIntegerField(default=0)
    rules_snapshot = models.JSONField(default=dict)
    checksum = models.CharField(max_length=64, blank=True)
    error = models.TextField(blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(status="published", generated_at__isnull=False, error="")
                    | Q(status="failed", error__gt="")
                    | Q(status="building", generated_at__isnull=True, error="")
                ),
                name="rank_snapshot_status_consistent",
            )
        ]
        indexes = [
            models.Index(
                fields=("definition", "status", "-generated_at"), name="rank_snapshot_current_idx"
            )
        ]

    def __str__(self) -> str:
        return f"{self.definition.code}:{self.status}:{self.created_at}"


class RankingEntry(models.Model):
    snapshot = models.ForeignKey(RankingSnapshot, on_delete=models.CASCADE, related_name="entries")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    position = models.PositiveIntegerField()
    score = models.BigIntegerField()
    evidence_count = models.PositiveBigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("position", "user_id")
        constraints = [
            models.UniqueConstraint(fields=("snapshot", "user"), name="rank_entry_user_unique")
        ]
        indexes = [
            models.Index(fields=("snapshot", "position"), name="rank_entry_position_idx"),
            models.Index(fields=("user", "snapshot"), name="rank_entry_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.snapshot_id}:{self.position}:{self.user_id}"
