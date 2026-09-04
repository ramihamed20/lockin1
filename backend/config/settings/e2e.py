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

# Real provider callbacks redirect back to this origin.  The inherited test
# value is the synthetic host used by the Django test client, which no browser
# can reach, so the demo server takes the running frontend origin instead.
PUBLIC_APP_URL = env("PUBLIC_APP_URL", PUBLIC_APP_URL)  # noqa: F405

# This configuration is only used by the local demo server.  Keep repeated
# phone-testing attempts from locking the shared demo account.
ACCOUNT_LOGIN_ATTEMPT_LIMIT = 100
