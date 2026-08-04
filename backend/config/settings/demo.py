"""Public demonstration settings for a disposable, seeded Lock-in environment."""

from urllib.parse import unquote, urlparse

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .env import env, env_bool, env_int, env_list, require_env, require_secret_env

DEBUG = False
ENVIRONMENT = "demo"
SECRET_KEY = require_secret_env("DJANGO_SECRET_KEY")
if len(SECRET_KEY) < 50:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be at least 50 characters for the demo.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list the public Render host.")

PUBLIC_APP_URL = require_env("PUBLIC_APP_URL")
public_url = urlparse(PUBLIC_APP_URL)
if (
    public_url.scheme != "https"
    or not public_url.hostname
    or public_url.hostname not in ALLOWED_HOSTS
):
    raise ImproperlyConfigured("PUBLIC_APP_URL must use HTTPS and match DJANGO_ALLOWED_HOSTS.")

CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", PUBLIC_APP_URL)
if not CSRF_TRUSTED_ORIGINS or any(
    urlparse(origin).scheme != "https" for origin in CSRF_TRUSTED_ORIGINS
):
    raise ImproperlyConfigured("DJANGO_CSRF_TRUSTED_ORIGINS must contain HTTPS origins only.")

database_url = require_secret_env("DATABASE_URL")
parsed_database = urlparse(database_url)
if (
    parsed_database.scheme not in {"postgres", "postgresql"}
    or not parsed_database.hostname
    or not parsed_database.path
):
    raise ImproperlyConfigured("DATABASE_URL must be a valid PostgreSQL connection URL.")

DATABASES["default"].update(  # noqa: F405
    {
        "NAME": unquote(parsed_database.path.lstrip("/")),
        "USER": unquote(parsed_database.username or ""),
        "PASSWORD": unquote(parsed_database.password or ""),
        "HOST": parsed_database.hostname,
        "PORT": str(parsed_database.port or 5432),
        "CONN_MAX_AGE": env_int("POSTGRES_CONN_MAX_AGE", 60),
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": {
            "sslmode": env("POSTGRES_SSLMODE", "require"),
            "options": (
                "-c application_name=lockin-demo "
                f"-c statement_timeout={env_int('POSTGRES_STATEMENT_TIMEOUT_MS', 60000)} "
                f"-c lock_timeout={env_int('POSTGRES_LOCK_TIMEOUT_MS', 5000)}"
            ),
        },
    }
)

ACCOUNT_POLICY_VERSION = require_env("ACCOUNT_POLICY_VERSION")
EMAIL_BACKEND = env("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Lock-in Demo <demo@lockin.invalid>")
PAYMENT_PROVIDER = "none"
CONTENT_REQUIRE_CLEAN_SCAN = False
DATABASE_RUNTIME_ROLE = "lockin_demo"

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 300)
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
EXPOSE_API_DOCS = False
