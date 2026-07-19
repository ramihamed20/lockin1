from .base import *  # noqa: F403
from .env import env, env_list

DEBUG = True
ENVIRONMENT = "development"
SECRET_KEY = env("DJANGO_SECRET_KEY", "unsafe-local-only-key")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
ACCOUNT_POLICY_VERSION = env("ACCOUNT_POLICY_VERSION", "phase3-development")
EMAIL_BACKEND = env("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
