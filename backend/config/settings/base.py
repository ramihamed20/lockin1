from pathlib import Path

from .database import connection_max_age, database_options, resolve_database_target, resolve_sslmode
from .env import env, env_bool, env_int, env_list, secret_env
from .storage import storage_backend_name, storages_setting

BASE_DIR = Path(__file__).resolve().parents[2]

SECRET_KEY = env("DJANGO_SECRET_KEY", "unsafe-local-only-key")
DEBUG = False
ALLOWED_HOSTS: list[str] = []
ENVIRONMENT = "base"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "platform_core.apps.PlatformCoreConfig",
    "apps.accounts.apps.AccountsConfig",
    "apps.focus.apps.FocusConfig",
    "apps.discovery.apps.DiscoveryConfig",
    "apps.education.apps.EducationConfig",
    "apps.files.apps.FilesConfig",
    "apps.content.apps.ContentConfig",
    "apps.questions.apps.QuestionsConfig",
    "apps.assessments.apps.AssessmentsConfig",
    "apps.progress.apps.ProgressConfig",
    "apps.review.apps.ReviewConfig",
    "apps.study_plans.apps.StudyPlansConfig",
    "apps.community.apps.CommunityConfig",
    "apps.moderation.apps.ModerationConfig",
    "apps.xp.apps.XpConfig",
    "apps.streaks.apps.StreaksConfig",
    "apps.achievements.apps.AchievementsConfig",
    "apps.rankings.apps.RankingsConfig",
    "apps.notifications.apps.NotificationsConfig",
    "apps.motivation_integrations.apps.MotivationIntegrationsConfig",
    "apps.product_catalog.apps.ProductCatalogConfig",
    "apps.subscriptions.apps.SubscriptionsConfig",
    "apps.entitlements.apps.EntitlementsConfig",
    "apps.payments.apps.PaymentsConfig",
    "apps.invoices.apps.InvoicesConfig",
    "apps.refunds.apps.RefundsConfig",
    "apps.provider_integrations.apps.ProviderIntegrationsConfig",
    "apps.commerce_integrations.apps.CommerceIntegrationsConfig",
    "apps.audit.apps.AuditConfig",
    "apps.administration.apps.AdministrationConfig",
    "apps.system_configuration.apps.SystemConfigurationConfig",
    "apps.analytics.apps.AnalyticsConfig",
    "apps.reporting.apps.ReportingConfig",
    "apps.operational_actions.apps.OperationalActionsConfig",
    "apps.operations_integrations.apps.OperationsIntegrationsConfig",
    "apps.admin_control.apps.AdminControlConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "platform_core.logging.middleware.RequestIdMiddleware",
    "platform_core.observability.middleware.OperationalTelemetryMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "platform_core.maintenance.middleware.MaintenanceModeMiddleware",
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

DATABASE_TARGET = resolve_database_target(
    default_name="lockin",
    default_user="lockin",
    default_password="replace-this-local-password",  # noqa: S106 - local placeholder only
    default_host="127.0.0.1",
)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": DATABASE_TARGET.name,
        "USER": DATABASE_TARGET.user,
        "PASSWORD": DATABASE_TARGET.password,
        "HOST": DATABASE_TARGET.host,
        "PORT": DATABASE_TARGET.port,
        "CONN_MAX_AGE": connection_max_age(0),
        "OPTIONS": database_options(
            application_name="lockin-api",
            sslmode=resolve_sslmode(DATABASE_TARGET, default="prefer"),
            statement_timeout_ms=-1,
            lock_timeout_ms=-1,
        ),
    }
}

AUTH_USER_MODEL = "accounts.User"

ACCOUNT_POLICY_VERSION = env("ACCOUNT_POLICY_VERSION", "phase3-development")
ACCOUNT_EMAIL_VERIFICATION_TTL_SECONDS = env_int("ACCOUNT_EMAIL_VERIFICATION_TTL_SECONDS", 86_400)
ACCOUNT_PASSWORD_RESET_TTL_SECONDS = env_int("ACCOUNT_PASSWORD_RESET_TTL_SECONDS", 3_600)
ACCOUNT_EMAIL_CHANGE_TTL_SECONDS = env_int("ACCOUNT_EMAIL_CHANGE_TTL_SECONDS", 3_600)
ACCOUNT_DELETION_CONFIRM_TTL_SECONDS = env_int("ACCOUNT_DELETION_CONFIRM_TTL_SECONDS", 86_400)
ACCOUNT_DELETION_POLICY_VERSION = env("ACCOUNT_DELETION_POLICY_VERSION")
ACCOUNT_SESSION_AGE_SECONDS = env_int("ACCOUNT_SESSION_AGE_SECONDS", 43_200)
ACCOUNT_REMEMBER_SESSION_AGE_SECONDS = env_int("ACCOUNT_REMEMBER_SESSION_AGE_SECONDS", 2_592_000)
ACCOUNT_LOGIN_WINDOW_SECONDS = env_int("ACCOUNT_LOGIN_WINDOW_SECONDS", 900)
ACCOUNT_LOGIN_ATTEMPT_LIMIT = env_int("ACCOUNT_LOGIN_ATTEMPT_LIMIT", 5)
ACCOUNT_LOGIN_SOURCE_ATTEMPT_LIMIT = env_int("ACCOUNT_LOGIN_SOURCE_ATTEMPT_LIMIT", 30)
ACCOUNT_SENSITIVE_WINDOW_SECONDS = env_int("ACCOUNT_SENSITIVE_WINDOW_SECONDS", 900)
ACCOUNT_SENSITIVE_REQUEST_LIMIT = env_int("ACCOUNT_SENSITIVE_REQUEST_LIMIT", 5)
ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT = env_int("ACCOUNT_SENSITIVE_SOURCE_REQUEST_LIMIT", 30)
OPERATIONAL_DATA_RETENTION_DAYS = env_int("OPERATIONAL_DATA_RETENTION_DAYS", 30)
OPERATIONS_SCHEDULER_POLL_SECONDS = env_int("OPERATIONS_SCHEDULER_POLL_SECONDS", 15)
OPERATIONS_JOB_LEASE_SECONDS = env_int("OPERATIONS_JOB_LEASE_SECONDS", 7200)
NOTIFICATION_SCHEDULER_INTERVAL_SECONDS = env_int("NOTIFICATION_SCHEDULER_INTERVAL_SECONDS", 60)
SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS = env_int("SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS", 900)
OPERATIONAL_CLEANUP_INTERVAL_SECONDS = env_int("OPERATIONAL_CLEANUP_INTERVAL_SECONDS", 3600)
COMMERCE_RECONCILIATION_INTERVAL_SECONDS = env_int(
    "COMMERCE_RECONCILIATION_INTERVAL_SECONDS", 21600
)
ANALYTICS_REBUILD_INTERVAL_SECONDS = env_int("ANALYTICS_REBUILD_INTERVAL_SECONDS", 86400)
MOTIVATION_REBUILD_INTERVAL_SECONDS = env_int("MOTIVATION_REBUILD_INTERVAL_SECONDS", 86400)
TRUSTED_PROXY_CIDRS = env_list("DJANGO_TRUSTED_PROXY_CIDRS")
PUBLIC_APP_URL = env("PUBLIC_APP_URL", "http://127.0.0.1:5173")
GOOGLE_OAUTH_CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = secret_env("GOOGLE_OAUTH_CLIENT_SECRET")
GOOGLE_OAUTH_REDIRECT_URI = env("GOOGLE_OAUTH_REDIRECT_URI")
APPLE_OAUTH_SERVICES_ID = env("APPLE_OAUTH_SERVICES_ID")
APPLE_OAUTH_TEAM_ID = env("APPLE_OAUTH_TEAM_ID")
APPLE_OAUTH_KEY_ID = env("APPLE_OAUTH_KEY_ID")
APPLE_OAUTH_PRIVATE_KEY = secret_env("APPLE_OAUTH_PRIVATE_KEY")
APPLE_OAUTH_REDIRECT_URI = env("APPLE_OAUTH_REDIRECT_URI")
OAUTH_FLOW_TTL_SECONDS = env_int("OAUTH_FLOW_TTL_SECONDS", 600)
OAUTH_HTTP_TIMEOUT_SECONDS = env_int("OAUTH_HTTP_TIMEOUT_SECONDS", 10)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Lock-in <no-reply@localhost>")
EMAIL_BACKEND = env("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = secret_env("EMAIL_HOST_PASSWORD")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", False)
EMAIL_TIMEOUT = env_int("EMAIL_TIMEOUT_SECONDS", 10)
OBSERVABILITY_STATSD_HOST = env("OBSERVABILITY_STATSD_HOST")
OBSERVABILITY_STATSD_PORT = env_int("OBSERVABILITY_STATSD_PORT", 8125)
OBSERVABILITY_METRIC_PREFIX = env("OBSERVABILITY_METRIC_PREFIX", "lockin")
OBSERVABILITY_ERROR_WEBHOOK_URL = env("OBSERVABILITY_ERROR_WEBHOOK_URL")
OBSERVABILITY_ERROR_WEBHOOK_TOKEN = secret_env("OBSERVABILITY_ERROR_WEBHOOK_TOKEN")
OBSERVABILITY_ERROR_TIMEOUT_SECONDS = env_int("OBSERVABILITY_ERROR_TIMEOUT_SECONDS", 3)
CLIENT_ERROR_SOURCE_LIMIT_PER_HOUR = env_int("CLIENT_ERROR_SOURCE_LIMIT_PER_HOUR", 30)

AUTH_PASSWORD_VALIDATORS: list[dict[str, object]] = [
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
# Managed files are never served from a static path. Every read goes through the
# API so entitlement and scan state are enforced on each request.
MEDIA_URL = "/unserved-media/"
STORAGE_BACKEND = storage_backend_name()
STORAGES = storages_setting(
    static_backend="django.contrib.staticfiles.storage.StaticFilesStorage",
)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CONTENT_MAX_PDF_BYTES = env_int("CONTENT_MAX_PDF_BYTES", 50 * 1024 * 1024)
CONTENT_MAX_AUDIO_BYTES = env_int("CONTENT_MAX_AUDIO_BYTES", 100 * 1024 * 1024)
CONTENT_REQUIRE_CLEAN_SCAN = env_bool("CONTENT_REQUIRE_CLEAN_SCAN", False)
FILE_SCAN_HOST = env("FILE_SCAN_HOST", "127.0.0.1")
FILE_SCAN_PORT = env_int("FILE_SCAN_PORT", 3310)
FILE_SCAN_CONNECT_TIMEOUT_SECONDS = env_int("FILE_SCAN_CONNECT_TIMEOUT_SECONDS", 5)
FILE_SCAN_READ_TIMEOUT_SECONDS = env_int("FILE_SCAN_READ_TIMEOUT_SECONDS", 120)
FILE_SCAN_CHUNK_BYTES = env_int("FILE_SCAN_CHUNK_BYTES", 64 * 1024)
FILE_SCAN_MAX_ATTEMPTS = env_int("FILE_SCAN_MAX_ATTEMPTS", 3)
FILE_SCAN_RETRY_BASE_SECONDS = env_int("FILE_SCAN_RETRY_BASE_SECONDS", 30)
FILE_SCAN_RETRY_MAX_SECONDS = env_int("FILE_SCAN_RETRY_MAX_SECONDS", 900)
FILE_SCAN_CLAIM_TIMEOUT_SECONDS = env_int("FILE_SCAN_CLAIM_TIMEOUT_SECONDS", 300)
FILE_SCAN_WORKER_INTERVAL_SECONDS = env_int("FILE_SCAN_WORKER_INTERVAL_SECONDS", 10)
FILE_SCAN_BATCH_SIZE = env_int("FILE_SCAN_BATCH_SIZE", 8)

COMMUNITY_DISCUSSION_RATE_WINDOW_SECONDS = env_int("COMMUNITY_DISCUSSION_RATE_WINDOW_SECONDS", 300)
COMMUNITY_DISCUSSION_RATE_LIMIT = env_int("COMMUNITY_DISCUSSION_RATE_LIMIT", 5)
COMMUNITY_COMMENT_RATE_WINDOW_SECONDS = env_int("COMMUNITY_COMMENT_RATE_WINDOW_SECONDS", 300)
COMMUNITY_COMMENT_RATE_LIMIT = env_int("COMMUNITY_COMMENT_RATE_LIMIT", 20)
COMMUNITY_EDIT_RATE_WINDOW_SECONDS = env_int("COMMUNITY_EDIT_RATE_WINDOW_SECONDS", 300)
COMMUNITY_EDIT_RATE_LIMIT = env_int("COMMUNITY_EDIT_RATE_LIMIT", 30)
MODERATION_REPORT_RATE_WINDOW_SECONDS = env_int("MODERATION_REPORT_RATE_WINDOW_SECONDS", 600)
MODERATION_REPORT_RATE_LIMIT = env_int("MODERATION_REPORT_RATE_LIMIT", 10)

DEFAULT_TRIAL_PLAN_CODE = env("DEFAULT_TRIAL_PLAN_CODE", "lockin_trial")
PAYMENT_PROVIDER = env("PAYMENT_PROVIDER", "none")
PAYMENT_FAKE_WEBHOOK_SECRET = env("PAYMENT_FAKE_WEBHOOK_SECRET", "")
PAYMENT_WEBHOOK_TOLERANCE_SECONDS = env_int("PAYMENT_WEBHOOK_TOLERANCE_SECONDS", 300)
PAYMENT_WEBHOOK_MAX_BYTES = env_int("PAYMENT_WEBHOOK_MAX_BYTES", 65_536)
PAYMENT_CODE_ENCRYPTION_KEY = secret_env("PAYMENT_CODE_ENCRYPTION_KEY")
MANUAL_PAYMENT_RATE_WINDOW_SECONDS = env_int("MANUAL_PAYMENT_RATE_WINDOW_SECONDS", 3_600)
MANUAL_PAYMENT_RATE_LIMIT = env_int("MANUAL_PAYMENT_RATE_LIMIT", 5)
TELEGRAM_BOT_TOKEN = secret_env("TELEGRAM_BOT_TOKEN")
TELEGRAM_PAYMENT_CHAT_ID = env("TELEGRAM_PAYMENT_CHAT_ID")
TELEGRAM_HTTP_TIMEOUT_SECONDS = env_int("TELEGRAM_HTTP_TIMEOUT_SECONDS", 5)
SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS = env_int("SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS", 900)
OBSERVABILITY_SLOW_REQUEST_MS = env_int("OBSERVABILITY_SLOW_REQUEST_MS", 1000)

DATA_UPLOAD_MAX_MEMORY_SIZE = env_int("DJANGO_DATA_UPLOAD_MAX_MEMORY_BYTES", 2_621_440)
FILE_UPLOAD_MAX_MEMORY_SIZE = env_int("DJANGO_FILE_UPLOAD_MAX_MEMORY_BYTES", 2_621_440)
DATA_UPLOAD_MAX_NUMBER_FIELDS = env_int("DJANGO_DATA_UPLOAD_MAX_NUMBER_FIELDS", 1_000)
DATA_UPLOAD_MAX_NUMBER_FILES = env_int("DJANGO_DATA_UPLOAD_MAX_NUMBER_FILES", 10)
PROFILE_AVATAR_MAX_BYTES = env_int("PROFILE_AVATAR_MAX_BYTES", 5 * 1024 * 1024)
FILE_UPLOAD_PERMISSIONS = 0o640
FILE_UPLOAD_DIRECTORY_PERMISSIONS = 0o750

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
EXPOSE_API_DOCS = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.CsrfEnforcedSessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
        "apps.entitlements.access_permissions.SubscriptionProtectedPermission",
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
