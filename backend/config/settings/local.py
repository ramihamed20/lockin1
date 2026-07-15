from .base import *  # noqa: F403
from .env import env, env_list

DEBUG = True
SECRET_KEY = env("DJANGO_SECRET_KEY", "unsafe-local-only-key")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
