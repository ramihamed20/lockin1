from .base import *  # noqa: F403
from .env import env, env_bool

SECRET_KEY = "test-only-key"
ENVIRONMENT = "testing"
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
ACCOUNT_POLICY_VERSION = "test-policy-v1"
PUBLIC_APP_URL = "http://testserver"
ACCOUNT_LOGIN_ATTEMPT_LIMIT = 5
PAYMENT_PROVIDER = "fake"
PAYMENT_FAKE_WEBHOOK_SECRET = "test-only-fake-webhook-secret"

# A convenience for running the suite without a PostgreSQL service. It is not
# equivalent, and one difference is worth stating plainly:
#
# SQLite reports has_select_for_update = False, so Django silently discards
# every select_for_update() rather than emitting it. A green run here is
# therefore NO evidence about row locking, and it cannot detect a query that
# PostgreSQL rejects outright -- such as FOR UPDATE against the nullable side of
# an outer join, which SQLite executes happily and PostgreSQL refuses.
#
# PostgreSQL CI is the authoritative test for database locking behaviour. Treat
# a SQLite run as a fast syntax and business-logic check only.
if env_bool("LOCKIN_TEST_USE_SQLITE", False):
    DATABASES = {  # noqa: F405
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": env("LOCKIN_TEST_SQLITE_PATH", ":memory:"),
        }
    }
