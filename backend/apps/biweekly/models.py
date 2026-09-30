import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q


def report_upload_path(instance: "BiweeklySnapshot", filename: str) -> str:
    return (
        f"biweekly/{instance.user_id}/{instance.report_type}/"
        f"{instance.period_start:%Y-%m-%d}/{filename}"
    )


class BiweeklySnapshot(models.Model):
    class Type(models.TextChoices):
        ANALYSIS = "analysis", "Analysis"
        REVIEW = "review", "Review"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="biweekly_snapshots"
    )
    report_type = models.CharField(max_length=8, choices=Type.choices)
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    data = models.JSONField(default=dict)
    pdf = models.FileField(upload_to=report_upload_path, max_length=512, blank=True)
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-period_start", "report_type")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "report_type", "period_start"),
                name="biweekly_user_type_start_unique",
            ),
            models.CheckConstraint(
                condition=Q(period_end__gt=F("period_start")), name="biweekly_period_positive"
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "report_type", "-period_start"), name="biweekly_history_idx"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.report_type}:{self.period_start:%Y-%m-%d}"


class BiweeklyReviewTest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    snapshot = models.OneToOneField(BiweeklySnapshot, on_delete=models.PROTECT, related_name="test")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    answers = models.JSONField(default=dict)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.user_id}:{self.snapshot_id}"
