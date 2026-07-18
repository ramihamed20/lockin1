from typing import Any

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


metric_sink: MetricSink = NoOpMetricSink()
error_reporter: ErrorReporter = NoOpErrorReporter()


def set_metric_sink(provider: MetricSink) -> None:
    global metric_sink
    metric_sink = provider


def set_error_reporter(provider: ErrorReporter) -> None:
    global error_reporter
    error_reporter = provider
