from drf_spectacular.extensions import OpenApiAuthenticationExtension


class CsrfSessionAuthenticationScheme(OpenApiAuthenticationExtension):  # type: ignore[no-untyped-call]
    target_class = "apps.accounts.authentication.CsrfEnforcedSessionAuthentication"
    name = "sessionCookie"

    def get_security_definition(self, auto_schema):  # type: ignore[no-untyped-def]
        return {
            "type": "apiKey",
            "in": "cookie",
            "name": "sessionid",
            "description": "Same-site session cookie. Unsafe requests also require X-CSRFToken.",
        }
