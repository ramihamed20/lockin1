from django.db import DatabaseError, connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET


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
