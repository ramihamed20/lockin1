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

# This configuration is only used by the local demo server.  Keep repeated
# phone-testing attempts from locking the shared demo account.
ACCOUNT_LOGIN_ATTEMPT_LIMIT = 100
