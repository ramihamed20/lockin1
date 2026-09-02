from collections.abc import Iterable

from django.apps import AppConfig
from django.conf import settings
from django.core.checks import CheckMessage, Error, Tags, Warning, register


def _error(message: str, *, identifier: str, hint: str) -> Error:
    return Error(message, hint=hint, id=identifier)


def _warning(message: str, *, identifier: str, hint: str) -> Warning:
    return Warning(message, hint=hint, id=identifier)


@register(Tags.security, deploy=True)
def production_security_checks(
    app_configs: Iterable[AppConfig] | None,
    **kwargs: object,
) -> list[CheckMessage]:
    del app_configs, kwargs
    if getattr(settings, "ENVIRONMENT", "") != "production":
        return []

    messages: list[CheckMessage] = []
    if settings.DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
        messages.append(
            _error(
                "Production must use PostgreSQL.",
                identifier="lockin.E001",
                hint="Set the production database engine to django.db.backends.postgresql.",
            )
        )
    if settings.EXPOSE_API_DOCS:
        messages.append(
            _error(
                "Interactive API documentation is exposed in production.",
                identifier="lockin.E002",
                hint="Keep EXPOSE_API_DOCS disabled and publish reviewed contracts separately.",
            )
        )
    if not settings.CONTENT_REQUIRE_CLEAN_SCAN:
        # A warning, not an error: a deployment may deliberately run without a
        # scanner when uploads are restricted to trusted operators, and boot
        # must not fail on a stated decision. It stays visible on every release
        # and preflight run so the decision is never silently inherited.
        messages.append(
            _warning(
                "Production file delivery does not require a clean scan state.",
                identifier="lockin.W003",
                hint=(
                    "Intentional only while managed-file uploads are restricted to trusted "
                    "administrators. Set CONTENT_REQUIRE_CLEAN_SCAN=true and start the "
                    "file-scanning Compose profile to enforce clean scan evidence."
                ),
            )
        )
    if settings.SECURE_PROXY_SSL_HEADER != ("HTTP_X_FORWARDED_PROTO", "https"):
        messages.append(
            _error(
                "The production reverse-proxy HTTPS contract is not configured.",
                identifier="lockin.E004",
                hint="Trust only the edge proxy that overwrites X-Forwarded-Proto.",
            )
        )
    if not str(settings.SESSION_COOKIE_NAME).startswith("__Host-") or not str(
        settings.CSRF_COOKIE_NAME
    ).startswith("__Host-"):
        messages.append(
            _error(
                "Production cookies are not host-bound.",
                identifier="lockin.E005",
                hint="Use __Host- cookie names with Secure, Path=/, and no Domain.",
            )
        )
    if settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend" and not getattr(
        settings, "EMAIL_HOST_PASSWORD", ""
    ):
        messages.append(
            _error(
                "SMTP authentication secret is missing.",
                identifier="lockin.E006",
                hint="Inject EMAIL_HOST_PASSWORD or EMAIL_HOST_PASSWORD_FILE.",
            )
        )
    return messages
