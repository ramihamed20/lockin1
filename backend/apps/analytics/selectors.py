from datetime import UTC, date, datetime, timedelta
from typing import Any

from django.db.models import Max

from .catalog import METRICS
from .models import AnalyticsFact, DailyMetric


def analytics_series(*, start: date, end: date, metrics: frozenset[str]) -> dict[str, Any]:
    allowed = metrics.intersection(METRICS)
    rows = DailyMetric.objects.filter(day__gte=start, day__lte=end, metric__in=allowed).order_by(
        "day", "metric", "dimensions_key"
    )
    points: dict[str, list[dict[str, Any]]] = {code: [] for code in allowed}
    for row in rows:
        points[row.metric].append(
            {"day": row.day, "value": row.value, "dimensions": row.dimensions}
        )
    freshness = AnalyticsFact.objects.aggregate(value=Max("recorded_at"))["value"]
    return {
        "period": {"from": start, "to": end, "timezone": "UTC"},
        "freshness": {
            "projected_through": freshness,
            "is_stale": freshness is None or freshness < datetime.now(UTC) - timedelta(hours=24),
        },
        "metrics": [
            {
                "code": code,
                "label": METRICS[code].label,
                "unit": METRICS[code].unit,
                "points": points[code],
            }
            for code in sorted(allowed)
        ],
    }
