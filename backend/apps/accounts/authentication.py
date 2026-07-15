from rest_framework.authentication import SessionAuthentication


class CsrfEnforcedSessionAuthentication(SessionAuthentication):
    """Require CSRF for every unsafe browser request, including login and registration."""

    def authenticate(self, request):  # type: ignore[no-untyped-def]
        authentication = super().authenticate(request)
        if authentication is None and request.method not in {"GET", "HEAD", "OPTIONS", "TRACE"}:
            self.enforce_csrf(request)
        return authentication
