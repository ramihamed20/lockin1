import json
import socket
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from django.conf import settings

from .contracts import ErrorReporter, MetricSink


class NoOpMetricSink:
    def increment(
        self, name: str, *, value: int = 1, attributes: dict[str, str] | None = None
    ) -> None:
        return None

    def observe(self, name: str, *, value: float, attributes: dict[str, str] | None = None) -> None:
        return None


class NoOpErrorReporter:
    def capture_exception(self, error: Exception, *, context: dict[str, Any]) -> None:
        return None


def _statsd_token(value: object) -> str:
    return "".join(
        character if character.isalnum() or character in "_.-" else "_" for character in str(value)
    )[:100]


class StatsDMetricSink:
    """Fire-and-forget StatsD metrics with bounded, low-cardinality tags."""

    def __init__(self, *, host: str, port: int, prefix: str = "lockin") -> None:
        self.address = (host, port)
        self.prefix = _statsd_token(prefix)

    def _send(
        self,
        name: str,
        value: int | float,
        metric_type: str,
        attributes: dict[str, str] | None,
    ) -> None:
        metric = f"{self.prefix}.{_statsd_token(name)}:{value}|{metric_type}"
        tags = [
            f"{_statsd_token(key)}:{_statsd_token(attribute)}"
            for key, attribute in sorted((attributes or {}).items())
        ]
        if tags:
            metric += "|#" + ",".join(tags)
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                client.sendto(metric.encode("ascii", errors="replace"), self.address)
        except OSError:
            # Metrics must never make the product request fail. Collector
            # reachability is checked independently by the deployment alert drill.
            return

    def increment(
        self, name: str, *, value: int = 1, attributes: dict[str, str] | None = None
    ) -> None:
        self._send(name, value, "c", attributes)

    def observe(self, name: str, *, value: float, attributes: dict[str, str] | None = None) -> None:
        self._send(name, round(value, 3), "ms", attributes)


class HttpsErrorReporter:
    """Send redacted exception envelopes to an operator-owned HTTPS collector."""

    def __init__(self, *, endpoint: str, token: str, timeout_seconds: int = 3) -> None:
        self.endpoint = endpoint
        self.token = token
        self.timeout_seconds = max(1, min(timeout_seconds, 10))

    def capture_exception(self, error: Exception, *, context: dict[str, Any]) -> None:
        frames = [
            {
                "file": Path(frame.filename).name,
                "function": frame.name[:120],
                "line": frame.lineno,
            }
            for frame in traceback.extract_tb(error.__traceback__)[-12:]
        ]
        safe_context = {
            key: str(value)[:200]
            for key, value in context.items()
            if key
            in {
                "request_id",
                "method",
                "route",
                "job",
                "release",
                "event_type",
                "error_type",
            }
        }
        payload = json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "service": "lockin-backend",
                "exception_type": type(error).__name__,
                "context": safe_context,
                "frames": frames,
            }
        ).encode("utf-8")
        request = Request(  # noqa: S310 - endpoint is HTTPS-validated by production settings
            self.endpoint,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "User-Agent": "lockin-observability/1",
            },
        )
        try:
            with urlopen(  # noqa: S310 - request URL is HTTPS-validated in production
                request, timeout=self.timeout_seconds
            ):
                pass
        except OSError:
            return


metric_sink: MetricSink = NoOpMetricSink()
error_reporter: ErrorReporter = NoOpErrorReporter()


def set_metric_sink(provider: MetricSink) -> None:
    global metric_sink
    metric_sink = provider


def set_error_reporter(provider: ErrorReporter) -> None:
    global error_reporter
    error_reporter = provider


def configure_from_settings() -> None:
    statsd_host = str(getattr(settings, "OBSERVABILITY_STATSD_HOST", "")).strip()
    if statsd_host:
        set_metric_sink(
            StatsDMetricSink(
                host=statsd_host,
                port=int(getattr(settings, "OBSERVABILITY_STATSD_PORT", 8125)),
                prefix=str(getattr(settings, "OBSERVABILITY_METRIC_PREFIX", "lockin")),
            )
        )
    error_endpoint = str(getattr(settings, "OBSERVABILITY_ERROR_WEBHOOK_URL", "")).strip()
    error_token = str(getattr(settings, "OBSERVABILITY_ERROR_WEBHOOK_TOKEN", "")).strip()
    if error_endpoint and error_token:
        set_error_reporter(
            HttpsErrorReporter(
                endpoint=error_endpoint,
                token=error_token,
                timeout_seconds=int(getattr(settings, "OBSERVABILITY_ERROR_TIMEOUT_SECONDS", 3)),
            )
        )
