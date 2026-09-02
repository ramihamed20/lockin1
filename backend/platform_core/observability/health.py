from datetime import UTC, datetime, timedelta
from typing import Any

from django.conf import settings
from django.db import DatabaseError, connection
from django.utils import timezone

from . import providers
from .providers import NoOpErrorReporter, NoOpMetricSink


def collect_health_status() -> dict[str, Any]:
    database_status = "ok"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        database_status = "unavailable"

    analytics_status = "no_data"
    analytics_freshness = None
    try:
        from apps.analytics.models import AnalyticsFact

        analytics_freshness = (
            AnalyticsFact.objects.order_by("-recorded_at")
            .values_list("recorded_at", flat=True)
            .first()
        )
        if analytics_freshness is not None:
            analytics_status = "ok"
    except DatabaseError:
        analytics_status = "unavailable"

    scheduler_status = "no_data"
    scheduler_failures = 0
    scheduler_stale_leases = 0
    try:
        from apps.operations_integrations.models import ScheduledJobState

        scheduler_failures = ScheduledJobState.objects.filter(
            status=ScheduledJobState.Status.FAILED
        ).count()
        lease_cutoff = timezone.now() - timedelta(
            seconds=int(getattr(settings, "OPERATIONS_JOB_LEASE_SECONDS", 7200))
        )
        scheduler_stale_leases = ScheduledJobState.objects.filter(
            status=ScheduledJobState.Status.RUNNING,
            last_started_at__lte=lease_cutoff,
        ).count()
        if ScheduledJobState.objects.exists():
            scheduler_status = "degraded" if scheduler_failures or scheduler_stale_leases else "ok"
    except DatabaseError:
        scheduler_status = "unavailable"

    status = (
        "ok"
        if database_status == "ok"
        and analytics_status != "unavailable"
        and scheduler_status not in ("unavailable", "degraded")
        else "degraded"
    )
    return {
        "status": status,
        "checked_at": datetime.now(UTC),
        "components": [
            {"code": "application", "status": "ok"},
            {"code": "database", "status": database_status},
            {
                "code": "analytics_projection",
                "status": analytics_status,
                "freshness": analytics_freshness,
            },
            {
                "code": "operations_scheduler",
                "status": scheduler_status,
                "failed_jobs": scheduler_failures,
                "stale_leases": scheduler_stale_leases,
            },
            {
                "code": "metrics_provider",
                "status": "not_configured"
                if isinstance(providers.metric_sink, NoOpMetricSink)
                else "configured",
            },
            {
                "code": "error_tracking_provider",
                "status": "not_configured"
                if isinstance(providers.error_reporter, NoOpErrorReporter)
                else "configured",
            },
        ],
    }
