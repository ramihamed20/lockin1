import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class XpTransaction(models.Model):
    """Immutable authoritative XP evidence. Corrections are compensating transactions."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="xp_transactions"
    )
    source_key = models.CharField(max_length=180)
    source_event_id = models.UUIDField(null=True, blank=True)
    source_event_name = models.CharField(max_length=100)
    source_object_id = models.UUIDField(null=True, blank=True)
    rule_code = models.CharField(max_length=80)
    rule_version = models.PositiveSmallIntegerField(default=1)
    points = models.SmallIntegerField()
    category = models.CharField(max_length=32)
    reason = models.CharField(max_length=180)
    ranking_eligible = models.BooleanField(default=False)
    reverses = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reversal",
    )
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-occurred_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "source_key", "rule_code"), name="xp_user_source_rule_unique"
            ),
            models.CheckConstraint(condition=~Q(points=0), name="xp_points_nonzero"),
        ]
        indexes = [
            models.Index(fields=("user", "-occurred_at", "-id"), name="xp_user_time_idx"),
            models.Index(
                fields=("ranking_eligible", "occurred_at", "user"), name="xp_rank_time_user_idx"
            ),
            models.Index(
                fields=("source_event_name", "source_object_id"), name="xp_source_obj_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.points}:{self.rule_code}"


class XpBalance(models.Model):
    """Cheap, rebuildable projection of the immutable transaction ledger."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="xp_balance",
    )
    total_points = models.BigIntegerField(default=0)
    ranking_points = models.BigIntegerField(default=0)
    transaction_count = models.PositiveBigIntegerField(default=0)
    last_awarded_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(total_points__gte=0), name="xp_balance_total_gte_zero"
            ),
            models.CheckConstraint(
                condition=Q(ranking_points__gte=0), name="xp_balance_rank_gte_zero"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.total_points}"
