"""Local-only SQLite settings for trying the Lock-in demo without PostgreSQL."""

from .local import *  # noqa: F403

ENVIRONMENT = "development-demo"
DATABASES = {  # noqa: F405
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / ".lockin-demo.sqlite3",  # noqa: F405
    }
}
