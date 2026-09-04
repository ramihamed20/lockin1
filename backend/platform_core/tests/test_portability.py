"""The deployment-portability contract: one URL for the database, env-only storage."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

from config.settings.database import (
    connection_max_age,
    database_options,
    parse_database_url,
    resolve_database_target,
    resolve_sslmode,
)
from config.settings.storage import (
    FILESYSTEM_BACKEND,
    S3_BACKEND,
    s3_storage_options,
    storage_backend_name,
    storages_setting,
)

STATIC_BACKEND = "django.contrib.staticfiles.storage.StaticFilesStorage"
POSTGRES_ENVIRONMENT = (
    "DATABASE_URL",
    "DATABASE_URL_FILE",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_PASSWORD_FILE",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_SSLMODE",
    "POSTGRES_CONN_MAX_AGE",
)
STORAGE_ENVIRONMENT = (
    "STORAGE_BACKEND",
    "STORAGE_BUCKET_NAME",
    "STORAGE_ENDPOINT_URL",
    "STORAGE_ACCESS_KEY_ID",
    "STORAGE_SECRET_ACCESS_KEY",
    "STORAGE_SECRET_ACCESS_KEY_FILE",
    "STORAGE_REGION",
    "STORAGE_PUBLIC_BASE_URL",
    "STORAGE_ADDRESSING_STYLE",
    "STORAGE_QUERYSTRING_AUTH",
    "STORAGE_LOCATION_PREFIX",
    "STORAGE_ALLOW_INSECURE_ENDPOINT",
)


@pytest.fixture
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in POSTGRES_ENVIRONMENT + STORAGE_ENVIRONMENT:
        monkeypatch.delenv(name, raising=False)


def test_database_url_decodes_reserved_credential_characters() -> None:
    target = parse_database_url(
        "postgresql://lockin%40owner:p%40ss%2Fword@db.example.net:6543/lockin?sslmode=require"
    )
    assert target.user == "lockin@owner"
    assert target.password == "p@ss/word"
    assert target.host == "db.example.net"
    assert target.port == "6543"
    assert target.name == "lockin"
    assert target.sslmode == "require"


def test_database_url_defaults_the_port() -> None:
    assert parse_database_url("postgres://user:secret@db.internal/lockin").port == "5432"


@pytest.mark.parametrize(
    "url",
    [
        "mysql://user:secret@db.internal/lockin",
        "postgres://user:secret@db.internal/",
        "postgres:///lockin",
        "postgres://user:secret@db.internal/lockin?sslmode=nonsense",
    ],
)
def test_database_url_rejects_unusable_values(url: str) -> None:
    with pytest.raises(ImproperlyConfigured):
        parse_database_url(url)


def test_explicit_postgres_values_override_the_url(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://runtime:runtime-pass@db.internal:5432/lockin")
    monkeypatch.setenv("POSTGRES_USER", "lockin_owner")
    monkeypatch.setenv("POSTGRES_PASSWORD", "owner-pass")

    target = resolve_database_target()

    # The release service reuses one DATABASE_URL while migrating as the owner.
    assert (target.user, target.password) == ("lockin_owner", "owner-pass")
    assert (target.host, target.name) == ("db.internal", "lockin")


def test_target_falls_back_to_supplied_defaults(clean_environment: None) -> None:
    target = resolve_database_target(
        default_name="lockin",
        default_user="lockin",
        default_password="local",
        default_host="127.0.0.1",
    )
    assert (target.name, target.user, target.host, target.port) == (
        "lockin",
        "lockin",
        "127.0.0.1",
        "5432",
    )
    assert target.missing_fields() == []


def test_missing_fields_names_every_absent_value(clean_environment: None) -> None:
    assert resolve_database_target().missing_fields() == ["host", "name", "user"]


def test_password_can_come_from_a_secret_file(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    secret = tmp_path / "postgres_password"
    secret.write_text("file-password\n", encoding="utf-8")
    monkeypatch.setenv("DATABASE_URL", "postgres://runtime:url-password@db.internal/lockin")
    monkeypatch.setenv("POSTGRES_PASSWORD_FILE", str(secret))

    assert resolve_database_target().password == "file-password"


def test_sslmode_prefers_the_setting_then_the_url_then_the_default(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from_url = parse_database_url("postgres://u:p@db.internal/lockin?sslmode=verify-full")
    assert resolve_sslmode(from_url, default="disable") == "verify-full"

    monkeypatch.setenv("POSTGRES_SSLMODE", "require")
    assert resolve_sslmode(from_url, default="disable") == "require"

    monkeypatch.delenv("POSTGRES_SSLMODE")
    plain = parse_database_url("postgres://u:p@db.internal/lockin")
    assert resolve_sslmode(plain, default="prefer") == "prefer"


def test_sslmode_rejects_unknown_values(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("POSTGRES_SSLMODE", "maybe")
    with pytest.raises(ImproperlyConfigured, match="POSTGRES_SSLMODE"):
        resolve_sslmode(parse_database_url("postgres://u:p@db.internal/lockin"), default="require")


def test_connection_options_omit_disabled_timeouts() -> None:
    options = database_options(
        application_name="lockin-api",
        sslmode="require",
        statement_timeout_ms=-1,
        lock_timeout_ms=-1,
    )
    assert options == {"sslmode": "require", "options": "-c application_name=lockin-api"}


def test_connection_options_carry_timeouts_and_root_certificate() -> None:
    options = database_options(
        application_name="lockin-api",
        sslmode="verify-full",
        sslrootcert="/secure/ca.pem",
        statement_timeout_ms=15000,
        lock_timeout_ms=3000,
        idle_transaction_timeout_ms=30000,
    )
    assert options["sslrootcert"] == "/secure/ca.pem"
    assert "-c statement_timeout=15000" in options["options"]
    assert "-c lock_timeout=3000" in options["options"]
    assert "-c idle_in_transaction_session_timeout=30000" in options["options"]


def test_connection_max_age_reads_the_environment(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert connection_max_age(60) == 60
    monkeypatch.setenv("POSTGRES_CONN_MAX_AGE", "120")
    assert connection_max_age(60) == 120


def test_storage_defaults_to_the_filesystem(clean_environment: None) -> None:
    assert storage_backend_name() == "filesystem"
    assert storages_setting(static_backend=STATIC_BACKEND) == {
        "default": {"BACKEND": FILESYSTEM_BACKEND},
        "staticfiles": {"BACKEND": STATIC_BACKEND},
    }


def test_unknown_storage_backend_is_rejected(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "dropbox")
    with pytest.raises(ImproperlyConfigured, match="STORAGE_BACKEND"):
        storage_backend_name()


def _configure_s3(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("STORAGE_BUCKET_NAME", "lockin-media")
    monkeypatch.setenv("STORAGE_ENDPOINT_URL", "https://account.r2.cloudflarestorage.com")
    monkeypatch.setenv("STORAGE_ACCESS_KEY_ID", "key-id")
    monkeypatch.setenv("STORAGE_SECRET_ACCESS_KEY", "key-secret")


def test_s3_options_are_built_from_the_environment_alone(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _configure_s3(monkeypatch)
    monkeypatch.setenv("STORAGE_REGION", "auto")

    storages = storages_setting(static_backend=STATIC_BACKEND)
    options = storages["default"]["OPTIONS"]

    assert storages["default"]["BACKEND"] == S3_BACKEND
    assert options["bucket_name"] == "lockin-media"
    assert options["endpoint_url"] == "https://account.r2.cloudflarestorage.com"
    assert options["region_name"] == "auto"
    # Objects must never be anonymously readable: no ACL, always signed.
    assert options["default_acl"] is None
    assert options["querystring_auth"] is True
    assert options["file_overwrite"] is False
    # Static assets keep their own backend so nginx still serves them.
    assert storages["staticfiles"] == {"BACKEND": STATIC_BACKEND}


def test_s3_options_require_a_bucket(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    with pytest.raises(ImproperlyConfigured, match="STORAGE_BUCKET_NAME"):
        s3_storage_options()


def test_s3_options_reject_a_half_configured_credential(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _configure_s3(monkeypatch)
    monkeypatch.delenv("STORAGE_SECRET_ACCESS_KEY")
    with pytest.raises(ImproperlyConfigured, match="STORAGE_SECRET_ACCESS_KEY"):
        s3_storage_options()


def test_plaintext_endpoints_need_an_explicit_acknowledgement(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _configure_s3(monkeypatch)
    monkeypatch.setenv("STORAGE_ENDPOINT_URL", "http://minio:9000")
    with pytest.raises(ImproperlyConfigured, match="STORAGE_ALLOW_INSECURE_ENDPOINT"):
        s3_storage_options()

    monkeypatch.setenv("STORAGE_ALLOW_INSECURE_ENDPOINT", "true")
    assert s3_storage_options()["endpoint_url"] == "http://minio:9000"


def test_path_addressing_supports_self_hosted_providers(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _configure_s3(monkeypatch)
    monkeypatch.setenv("STORAGE_ADDRESSING_STYLE", "path")
    assert s3_storage_options()["addressing_style"] == "path"

    monkeypatch.setenv("STORAGE_ADDRESSING_STYLE", "sideways")
    with pytest.raises(ImproperlyConfigured, match="STORAGE_ADDRESSING_STYLE"):
        s3_storage_options()


def test_public_base_url_becomes_a_custom_domain(
    clean_environment: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _configure_s3(monkeypatch)
    monkeypatch.setenv("STORAGE_PUBLIC_BASE_URL", "https://cdn.lockin.ly/media/")
    assert s3_storage_options()["custom_domain"] == "cdn.lockin.ly/media"

    monkeypatch.setenv("STORAGE_PUBLIC_BASE_URL", "http://cdn.lockin.ly")
    with pytest.raises(ImproperlyConfigured, match="STORAGE_PUBLIC_BASE_URL"):
        s3_storage_options()


PRODUCTION_ENVIRONMENT = {
    "DJANGO_SETTINGS_MODULE": "config.settings.production",
    "DJANGO_SECRET_KEY": "b" * 60,
    "DJANGO_ALLOWED_HOSTS": "app.example.ly",
    "PUBLIC_APP_URL": "https://app.example.ly",
    "DJANGO_CSRF_TRUSTED_ORIGINS": "https://app.example.ly",
    "ACCOUNT_POLICY_VERSION": "policy-v1",
    "DJANGO_TRUST_PROXY_SSL_HEADER": "true",
    "DJANGO_TRUSTED_PROXY_CIDRS": "127.0.0.1/32",
    "DJANGO_EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
    "DEFAULT_FROM_EMAIL": "Lock-in <no-reply@example.ly>",
    "EMAIL_HOST": "smtp.example.ly",
    "EMAIL_HOST_USER": "lockin",
    "EMAIL_HOST_PASSWORD": "smtp-password",
    "PAYMENT_CODE_ENCRYPTION_KEY": "c" * 40,
    "OBSERVABILITY_STATSD_HOST": "metrics.example.ly",
    "OBSERVABILITY_ERROR_WEBHOOK_URL": "https://monitoring.example.ly/v1/errors",
    "OBSERVABILITY_ERROR_WEBHOOK_TOKEN": "d" * 32,
    "CONTENT_REQUIRE_CLEAN_SCAN": "true",
    "FILE_SCAN_HOST": "clamav.internal",
    "STORAGE_BACKEND": "s3",
    "STORAGE_BUCKET_NAME": "lockin-media",
    "STORAGE_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
    "STORAGE_ACCESS_KEY_ID": "key-id",
    "STORAGE_SECRET_ACCESS_KEY": "key-secret",
}
PROBE = (
    "import django, json; django.setup();"
    "from django.conf import settings as s;"
    "d = s.DATABASES['default'];"
    "print(json.dumps({"
    "'host': d['HOST'], 'user': d['USER'], 'password': d['PASSWORD'], 'name': d['NAME'],"
    "'port': d['PORT'], 'sslmode': d['OPTIONS']['sslmode'],"
    "'runtime_role': s.DATABASE_RUNTIME_ROLE,"
    "'clean_scan': s.CONTENT_REQUIRE_CLEAN_SCAN,"
    "'storage': s.STORAGES['default']['BACKEND']}))"
)

MANAGED_DATABASE_URL = (
    "postgresql://lockin_app:runtime-pass@db.example.supabase.co:5432/postgres?sslmode=require"
)


# Sentinel for "remove this name from the environment entirely", which is not
# the same as setting it empty.
_UNSET = "__lockin_env_unset__"


def _boot_production(**overrides: str) -> subprocess.CompletedProcess[str]:
    """Load the real production settings module in a clean interpreter."""

    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.startswith(
            ("DJANGO_", "POSTGRES_", "STORAGE_", "DATABASE_", "LOCKIN_", "CONTENT_", "FILE_SCAN_")
        )
    }
    environment.update(PRODUCTION_ENVIRONMENT)
    environment.update({name: value for name, value in overrides.items() if value != _UNSET})
    for name, value in overrides.items():
        if value == _UNSET:
            environment.pop(name, None)
    backend_root = Path(__file__).resolve().parents[2]
    return subprocess.run(  # noqa: S603 - fixed interpreter and argument list
        [sys.executable, "-c", PROBE],
        capture_output=True,
        text=True,
        cwd=backend_root,
        env=environment,
        check=False,
    )


def test_production_boots_from_a_single_managed_database_url() -> None:
    result = _boot_production(
        DATABASE_URL="postgresql://lockin_app:runtime-pass@db.example.supabase.co:5432/postgres?sslmode=require"
    )

    assert result.returncode == 0, result.stderr
    settings = json.loads(result.stdout)
    assert settings["host"] == "db.example.supabase.co"
    assert settings["user"] == "lockin_app"
    assert settings["name"] == "postgres"
    assert settings["sslmode"] == "require"
    # A managed provider issues one role per URL, so it is also the runtime role.
    assert settings["runtime_role"] == "lockin_app"
    assert settings["storage"] == "storages.backends.s3.S3Storage"


def test_the_release_step_can_override_only_the_credentials() -> None:
    result = _boot_production(
        DATABASE_URL="postgresql://lockin_app:runtime-pass@db.example.supabase.co:5432/postgres?sslmode=require",
        POSTGRES_USER="postgres",
        POSTGRES_PASSWORD="owner-pass",
        POSTGRES_RUNTIME_ROLE="lockin_app",
    )

    assert result.returncode == 0, result.stderr
    settings = json.loads(result.stdout)
    assert (settings["user"], settings["password"]) == ("postgres", "owner-pass")
    assert settings["host"] == "db.example.supabase.co"
    # release refuses to run when the migrating role equals the runtime role.
    assert settings["runtime_role"] == "lockin_app"


def test_production_still_boots_from_discrete_postgres_values() -> None:
    result = _boot_production(
        POSTGRES_DB="lockin",
        POSTGRES_USER="lockin_app",
        POSTGRES_PASSWORD="runtime-pass",
        POSTGRES_HOST="db",
        POSTGRES_PORT="5432",
        POSTGRES_SSLMODE="disable",
        POSTGRES_TRUSTED_PRIVATE_NETWORK="true",
        POSTGRES_RUNTIME_ROLE="lockin_app",
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["host"] == "db"


def test_production_refuses_a_database_it_cannot_fully_resolve() -> None:
    result = _boot_production(POSTGRES_DB="lockin", POSTGRES_SSLMODE="require")

    assert result.returncode != 0
    assert "DATABASE_URL" in result.stderr


def test_production_refuses_an_unstated_transport() -> None:
    result = _boot_production(
        DATABASE_URL="postgresql://lockin_app:runtime-pass@db.example.supabase.co:5432/postgres"
    )

    assert result.returncode != 0
    assert "POSTGRES_SSLMODE" in result.stderr


def test_production_refuses_a_transport_that_can_silently_downgrade() -> None:
    result = _boot_production(
        DATABASE_URL="postgresql://lockin_app:p@db.example.supabase.co:5432/postgres?sslmode=prefer"
    )

    assert result.returncode != 0
    assert "POSTGRES_SSLMODE must be disable, require" in result.stderr


def test_production_refuses_local_media_without_an_explicit_exception() -> None:
    result = _boot_production(
        DATABASE_URL="postgresql://lockin_app:p@db.example.supabase.co:5432/postgres?sslmode=require",
        STORAGE_BACKEND="filesystem",
    )

    assert result.returncode != 0
    assert "STORAGE_BACKEND=s3" in result.stderr

    acknowledged = _boot_production(
        DATABASE_URL="postgresql://lockin_app:p@db.example.supabase.co:5432/postgres?sslmode=require",
        STORAGE_BACKEND="filesystem",
        STORAGE_ALLOW_LOCAL_MEDIA="true",
    )
    assert acknowledged.returncode == 0, acknowledged.stderr


def test_production_refuses_anonymously_readable_objects() -> None:
    result = _boot_production(
        DATABASE_URL="postgresql://lockin_app:p@db.example.supabase.co:5432/postgres?sslmode=require",
        STORAGE_QUERYSTRING_AUTH="false",
    )

    assert result.returncode != 0
    assert "STORAGE_QUERYSTRING_AUTH" in result.stderr


def test_production_enforces_clean_scans_unless_told_otherwise() -> None:
    """The secure default survives: an unset flag still enforces the scan gate."""

    result = _boot_production(DATABASE_URL=MANAGED_DATABASE_URL, CONTENT_REQUIRE_CLEAN_SCAN=_UNSET)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["clean_scan"] is True


def test_production_boots_with_clean_scan_enforcement_explicitly_disabled() -> None:
    """The launch shape: no scanner configured at all, and the application boots.

    Uploads are restricted to creators and administrators, so the upload surface
    is the control. Nothing about that authorisation moves with this flag.
    """

    result = _boot_production(
        DATABASE_URL=MANAGED_DATABASE_URL,
        CONTENT_REQUIRE_CLEAN_SCAN="false",
        FILE_SCAN_HOST="",
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["clean_scan"] is False


def test_enforced_clean_scans_still_require_a_reachable_scanner() -> None:
    """Turning the gate on without a scanner is a configuration error, not a silent pass."""

    result = _boot_production(
        DATABASE_URL=MANAGED_DATABASE_URL,
        CONTENT_REQUIRE_CLEAN_SCAN="true",
        FILE_SCAN_HOST="",
    )

    assert result.returncode != 0
    assert "FILE_SCAN_HOST is required" in result.stderr


def test_clean_scan_enforcement_rejects_an_ambiguous_value() -> None:
    """A typo must fail closed rather than resolve to "off"."""

    result = _boot_production(
        DATABASE_URL=MANAGED_DATABASE_URL, CONTENT_REQUIRE_CLEAN_SCAN="disabled"
    )

    assert result.returncode != 0
    assert "CONTENT_REQUIRE_CLEAN_SCAN must be a boolean" in result.stderr


# Production refuses a provider that carries some of its values and not others,
# so an example a deployment copies verbatim has to be one of the two accepted
# shapes. Shipping only a callback URL stops the API from starting at all.
OPTIONAL_OAUTH_PROVIDERS = {
    "Google": (
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REDIRECT_URI",
    ),
    "Apple": (
        "APPLE_OAUTH_SERVICES_ID",
        "APPLE_OAUTH_TEAM_ID",
        "APPLE_OAUTH_KEY_ID",
        "APPLE_OAUTH_PRIVATE_KEY",
        "APPLE_OAUTH_REDIRECT_URI",
    ),
}


def test_production_example_never_half_configures_an_optional_oauth_provider() -> None:
    example = Path(__file__).resolve().parents[3] / ".env.production.example"
    assignments: dict[str, str] = {}
    for line in example.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        name, _, value = stripped.partition("=")
        assignments[name.strip()] = value.strip()

    for provider, names in OPTIONAL_OAUTH_PROVIDERS.items():
        supplied = [name for name in names if assignments.get(name)]
        assert supplied in ([], list(names)), (
            f"{provider} OAuth is half-configured in .env.production.example "
            f"({', '.join(supplied)}); production refuses to start on that."
        )
