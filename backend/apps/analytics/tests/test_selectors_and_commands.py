from datetime import UTC, datetime, timedelta
from io import StringIO
from uuid import uuid4

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from ..catalog import Metric
from ..models import AnalyticsFact
from ..selectors import analytics_series
from ..services import record_metric

pytestmark = pytest.mark.django_db


def test_analytics_series_filters_unknown_metrics_and_reports_freshness() -> None:
    occurred_at = datetime.now(UTC)
    record_metric(
        event_id=uuid4(),
        metric=Metric.FOCUS_MINUTES,
        occurred_at=occurred_at,
        source_event="focus.completed",
        source_object_id="focus-session",
        value=25,
        dimensions={"mode": "solo"},
    )

    result = analytics_series(
        start=occurred_at.date(),
        end=occurred_at.date(),
        metrics=frozenset({Metric.FOCUS_MINUTES, "unknown_metric"}),
    )

    assert result["freshness"]["is_stale"] is False
    assert [metric["code"] for metric in result["metrics"]] == [Metric.FOCUS_MINUTES]
    assert result["metrics"][0]["points"] == [
        {"day": occurred_at.date(), "value": 25, "dimensions": {"mode": "solo"}}
    ]

    AnalyticsFact.objects.update(recorded_at=occurred_at - timedelta(days=2))
    stale = analytics_series(
        start=occurred_at.date(),
        end=occurred_at.date(),
        metrics=frozenset({Metric.FOCUS_MINUTES}),
    )
    assert stale["freshness"]["is_stale"] is True


def test_rebuild_operational_analytics_command_reports_results_and_bad_dates() -> None:
    day = datetime.now(UTC).date()
    output = StringIO()

    call_command(
        "rebuild_operational_analytics",
        **{"date_from": day.isoformat(), "date_to": day.isoformat(), "stdout": output},
    )

    assert "Rebuilt projections" in output.getvalue()
    with pytest.raises(CommandError):
        call_command(
            "rebuild_operational_analytics",
            **{"date_from": "not-a-date", "date_to": day.isoformat()},
        )
