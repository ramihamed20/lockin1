import logging
from collections.abc import Callable
from time import monotonic

from django.conf import settings
from django.http import HttpRequest, HttpResponse

from . import providers

logger = logging.getLogger("lockin.http")


def _route_name(request: HttpRequest) -> str:
    match = request.resolver_match
    if match is None:
        return "unresolved"
    return str(match.route or match.view_name or "unresolved")


class OperationalTelemetryMiddleware:
    """Provider-neutral HTTP metrics and redacted error reporting boundary."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        started = monotonic()
        try:
            response = self.get_response(request)
        except Exception as error:
            providers.error_reporter.capture_exception(
                error,
                context={
                    "request_id": request.META.get("LOCKIN_REQUEST_ID", ""),
                    "method": request.method,
                    "route": _route_name(request),
                },
            )
            raise
        duration_ms = (monotonic() - started) * 1000
        attributes = {
            "method": str(request.method or "UNKNOWN"),
            "route": _route_name(request),
            "status_class": f"{response.status_code // 100}xx",
        }
        providers.metric_sink.increment("http.server.requests", attributes=attributes)
        providers.metric_sink.observe(
            "http.server.duration_ms", value=duration_ms, attributes=attributes
        )
        slow_ms = int(getattr(settings, "OBSERVABILITY_SLOW_REQUEST_MS", 1000))
        log = logger.warning if duration_ms >= slow_ms else logger.info
        log(
            "HTTP request completed",
            extra={
                "route": attributes["route"],
                "method": request.method,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 2),
            },
        )
        return response
