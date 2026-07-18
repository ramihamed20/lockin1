from .base import *  # noqa: F403
from .env import env_bool

SECRET_KEY = "test-only-key"
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
ACCOUNT_POLICY_VERSION = "test-policy-v1"
PUBLIC_APP_URL = "http://testserver"
ACCOUNT_LOGIN_ATTEMPT_LIMIT = 5
PAYMENT_PROVIDER = "fake"
PAYMENT_FAKE_WEBHOOK_SECRET = "test-only-fake-webhook-secret"

if env_bool("LOCKIN_TEST_USE_SQLITE", False):
    DATABASES = {  # noqa: F405
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        }
    }
