import hashlib
import json
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import F, Sum

from .catalog import LEARNING_ACTIVITY_METRICS, METRICS, Metric
from .models import AnalyticsFact, DailyActiveLearner, DailyMetric


class AnalyticsError(ValueError):
    pass


def _normalized_dimensions(dimensions: dict[str, str] | None) -> dict[str, str]:
    if not dimensions:
        return {}
    return {
        str(key)[:40]: str(value)[:80]
        for key, value in sorted(dimensions.items())[:10]
        if key and value
    }


def _dimensions_key(dimensions: dict[str, str]) -> str:
    payload = json.dumps(dimensions, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _utc_day(value: datetime) -> date:
    return value.astimezone(UTC).date()


def _increment_daily(*, day: date, metric: str, value: int, dimensions: dict[str, str]) -> None:
    key = _dimensions_key(dimensions)
    projection, created = DailyMetric.objects.get_or_create(
        day=day,
        metric=metric,
        dimensions_key=key,
        defaults={"dimensions": dimensions, "value": value},
    )
    if not created:
        DailyMetric.objects.filter(id=projection.id).update(value=F("value") + value)


@transaction.atomic
def record_metric(
    *,
    event_id: UUID,
    metric: str,
    occurred_at: datetime,
    source_event: str,
    source_object_id: str,
    actor_id: UUID | None = None,
    value: int = 1,
    dimensions: dict[str, str] | None = None,
) -> AnalyticsFact:
    if metric not in METRICS:
        raise AnalyticsError("Unknown analytics metric.")
    normalized = _normalized_dimensions(dimensions)
    fact, created = AnalyticsFact.objects.get_or_create(
        event_id=event_id,
        metric=metric,
        defaults={
            "actor_id": actor_id,
            "source_event": source_event[:120],
            "source_object_id": source_object_id[:100],
            "value": value,
            "dimensions": normalized,
            "occurred_at": occurred_at,
        },
    )
    if not created:
        return fact
    day = _utc_day(occurred_at)
    _increment_daily(day=day, metric=metric, value=value, dimensions=normalized)
    if actor_id is not None and metric in LEARNING_ACTIVITY_METRICS:
        _, active_created = DailyActiveLearner.objects.get_or_create(
            day=day, user_id=actor_id, defaults={"first_event_id": event_id}
        )
        if active_created:
            _increment_daily(day=day, metric=Metric.DAILY_ACTIVE_LEARNERS, value=1, dimensions={})
    return fact


@transaction.atomic
def rebuild_daily_projections(*, start: date, end: date) -> dict[str, int]:
    if end < start or (end - start) > timedelta(days=366):
        raise AnalyticsError("Projection rebuilds must cover between 1 and 367 days.")
    DailyMetric.objects.filter(day__gte=start, day__lte=end).delete()
    DailyActiveLearner.objects.filter(day__gte=start, day__lte=end).delete()
    facts = AnalyticsFact.objects.filter(
        occurred_at__date__gte=start, occurred_at__date__lte=end
    ).order_by("occurred_at", "id")
    active_pairs: set[tuple[date, UUID]] = set()
    for fact in facts.iterator(chunk_size=1000):
        day = _utc_day(fact.occurred_at)
        _increment_daily(
            day=day,
            metric=fact.metric,
            value=fact.value,
            dimensions=fact.dimensions,
        )
        if fact.actor_id is not None and fact.metric in LEARNING_ACTIVITY_METRICS:
            pair = (day, fact.actor_id)
            if pair not in active_pairs:
                active_pairs.add(pair)
                DailyActiveLearner.objects.create(
                    day=day, user_id=fact.actor_id, first_event_id=fact.event_id
                )
                _increment_daily(
                    day=day, metric=Metric.DAILY_ACTIVE_LEARNERS, value=1, dimensions={}
                )
    total = DailyMetric.objects.filter(day__gte=start, day__lte=end).aggregate(total=Sum("value"))
    return {
        "facts": facts.count(),
        "active_learners": len(active_pairs),
        "projected_value": total["total"] or 0,
    }
