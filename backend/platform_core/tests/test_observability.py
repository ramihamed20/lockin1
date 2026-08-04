from contextlib import suppress
from json import loads
from types import SimpleNamespace
from typing import Any

from django.contrib.auth.models import AnonymousUser
from django.http import HttpResponse
from django.test import RequestFactory, override_settings

from apps.system_configuration.services import ConfigurationError
from platform_core.maintenance.middleware import MaintenanceModeMiddleware
from platform_core.observability import providers
from platform_core.observability.middleware import OperationalTelemetryMiddleware


class CapturingMetrics:
    def __init__(self) -> None:
        self.increments: list[tuple[str, dict[str, str]]] = []
        self.observations: list[tuple[str, float, dict[str, str]]] = []

    def increment(
        self, name: str, *, value: int = 1, attributes: dict[str, str] | None = None
    ) -> None:
        self.increments.append((name, attributes or {}))

    def observe(self, name: str, *, value: float, attributes: dict[str, str] | None = None) -> None:
        self.observations.append((name, value, attributes or {}))


class CapturingErrors:
    def __init__(self) -> None:
        self.context: dict[str, Any] | None = None

    def capture_exception(self, error: Exception, *, context: dict[str, Any]) -> None:
        self.context = context


@override_settings(OBSERVABILITY_SLOW_REQUEST_MS=100000)
def test_telemetry_uses_normalized_route_and_provider_interfaces() -> None:
    metrics = CapturingMetrics()
    previous = providers.metric_sink
    providers.set_metric_sink(metrics)
    request = RequestFactory().get("/api/v1/items/private-id")
    request.META["LOCKIN_REQUEST_ID"] = "request-id"
    try:
        response = OperationalTelemetryMiddleware(lambda _: HttpResponse(status=204))(request)
    finally:
        providers.set_metric_sink(previous)

    assert response.status_code == 204
    assert metrics.increments[0][0] == "http.server.requests"
    assert metrics.increments[0][1]["route"] == "unresolved"
    assert metrics.observations[0][0] == "http.server.duration_ms"


def test_telemetry_reports_redacted_exception_context() -> None:
    errors = CapturingErrors()
    previous = providers.error_reporter
    providers.set_error_reporter(errors)
    request = RequestFactory().get("/private/path?token=secret")
    request.META["LOCKIN_REQUEST_ID"] = "request-id"

    def fail(_: Any) -> HttpResponse:
        raise RuntimeError("failed")

    try:
        with suppress(RuntimeError):
            OperationalTelemetryMiddleware(fail)(request)
    finally:
        providers.set_error_reporter(previous)

    assert errors.context == {
        "request_id": "request-id",
        "method": "GET",
        "route": "unresolved",
    }


def test_maintenance_mode_allows_normal_requests_when_disabled(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "platform_core.maintenance.middleware.get_configuration_value", lambda _: False
    )
    request = RequestFactory().get("/api/v1/materials")
    request.user = AnonymousUser()

    response = MaintenanceModeMiddleware(lambda _: HttpResponse("available"))(request)

    assert response.status_code == 200
    assert response.content == b"available"


def test_maintenance_mode_returns_structured_response_for_anonymous_requests(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "platform_core.maintenance.middleware.get_configuration_value", lambda _: True
    )
    request = RequestFactory().get("/api/v1/materials")
    request.user = AnonymousUser()
    request.META["LOCKIN_REQUEST_ID"] = "maintenance-request-id"

    response = MaintenanceModeMiddleware(lambda _: HttpResponse("unavailable"))(request)

    assert response.status_code == 503
    assert loads(response.content)["error"] == {
        "code": "maintenance_mode",
        "message": "The platform is temporarily undergoing maintenance.",
        "fields": None,
        "request_id": "maintenance-request-id",
    }


def test_maintenance_mode_keeps_recovery_admin_and_configuration_failures_available(monkeypatch: Any) -> None:
    request = RequestFactory().get("/api/v1/materials")
    request.user = SimpleNamespace(is_authenticated=True, is_superuser=True, is_staff=False)
    monkeypatch.setattr(
        "platform_core.maintenance.middleware.get_configuration_value", lambda _: True
    )

    assert MaintenanceModeMiddleware(lambda _: HttpResponse("recovery"))(request).content == b"recovery"

    def unavailable(_: str) -> None:
        raise ConfigurationError("Configuration storage is unavailable.")

    monkeypatch.setattr("platform_core.maintenance.middleware.get_configuration_value", unavailable)
    request.user = AnonymousUser()
    assert MaintenanceModeMiddleware(lambda _: HttpResponse("fallback"))(request).content == b"fallback"
