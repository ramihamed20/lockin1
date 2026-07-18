import uuid

from django.db import models


class AnalyticsFact(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_id = models.UUIDField()
    metric = models.CharField(max_length=80)
    actor_id = models.UUIDField(null=True, blank=True)
    source_event = models.CharField(max_length=120)
    source_object_id = models.CharField(max_length=100)
    value = models.BigIntegerField(default=1)
    dimensions = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField()
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("occurred_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("event_id", "metric"), name="analytics_event_metric_unique"
            )
        ]
        indexes = [
            models.Index(fields=("metric", "occurred_at"), name="analytics_metric_time_idx"),
            models.Index(fields=("actor_id", "occurred_at"), name="analytics_actor_time_idx"),
            models.Index(
                fields=("source_event", "source_object_id"), name="analytics_source_obj_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.metric}:{self.event_id}"


class DailyMetric(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    day = models.DateField()
    metric = models.CharField(max_length=80)
    dimensions_key = models.CharField(max_length=64)
    dimensions = models.JSONField(default=dict, blank=True)
    value = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("day", "metric", "dimensions_key")
        constraints = [
            models.UniqueConstraint(
                fields=("day", "metric", "dimensions_key"),
                name="analytics_daily_dimension_unique",
            )
        ]
        indexes = [models.Index(fields=("metric", "day"), name="analytics_daily_metric_idx")]

    def __str__(self) -> str:
        return f"{self.day}:{self.metric}:{self.value}"


class DailyActiveLearner(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    day = models.DateField()
    user_id = models.UUIDField()
    first_event_id = models.UUIDField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("day", "user_id"), name="analytics_daily_active_user_unique"
            )
        ]
        indexes = [models.Index(fields=("day", "user_id"), name="analytics_dau_day_user_idx")]

    def __str__(self) -> str:
        return f"{self.day}:{self.user_id}"
