from .env import env
from .test import *  # noqa: F403

DATABASES = {  # noqa: F405
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": env("LOCKIN_E2E_DB", str(BASE_DIR / "e2e.sqlite3")),  # noqa: F405
    }
}

ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
