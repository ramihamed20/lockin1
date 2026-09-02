"""Public demonstration settings for a disposable, seeded Lock-in environment."""

from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .database import (
    connection_max_age,
    database_options,
    resolve_database_target,
    resolve_sslmode,
)
from .env import env, env_bool, env_int, env_list, require_env, require_secret_env, secret_env

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

if not secret_env("DATABASE_URL"):
    raise ImproperlyConfigured("The demo requires DATABASE_URL for its managed database.")
database_target = resolve_database_target()
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
            application_name="lockin-demo",
            sslmode=resolve_sslmode(database_target, default="require"),
            statement_timeout_ms=env_int("POSTGRES_STATEMENT_TIMEOUT_MS", 60000),
            lock_timeout_ms=env_int("POSTGRES_LOCK_TIMEOUT_MS", 5000),
        ),
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
