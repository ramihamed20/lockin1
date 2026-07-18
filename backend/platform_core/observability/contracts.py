from typing import Any, Protocol


class MetricSink(Protocol):
    def increment(
        self, name: str, *, value: int = 1, attributes: dict[str, str] | None = None
    ) -> None: ...

    def observe(
        self, name: str, *, value: float, attributes: dict[str, str] | None = None
    ) -> None: ...


class ErrorReporter(Protocol):
    def capture_exception(self, error: Exception, *, context: dict[str, Any]) -> None: ...
