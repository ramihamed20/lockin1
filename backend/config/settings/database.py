"""Provider-neutral PostgreSQL configuration.

``DATABASE_URL`` is the portable contract. Managed providers (Supabase, Neon,
RDS) and container hosts publish exactly one connection URL, so accepting it
keeps the same image running on a container host, a VPS, or a workstation
without touching application code.

Discrete ``POSTGRES_*`` values remain supported and take precedence over the
URL. That ordering is deliberate: a deployment can point every service at one
``DATABASE_URL`` while the one-shot release service overrides only the
credential pair so migrations still run as the owning role.
"""

from dataclasses import dataclass, replace
from urllib.parse import parse_qsl, unquote, urlparse

from django.core.exceptions import ImproperlyConfigured

from .env import env, env_int, secret_env

POSTGRES_SCHEMES = frozenset({"postgres", "postgresql"})
SSL_MODES = frozenset({"disable", "allow", "prefer", "require", "verify-ca", "verify-full"})


@dataclass(frozen=True, slots=True)
class DatabaseTarget:
    """The resolved connection identity, independent of how it was supplied."""

    name: str
    user: str
    password: str
    host: str
    port: str
    sslmode: str = ""

    def missing_fields(self) -> list[str]:
        present = {"name": self.name, "user": self.user, "host": self.host, "port": self.port}
        return sorted(field for field, value in present.items() if not value)


def parse_database_url(url: str) -> DatabaseTarget:
    """Translate a PostgreSQL URL into connection fields.

    Percent-encoded credentials are decoded because managed providers generate
    passwords containing reserved URL characters.
    """

    parsed = urlparse(url)
    if parsed.scheme not in POSTGRES_SCHEMES:
        raise ImproperlyConfigured("DATABASE_URL must use the postgres:// or postgresql:// scheme.")
    name = unquote(parsed.path.lstrip("/"))
    if not parsed.hostname or not name or "/" in name:
        raise ImproperlyConfigured("DATABASE_URL must name a host and a single database.")
    try:
        port = parsed.port
    except ValueError as error:
        raise ImproperlyConfigured("DATABASE_URL contains an invalid port.") from error
    query = dict(parse_qsl(parsed.query))
    sslmode = query.get("sslmode", "").strip().lower()
    if sslmode and sslmode not in SSL_MODES:
        raise ImproperlyConfigured("DATABASE_URL contains an unsupported sslmode value.")
    return DatabaseTarget(
        name=name,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        host=parsed.hostname,
        port=str(port or 5432),
        sslmode=sslmode,
    )


def resolve_database_target(
    *,
    default_name: str = "",
    default_user: str = "",
    default_password: str = "",
    default_host: str = "",
    default_port: str = "5432",
) -> DatabaseTarget:
    """Resolve the connection from ``DATABASE_URL`` and ``POSTGRES_*`` overrides."""

    url = secret_env("DATABASE_URL")
    target = (
        parse_database_url(url)
        if url
        else DatabaseTarget(
            name=default_name,
            user=default_user,
            password=default_password,
            host=default_host,
            port=default_port,
        )
    )
    # An explicitly supplied value always wins so a single DATABASE_URL can be
    # shared by services that connect under different roles.
    override_password = secret_env("POSTGRES_PASSWORD")
    return replace(
        target,
        name=env("POSTGRES_DB", target.name),
        user=env("POSTGRES_USER", target.user),
        password=override_password or target.password,
        host=env("POSTGRES_HOST", target.host),
        port=env("POSTGRES_PORT", target.port),
    )


def database_options(
    *,
    application_name: str,
    sslmode: str,
    sslrootcert: str = "",
    statement_timeout_ms: int,
    lock_timeout_ms: int,
    idle_transaction_timeout_ms: int | None = None,
) -> dict[str, str]:
    """Build libpq options, omitting timeouts that are explicitly disabled."""

    directives = [f"-c application_name={application_name}"]
    if statement_timeout_ms >= 0:
        directives.append(f"-c statement_timeout={statement_timeout_ms}")
    if lock_timeout_ms >= 0:
        directives.append(f"-c lock_timeout={lock_timeout_ms}")
    if idle_transaction_timeout_ms is not None and idle_transaction_timeout_ms >= 0:
        directives.append(f"-c idle_in_transaction_session_timeout={idle_transaction_timeout_ms}")
    options = {"sslmode": sslmode, "options": " ".join(directives)}
    if sslrootcert:
        options["sslrootcert"] = sslrootcert
    return options


def resolve_sslmode(target: DatabaseTarget, *, default: str) -> str:
    """Prefer the explicit setting, then the URL's own sslmode, then the default."""

    configured = env("POSTGRES_SSLMODE") or target.sslmode or default
    if configured not in SSL_MODES:
        raise ImproperlyConfigured(
            "POSTGRES_SSLMODE must be one of: " + ", ".join(sorted(SSL_MODES)) + "."
        )
    return configured


def connection_max_age(default: int) -> int:
    return env_int("POSTGRES_CONN_MAX_AGE", default)
