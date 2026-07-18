from pathlib import Path

from .env import env, env_int, env_list

BASE_DIR = Path(__file__).resolve().parents[2]

SECRET_KEY = env("DJANGO_SECRET_KEY", "unsafe-local-only-key")
DEBUG = False
ALLOWED_HOSTS: list[str] = []

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "apps.accounts.apps.AccountsConfig",
    "apps.focus.apps.FocusConfig",
    "apps.discovery.apps.DiscoveryConfig",
    "apps.education.apps.EducationConfig",
    "apps.files.apps.FilesConfig",
    "apps.content.apps.ContentConfig",
    "apps.questions.apps.QuestionsConfig",
    "apps.assessments.apps.AssessmentsConfig",
    "apps.progress.apps.ProgressConfig",
    "apps.community.apps.CommunityConfig",
    "apps.moderation.apps.ModerationConfig",
    "apps.xp.apps.XpConfig",
    "apps.streaks.apps.StreaksConfig",
    "apps.achievements.apps.AchievementsConfig",
    "apps.rankings.apps.RankingsConfig",
    "apps.notifications.apps.NotificationsConfig",
    "apps.motivation_integrations.apps.MotivationIntegrationsConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "platform_core.logging.middleware.RequestIdMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "lockin"),
        "USER": env("POSTGRES_USER", "lockin"),
        "PASSWORD": env("POSTGRES_PASSWORD", "replace-this-local-password"),
        "HOST": env("POSTGRES_HOST", "127.0.0.1"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": env_int("POSTGRES_CONN_MAX_AGE", 0),
        "OPTIONS": {"options": "-c application_name=lockin-api"},
    }
}

AUTH_USER_MODEL = "accounts.User"

ACCOUNT_POLICY_VERSION = env("ACCOUNT_POLICY_VERSION", "phase3-development")
ACCOUNT_EMAIL_VERIFICATION_TTL_SECONDS = env_int("ACCOUNT_EMAIL_VERIFICATION_TTL_SECONDS", 86_400)
ACCOUNT_PASSWORD_RESET_TTL_SECONDS = env_int("ACCOUNT_PASSWORD_RESET_TTL_SECONDS", 3_600)
ACCOUNT_EMAIL_CHANGE_TTL_SECONDS = env_int("ACCOUNT_EMAIL_CHANGE_TTL_SECONDS", 3_600)
ACCOUNT_SESSION_AGE_SECONDS = env_int("ACCOUNT_SESSION_AGE_SECONDS", 43_200)
ACCOUNT_REMEMBER_SESSION_AGE_SECONDS = env_int("ACCOUNT_REMEMBER_SESSION_AGE_SECONDS", 2_592_000)
ACCOUNT_LOGIN_WINDOW_SECONDS = env_int("ACCOUNT_LOGIN_WINDOW_SECONDS", 900)
ACCOUNT_LOGIN_ATTEMPT_LIMIT = env_int("ACCOUNT_LOGIN_ATTEMPT_LIMIT", 5)
ACCOUNT_SENSITIVE_WINDOW_SECONDS = env_int("ACCOUNT_SENSITIVE_WINDOW_SECONDS", 900)
ACCOUNT_SENSITIVE_REQUEST_LIMIT = env_int("ACCOUNT_SENSITIVE_REQUEST_LIMIT", 5)
PUBLIC_APP_URL = env("PUBLIC_APP_URL", "http://127.0.0.1:5173")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Lock-in <no-reply@localhost>")
EMAIL_BACKEND = env("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en"
LANGUAGES = [("en", "English"), ("ar", "Arabic")]
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/unserved-media/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CONTENT_MAX_PDF_BYTES = env_int("CONTENT_MAX_PDF_BYTES", 50 * 1024 * 1024)
CONTENT_MAX_AUDIO_BYTES = env_int("CONTENT_MAX_AUDIO_BYTES", 100 * 1024 * 1024)

COMMUNITY_DISCUSSION_RATE_WINDOW_SECONDS = env_int("COMMUNITY_DISCUSSION_RATE_WINDOW_SECONDS", 300)
COMMUNITY_DISCUSSION_RATE_LIMIT = env_int("COMMUNITY_DISCUSSION_RATE_LIMIT", 5)
COMMUNITY_COMMENT_RATE_WINDOW_SECONDS = env_int("COMMUNITY_COMMENT_RATE_WINDOW_SECONDS", 300)
COMMUNITY_COMMENT_RATE_LIMIT = env_int("COMMUNITY_COMMENT_RATE_LIMIT", 20)
COMMUNITY_EDIT_RATE_WINDOW_SECONDS = env_int("COMMUNITY_EDIT_RATE_WINDOW_SECONDS", 300)
COMMUNITY_EDIT_RATE_LIMIT = env_int("COMMUNITY_EDIT_RATE_LIMIT", 30)
MODERATION_REPORT_RATE_WINDOW_SECONDS = env_int("MODERATION_REPORT_RATE_WINDOW_SECONDS", 600)
MODERATION_REPORT_RATE_LIMIT = env_int("MODERATION_REPORT_RATE_LIMIT", 10)

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.CsrfEnforcedSessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "platform_core.api.pagination.LockinPagination",
    "PAGE_SIZE": 25,
    "EXCEPTION_HANDLER": "platform_core.api.exceptions.lockin_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Lock-in API",
    "DESCRIPTION": "Versioned API for the Lock-in university learning platform.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"()": "platform_core.logging.formatters.JsonFormatter"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "json"},
    },
    "root": {
        "handlers": ["console"],
        "level": env("DJANGO_LOG_LEVEL", "INFO"),
    },
}
