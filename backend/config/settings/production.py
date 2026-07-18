from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .env import env_bool, env_int, env_list, require_env

DEBUG = False
SECRET_KEY = require_env("DJANGO_SECRET_KEY")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list explicit production hosts.")

ACCOUNT_POLICY_VERSION = require_env("ACCOUNT_POLICY_VERSION")
PUBLIC_APP_URL = require_env("PUBLIC_APP_URL")
if urlparse(PUBLIC_APP_URL).scheme != "https":
    raise ImproperlyConfigured("PUBLIC_APP_URL must use HTTPS in production.")
EMAIL_BACKEND = require_env("DJANGO_EMAIL_BACKEND")
if EMAIL_BACKEND in {
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.locmem.EmailBackend",
}:
    raise ImproperlyConfigured("Production requires a real email backend.")

if PAYMENT_PROVIDER == "fake":  # noqa: F405
    raise ImproperlyConfigured("The fake payment provider cannot run in production.")
if PAYMENT_PROVIDER != "none":  # noqa: F405
    raise ImproperlyConfigured(
        "No production payment-provider adapter is installed. Keep PAYMENT_PROVIDER=none."
    )

DATABASES["default"]["PASSWORD"] = require_env("POSTGRES_PASSWORD")  # noqa: F405
DATABASES["default"]["CONN_MAX_AGE"] = env_int("POSTGRES_CONN_MAX_AGE", 60)  # noqa: F405

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", False)

if env_bool("DJANGO_TRUST_PROXY_SSL_HEADER", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
