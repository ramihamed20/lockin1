import json
import re
from urllib.parse import urlsplit

from django.conf import settings
from django.db import DatabaseError, connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST

from apps.accounts.services import (
    auth_attempt_fingerprint,
    auth_attempt_is_limited,
    record_auth_attempt,
)
from platform_core.network import client_ip
from platform_core.observability import providers

_CLIENT_ERROR_TYPE = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,119}$")


class ClientReportedError(Exception):
    """Marker exception for a redacted browser error envelope."""


@require_GET
def live(_: HttpRequest) -> JsonResponse:
    return JsonResponse({"status": "ok", "service": "lockin-api"})


@require_GET
def ready(_: HttpRequest) -> JsonResponse:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        return JsonResponse({"status": "unavailable", "service": "lockin-api"}, status=503)
    return JsonResponse({"status": "ready", "service": "lockin-api"})


@require_POST
@csrf_protect
def client_error(request: HttpRequest) -> JsonResponse:
    if len(request.body) > 2048:
        return JsonResponse({"error": "invalid_client_error"}, status=400)
    try:
        payload = json.loads(request.body)
    except (TypeError, ValueError):
        return JsonResponse({"error": "invalid_client_error"}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({"error": "invalid_client_error"}, status=400)
    event_type = str(payload.get("event_type", ""))
    error_type = str(payload.get("error_type", ""))
    route = urlsplit(str(payload.get("route", ""))).path
    release = str(payload.get("release", ""))
    if (
        event_type not in {"error", "unhandledrejection"}
        or not _CLIENT_ERROR_TYPE.fullmatch(error_type)
        or not route.startswith("/")
        or len(route) > 200
        or not release
        or len(release) > 80
    ):
        return JsonResponse({"error": "invalid_client_error"}, status=400)

    source = client_ip(request)
    fingerprint = auth_attempt_fingerprint(
        scope="client_error", identifier="browser", remote_address=source
    )
    if auth_attempt_is_limited(
        key_hash=fingerprint,
        scope="client_error",
        window_seconds=3600,
        limit=int(getattr(settings, "CLIENT_ERROR_SOURCE_LIMIT_PER_HOUR", 30)),
    ):
        return JsonResponse({"error": "rate_limited"}, status=429)
    record_auth_attempt(key_hash=fingerprint, scope="client_error")
    context = {
        "request_id": request.META.get("LOCKIN_REQUEST_ID", ""),
        "route": route,
        "release": release,
        "event_type": event_type,
        "error_type": error_type,
    }
    providers.error_reporter.capture_exception(ClientReportedError(), context=context)
    providers.metric_sink.increment(
        "client.error.reported",
        attributes={"event_type": event_type, "error_type": error_type},
    )
    return JsonResponse({"status": "accepted"}, status=202)
