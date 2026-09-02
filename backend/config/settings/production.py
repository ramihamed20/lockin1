from ipaddress import ip_network
from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .database import (
    connection_max_age,
    database_options,
    resolve_database_target,
    resolve_sslmode,
)
from .env import env, env_bool, env_int, env_list, require_env, require_secret_env

DEBUG = False
ENVIRONMENT = "production"
SECRET_KEY = require_secret_env("DJANGO_SECRET_KEY")
if len(SECRET_KEY) < 50 or SECRET_KEY.startswith(("unsafe-", "replace-", "test-")):
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be a strong production-only secret.")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list explicit production hosts.")

ACCOUNT_POLICY_VERSION = require_env("ACCOUNT_POLICY_VERSION")
PUBLIC_APP_URL = require_env("PUBLIC_APP_URL")
public_url = urlparse(PUBLIC_APP_URL)
if public_url.scheme != "https" or not public_url.hostname or public_url.username:
    raise ImproperlyConfigured("PUBLIC_APP_URL must use HTTPS in production.")
if public_url.hostname not in ALLOWED_HOSTS:
    raise ImproperlyConfigured("PUBLIC_APP_URL host must be present in DJANGO_ALLOWED_HOSTS.")


def _validate_optional_oauth_provider(
    *, provider: str, values: dict[str, str], redirect_uri: str, expected_path: str
) -> None:
    configured_values = {key: value for key, value in values.items() if value}
    if not configured_values and not redirect_uri:
        return
    missing = [key for key, value in values.items() if not value]
    if not redirect_uri:
        missing.append("redirect URI")
    if missing:
        raise ImproperlyConfigured(
            f"{provider} OAuth is partially configured; missing {', '.join(missing)}."
        )
    redirect = urlparse(redirect_uri)
    if (
        redirect.scheme != "https"
        or redirect.netloc != public_url.netloc
        or redirect.path != expected_path
        or redirect.params
        or redirect.query
        or redirect.fragment
    ):
        raise ImproperlyConfigured(
            f"{provider} OAuth redirect URI must be the production HTTPS callback {expected_path}."
        )


_validate_optional_oauth_provider(
    provider="Google",
    values={
        "client ID": GOOGLE_OAUTH_CLIENT_ID,  # noqa: F405
        "client secret": GOOGLE_OAUTH_CLIENT_SECRET,  # noqa: F405
    },
    redirect_uri=GOOGLE_OAUTH_REDIRECT_URI,  # noqa: F405
    expected_path="/api/v1/auth/oauth/google/callback",
)
_validate_optional_oauth_provider(
    provider="Apple",
    values={
        "Services ID": APPLE_OAUTH_SERVICES_ID,  # noqa: F405
        "Team ID": APPLE_OAUTH_TEAM_ID,  # noqa: F405
        "Key ID": APPLE_OAUTH_KEY_ID,  # noqa: F405
        "private key": APPLE_OAUTH_PRIVATE_KEY,  # noqa: F405
    },
    redirect_uri=APPLE_OAUTH_REDIRECT_URI,  # noqa: F405
    expected_path="/api/v1/auth/oauth/apple/callback",
)
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
if not CSRF_TRUSTED_ORIGINS or any(
    urlparse(origin).scheme != "https" for origin in CSRF_TRUSTED_ORIGINS
):
    raise ImproperlyConfigured("DJANGO_CSRF_TRUSTED_ORIGINS must contain HTTPS origins only.")
EMAIL_BACKEND = require_env("DJANGO_EMAIL_BACKEND")
DEFAULT_FROM_EMAIL = require_env("DEFAULT_FROM_EMAIL")
if "\n" in DEFAULT_FROM_EMAIL or "\r" in DEFAULT_FROM_EMAIL or "@" not in DEFAULT_FROM_EMAIL:
    raise ImproperlyConfigured("DEFAULT_FROM_EMAIL must be a valid single-line sender.")
if EMAIL_BACKEND in {
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.locmem.EmailBackend",
}:
    raise ImproperlyConfigured("Production requires a real email backend.")
if EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend":
    EMAIL_HOST = require_env("EMAIL_HOST")
    EMAIL_HOST_USER = require_env("EMAIL_HOST_USER")
    EMAIL_HOST_PASSWORD = require_secret_env("EMAIL_HOST_PASSWORD")
if EMAIL_USE_TLS and EMAIL_USE_SSL:  # noqa: F405
    raise ImproperlyConfigured("EMAIL_USE_TLS and EMAIL_USE_SSL cannot both be enabled.")

if PAYMENT_PROVIDER == "fake":  # noqa: F405
    raise ImproperlyConfigured("The fake payment provider cannot run in production.")
if PAYMENT_PROVIDER != "none":  # noqa: F405
    raise ImproperlyConfigured(
        "No production payment-provider adapter is installed. Keep PAYMENT_PROVIDER=none."
    )
PAYMENT_CODE_ENCRYPTION_KEY = require_secret_env("PAYMENT_CODE_ENCRYPTION_KEY")
if len(PAYMENT_CODE_ENCRYPTION_KEY) < 32 or PAYMENT_CODE_ENCRYPTION_KEY.startswith(
    ("replace-", "test-")
):
    raise ImproperlyConfigured(
        "PAYMENT_CODE_ENCRYPTION_KEY must be a strong, dedicated production secret."
    )
if bool(TELEGRAM_BOT_TOKEN) != bool(TELEGRAM_PAYMENT_CHAT_ID):  # noqa: F405
    raise ImproperlyConfigured(
        "Telegram payment forwarding requires both a bot token and payment chat ID."
    )
if not 60 <= SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS <= 86_400:  # noqa: F405
    raise ImproperlyConfigured(
        "SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS must be between 60 and 86400."
    )
if not OBSERVABILITY_STATSD_HOST:  # noqa: F405
    raise ImproperlyConfigured("OBSERVABILITY_STATSD_HOST is required in production.")
if not 1 <= OBSERVABILITY_STATSD_PORT <= 65_535:  # noqa: F405
    raise ImproperlyConfigured("OBSERVABILITY_STATSD_PORT must be a valid UDP port.")
error_webhook = urlparse(OBSERVABILITY_ERROR_WEBHOOK_URL)  # noqa: F405
if error_webhook.scheme != "https" or not error_webhook.hostname or error_webhook.username:
    raise ImproperlyConfigured(
        "OBSERVABILITY_ERROR_WEBHOOK_URL must be an operator-owned HTTPS endpoint."
    )
if len(OBSERVABILITY_ERROR_WEBHOOK_TOKEN) < 20:  # noqa: F405
    raise ImproperlyConfigured(
        "OBSERVABILITY_ERROR_WEBHOOK_TOKEN must be a dedicated production secret."
    )

# DATABASE_URL is the portable contract; explicit POSTGRES_* values still win so
# the one-shot release service can migrate under the owning role.
database_target = resolve_database_target()
missing_connection_fields = database_target.missing_fields()
if missing_connection_fields or not database_target.password:
    raise ImproperlyConfigured(
        "Production requires DATABASE_URL, or the complete POSTGRES_DB, POSTGRES_USER, "
        "POSTGRES_PASSWORD, POSTGRES_HOST and POSTGRES_PORT values."
    )
configured_sslmode = env("POSTGRES_SSLMODE") or database_target.sslmode
if not configured_sslmode:
    raise ImproperlyConfigured(
        "Set POSTGRES_SSLMODE, or an sslmode query parameter on DATABASE_URL, so the "
        "database transport is explicit."
    )
ssl_mode = resolve_sslmode(database_target, default=configured_sslmode)
# "allow" and "prefer" silently downgrade to plaintext, so production excludes them.
if ssl_mode not in {"disable", "require", "verify-ca", "verify-full"}:
    raise ImproperlyConfigured(
        "POSTGRES_SSLMODE must be disable, require, verify-ca, or verify-full."
    )
if ssl_mode == "disable" and not env_bool("POSTGRES_TRUSTED_PRIVATE_NETWORK", False):
    raise ImproperlyConfigured(
        "Disabling PostgreSQL TLS requires POSTGRES_TRUSTED_PRIVATE_NETWORK=true."
    )
ssl_root_cert = env("POSTGRES_SSLROOTCERT")
if ssl_mode in {"verify-ca", "verify-full"} and not ssl_root_cert:
    raise ImproperlyConfigured("Verified PostgreSQL TLS requires POSTGRES_SSLROOTCERT.")
DATABASES["default"].update(  # noqa: F405
    {
        "NAME": database_target.name,
        "USER": database_target.user,
        "PASSWORD": database_target.password,
        "HOST": database_target.host,
        "PORT": database_target.port,
        "CONN_MAX_AGE": connection_max_age(60),
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": database_options(
            application_name="lockin-api",
            sslmode=ssl_mode,
            sslrootcert=ssl_root_cert,
            statement_timeout_ms=env_int("POSTGRES_STATEMENT_TIMEOUT_MS", 15000),
            lock_timeout_ms=env_int("POSTGRES_LOCK_TIMEOUT_MS", 3000),
            idle_transaction_timeout_ms=env_int("POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS", 30000),
        ),
    }
)

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_NAME = "__Host-lockin_session"
SESSION_COOKIE_PATH = "/"
SESSION_COOKIE_DOMAIN = None
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_NAME = "__Host-lockin_csrf"
CSRF_COOKIE_PATH = "/"
CSRF_COOKIE_DOMAIN = None
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 3600)
if SECURE_HSTS_SECONDS < 300:
    raise ImproperlyConfigured("DJANGO_SECURE_HSTS_SECONDS must be at least 300 in production.")
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", True)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", False)
SECURE_REFERRER_POLICY = "no-referrer"
EXPOSE_API_DOCS = False
CONTENT_REQUIRE_CLEAN_SCAN = True
if not FILE_SCAN_HOST:  # noqa: F405
    raise ImproperlyConfigured("FILE_SCAN_HOST is required when clean scans are enforced.")
if not 1 <= FILE_SCAN_PORT <= 65_535:  # noqa: F405
    raise ImproperlyConfigured("FILE_SCAN_PORT must be a valid TCP port.")
if not 1 <= FILE_SCAN_MAX_ATTEMPTS <= 10:  # noqa: F405
    raise ImproperlyConfigured("FILE_SCAN_MAX_ATTEMPTS must be between 1 and 10.")
scan_read_timeout = FILE_SCAN_READ_TIMEOUT_SECONDS  # noqa: F405
scan_claim_timeout = FILE_SCAN_CLAIM_TIMEOUT_SECONDS  # noqa: F405
if scan_read_timeout < 1 or scan_claim_timeout <= scan_read_timeout:
    raise ImproperlyConfigured(
        "FILE_SCAN_CLAIM_TIMEOUT_SECONDS must exceed the scanner read timeout."
    )
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Private study material belongs in object storage: container-host disks are
# ephemeral and a host volume cannot follow the application across a migration.
if STORAGE_BACKEND == "filesystem" and not env_bool(  # noqa: F405
    "STORAGE_ALLOW_LOCAL_MEDIA", False
):
    raise ImproperlyConfigured(
        "Production private media must use object storage. Set STORAGE_BACKEND=s3, or set "
        "STORAGE_ALLOW_LOCAL_MEDIA=true only for a single-host deployment whose media volume "
        "is backed up with the database."
    )
if STORAGE_BACKEND == "s3" and not STORAGES["default"]["OPTIONS"]["querystring_auth"]:  # noqa: F405
    raise ImproperlyConfigured(
        "STORAGE_QUERYSTRING_AUTH must stay enabled so bucket objects are never anonymously "
        "readable."
    )

# Managed providers issue one role per URL, so the runtime role defaults to the
# connecting user and stays overridable where owner/runtime separation exists.
DATABASE_RUNTIME_ROLE = env("POSTGRES_RUNTIME_ROLE", database_target.user)
if not DATABASE_RUNTIME_ROLE:
    raise ImproperlyConfigured("POSTGRES_RUNTIME_ROLE must name the runtime database role.")

if not env_bool("DJANGO_TRUST_PROXY_SSL_HEADER", False):
    raise ImproperlyConfigured("Production requires the trusted reverse-proxy SSL header contract.")
if not TRUSTED_PROXY_CIDRS:  # noqa: F405
    raise ImproperlyConfigured("DJANGO_TRUSTED_PROXY_CIDRS must identify the edge proxy network.")
try:
    tuple(ip_network(value, strict=False) for value in TRUSTED_PROXY_CIDRS)  # noqa: F405
except ValueError as error:
    raise ImproperlyConfigured("DJANGO_TRUSTED_PROXY_CIDRS contains an invalid network.") from error
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
