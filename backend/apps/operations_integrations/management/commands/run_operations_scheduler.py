import logging
import signal
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from threading import Event
from time import monotonic
from typing import Any

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandParser
from django.utils import timezone

from apps.operations_integrations.services import (
    claim_scheduled_job,
    finish_scheduled_job,
)
from platform_core.observability import providers

logger = logging.getLogger("lockin.jobs")


@dataclass(frozen=True)
class JobSpec:
    code: str
    command: str
    interval_setting: str
    default_interval_seconds: int
    options: Callable[[], dict[str, Any]]


def _no_options() -> dict[str, Any]:
    return {}


def _yesterday_options() -> dict[str, str]:
    yesterday = timezone.localdate() - timedelta(days=1)
    value = yesterday.isoformat()
    return {"date_from": value, "date_to": value}


JOBS = (
    JobSpec(
        "notification_campaigns",
        "dispatch_due_notification_campaigns",
        "NOTIFICATION_SCHEDULER_INTERVAL_SECONDS",
        60,
        _no_options,
    ),
    JobSpec(
        "subscription_lifecycle",
        "process_subscription_lifecycle",
        "SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS",
        900,
        _no_options,
    ),
    JobSpec(
        "operational_cleanup",
        "cleanup_operational_data",
        "OPERATIONAL_CLEANUP_INTERVAL_SECONDS",
        3600,
        _no_options,
    ),
    JobSpec(
        "commerce_reconciliation",
        "reconcile_commerce",
        "COMMERCE_RECONCILIATION_INTERVAL_SECONDS",
        21600,
        _no_options,
    ),
    JobSpec(
        "analytics_projection",
        "rebuild_operational_analytics",
        "ANALYTICS_REBUILD_INTERVAL_SECONDS",
        86400,
        _yesterday_options,
    ),
    JobSpec(
        "motivation_projection",
        "rebuild_motivation",
        "MOTIVATION_REBUILD_INTERVAL_SECONDS",
        86400,
        _no_options,
    ),
)


class Command(BaseCommand):
    help = "Run durable, multi-instance-safe operational schedules."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--once", action="store_true")

    def handle(self, *args: object, **options: object) -> None:
        del args
        stopped = Event()

        def stop(*args: object) -> None:
            del args
            stopped.set()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        poll_seconds = max(5, int(getattr(settings, "OPERATIONS_SCHEDULER_POLL_SECONDS", 15)))
        lease_seconds = max(300, int(getattr(settings, "OPERATIONS_JOB_LEASE_SECONDS", 7200)))
        run_once = bool(options["once"])
        self.stdout.write(f"Operations scheduler polling every {poll_seconds} seconds.")

        while not stopped.is_set():
            for job in JOBS:
                interval = max(
                    60,
                    int(
                        getattr(
                            settings,
                            job.interval_setting,
                            job.default_interval_seconds,
                        )
                    ),
                )
                claim = claim_scheduled_job(
                    code=job.code,
                    interval_seconds=interval,
                    lease_seconds=lease_seconds,
                )
                if claim is None:
                    continue
                started = monotonic()
                attributes = {"job": job.code}
                try:
                    call_command(job.command, **job.options())
                except Exception as error:  # noqa: BLE001 - isolate scheduled jobs
                    duration_ms = round((monotonic() - started) * 1000)
                    error_code = type(error).__name__
                    finish_scheduled_job(
                        claim=claim,
                        succeeded=False,
                        duration_ms=duration_ms,
                        error_code=error_code,
                    )
                    providers.metric_sink.increment("operations.job.failed", attributes=attributes)
                    providers.error_reporter.capture_exception(error, context={"job": job.code})
                    logger.exception("Scheduled job failed", extra={"job": job.code})
                else:
                    duration_ms = round((monotonic() - started) * 1000)
                    finish_scheduled_job(
                        claim=claim,
                        succeeded=True,
                        duration_ms=duration_ms,
                    )
                    providers.metric_sink.increment(
                        "operations.job.succeeded", attributes=attributes
                    )
                    providers.metric_sink.observe(
                        "operations.job.duration_ms",
                        value=float(duration_ms),
                        attributes=attributes,
                    )
            if run_once:
                return
            stopped.wait(poll_seconds)
