from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
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

DATABASES["default"]["NAME"] = require_env("POSTGRES_DB")  # noqa: F405
DATABASES["default"]["USER"] = require_env("POSTGRES_USER")  # noqa: F405
DATABASES["default"]["PASSWORD"] = require_secret_env("POSTGRES_PASSWORD")  # noqa: F405
DATABASES["default"]["HOST"] = require_env("POSTGRES_HOST")  # noqa: F405
DATABASES["default"]["PORT"] = require_env("POSTGRES_PORT")  # noqa: F405
DATABASES["default"]["CONN_MAX_AGE"] = env_int("POSTGRES_CONN_MAX_AGE", 60)  # noqa: F405
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True  # noqa: F405
ssl_mode = require_env("POSTGRES_SSLMODE")
if ssl_mode not in {"disable", "require", "verify-ca", "verify-full"}:
    raise ImproperlyConfigured(
        "POSTGRES_SSLMODE must be disable, require, verify-ca, or verify-full."
    )
if ssl_mode == "disable" and not env_bool("POSTGRES_TRUSTED_PRIVATE_NETWORK", False):
    raise ImproperlyConfigured(
        "Disabling PostgreSQL TLS requires POSTGRES_TRUSTED_PRIVATE_NETWORK=true."
    )
idle_transaction_timeout_ms = env_int("POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS", 30_000)
database_options = {
    "sslmode": ssl_mode,
    "options": " ".join(
        (
            "-c application_name=lockin-api",
            f"-c statement_timeout={env_int('POSTGRES_STATEMENT_TIMEOUT_MS', 15000)}",
            f"-c lock_timeout={env_int('POSTGRES_LOCK_TIMEOUT_MS', 3000)}",
            f"-c idle_in_transaction_session_timeout={idle_transaction_timeout_ms}",
        )
    ),
}
ssl_root_cert = env("POSTGRES_SSLROOTCERT")
if ssl_mode in {"verify-ca", "verify-full"} and not ssl_root_cert:
    raise ImproperlyConfigured("Verified PostgreSQL TLS requires POSTGRES_SSLROOTCERT.")
if ssl_root_cert:
    database_options["sslrootcert"] = ssl_root_cert
DATABASES["default"]["OPTIONS"] = database_options  # noqa: F405

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
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

DATABASE_RUNTIME_ROLE = require_env("POSTGRES_RUNTIME_ROLE")

if not env_bool("DJANGO_TRUST_PROXY_SSL_HEADER", False):
    raise ImproperlyConfigured("Production requires the trusted reverse-proxy SSL header contract.")
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
