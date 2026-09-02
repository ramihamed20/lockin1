from django.http import JsonResponse

from apps.system_configuration.services import ConfigurationError, get_configuration_value


class MaintenanceModeMiddleware:
    """Serve a safe, consistent 503 while retaining an authorized recovery path."""

    _EXEMPT_PREFIXES = ("/api/v1/health/", "/api/v1/auth/", "/admin/")

    def __init__(self, get_response):  # type: ignore[no-untyped-def]
        self.get_response = get_response

    def __call__(self, request):  # type: ignore[no-untyped-def]
        # Health and authentication endpoints must remain independently
        # available even when configuration storage is unavailable. Checking
        # the exemption first keeps liveness probe query-free and lets the
        # readiness view own its database error response.
        if request.path.startswith(self._EXEMPT_PREFIXES):
            return self.get_response(request)
        try:
            enabled = bool(get_configuration_value("platform.maintenance_mode"))
        except ConfigurationError:
            enabled = False
        if not enabled:
            return self.get_response(request)
        user = getattr(request, "user", None)
        is_recovery_admin = bool(
            user
            and user.is_authenticated
            and (
                user.is_superuser
                or user.is_staff
                or user.groups.filter(name="administrator").exists()
            )
        )
        if is_recovery_admin:
            return self.get_response(request)
        return JsonResponse(
            {
                "error": {
                    "code": "maintenance_mode",
                    "message": "The platform is temporarily undergoing maintenance.",
                    "fields": None,
                    "request_id": request.META.get("LOCKIN_REQUEST_ID"),
                }
            },
            status=503,
        )
