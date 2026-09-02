from io import StringIO
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.core.management import CommandError, call_command
from django.db import connection
from django.test import override_settings

from config.settings.env import require_secret_env, secret_env
from platform_core.production.checks import production_security_checks
from platform_core.production.database import (
    DatabaseEvidence,
    DatabaseReleaseError,
    apply_runtime_grants,
    collect_database_evidence,
    evidence_as_dict,
    validate_role_name,
)


def secure_settings() -> dict[str, Any]:
    return {
        "ENVIRONMENT": "production",
        "DATABASES": {"default": {"ENGINE": "django.db.backends.postgresql"}},
        "EXPOSE_API_DOCS": False,
        "CONTENT_REQUIRE_CLEAN_SCAN": True,
        "SECURE_PROXY_SSL_HEADER": ("HTTP_X_FORWARDED_PROTO", "https"),
        "SESSION_COOKIE_NAME": "__Host-lockin_session",
        "CSRF_COOKIE_NAME": "__Host-lockin_csrf",
        "EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
        "EMAIL_HOST_PASSWORD": "configured",
    }


@pytest.mark.filterwarnings("ignore:Overriding setting DATABASES can lead to unexpected behavior")
def test_production_checks_accept_secure_contract() -> None:
    with override_settings(**secure_settings()):
        assert production_security_checks(None) == []


@pytest.mark.filterwarnings("ignore:Overriding setting DATABASES can lead to unexpected behavior")
def test_production_checks_report_fail_open_configuration() -> None:
    insecure = secure_settings() | {
        "DATABASES": {"default": {"ENGINE": "django.db.backends.sqlite3"}},
        "EXPOSE_API_DOCS": True,
        "CONTENT_REQUIRE_CLEAN_SCAN": False,
        "SECURE_PROXY_SSL_HEADER": None,
        "SESSION_COOKIE_NAME": "sessionid",
        "CSRF_COOKIE_NAME": "csrftoken",
        "EMAIL_HOST_PASSWORD": "",
    }
    with override_settings(**insecure):
        identifiers = {message.id for message in production_security_checks(None)}
    assert identifiers == {
        "lockin.E001",
        "lockin.E002",
        "lockin.E003",
        "lockin.E004",
        "lockin.E005",
        "lockin.E006",
    }


def test_secret_environment_supports_file_or_direct_value(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    secret_file = tmp_path / "secret"
    secret_file.write_text("file-secret\n", encoding="utf-8")
    monkeypatch.delenv("LOCKIN_TEST_SECRET", raising=False)
    monkeypatch.setenv("LOCKIN_TEST_SECRET_FILE", str(secret_file))
    assert secret_env("LOCKIN_TEST_SECRET") == "file-secret"
    assert require_secret_env("LOCKIN_TEST_SECRET") == "file-secret"

    monkeypatch.setenv("LOCKIN_TEST_SECRET", "direct-secret")
    with pytest.raises(ImproperlyConfigured, match="only one"):
        secret_env("LOCKIN_TEST_SECRET")


def test_secret_environment_rejects_missing_and_invalid_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("LOCKIN_TEST_SECRET", raising=False)
    monkeypatch.delenv("LOCKIN_TEST_SECRET_FILE", raising=False)
    with pytest.raises(ImproperlyConfigured, match="Required secret"):
        require_secret_env("LOCKIN_TEST_SECRET")
    monkeypatch.setenv("LOCKIN_TEST_SECRET_FILE", str(tmp_path / "missing"))
    with pytest.raises(ImproperlyConfigured, match="Could not read"):
        secret_env("LOCKIN_TEST_SECRET")


def test_database_release_boundaries_reject_invalid_role_and_non_postgresql() -> None:
    assert validate_role_name("lockin_app") == "lockin_app"
    with pytest.raises(DatabaseReleaseError, match="valid PostgreSQL role"):
        validate_role_name("lockin-app; DROP ROLE owner")
    if connection.vendor != "postgresql":
        with pytest.raises(DatabaseReleaseError, match="requires PostgreSQL"):
            collect_database_evidence(connection=connection)


def test_production_commands_refuse_non_production_settings() -> None:
    with pytest.raises(CommandError, match="production settings"):
        call_command("release")
    with pytest.raises(CommandError, match="production settings"):
        call_command("production_preflight")


def test_production_preflight_emits_machine_readable_success_evidence(tmp_path: Path) -> None:
    (tmp_path / "app.css").write_text("/* collected */", encoding="utf-8")
    output = StringIO()
    evidence = DatabaseEvidence(
        vendor="postgresql",
        server_version=160_010,
        current_role="lockin_runtime",
        elevated_role=False,
        schema_create=False,
        audit_mutation=False,
    )
    managed_file = MagicMock()
    managed_file.objects.exclude.return_value.filter.return_value.distinct.return_value.count.return_value = (  # noqa: E501
        0
    )
    executor = MagicMock()
    executor.return_value.loader.graph.leaf_nodes.return_value = []
    executor.return_value.migration_plan.return_value = []

    with (
        override_settings(
            ENVIRONMENT="production",
            CONTENT_REQUIRE_CLEAN_SCAN=True,
            STATIC_ROOT=tmp_path,
        ),
        patch("platform_core.management.commands.production_preflight.call_command") as check,
        patch(
            "platform_core.management.commands.production_preflight.collect_database_evidence",
            return_value=evidence,
        ),
        patch(
            "platform_core.management.commands.production_preflight.MigrationExecutor",
            executor,
        ),
        patch(
            "platform_core.management.commands.production_preflight.ManagedFile",
            managed_file,
        ),
    ):
        call_command("production_preflight", stdout=output)

    check.assert_called_once_with("check", deploy=True, fail_level="ERROR")
    assert '"status": "ready"' in output.getvalue()
    assert '"unsafe_published_files": 0' in output.getvalue()


def test_runtime_grants_are_complete_and_keep_missing_audit_table_safe() -> None:
    database = MagicMock()
    database.vendor = "postgresql"
    database.ops.quote_name.side_effect = lambda value: f'"{value}"'
    database.settings_dict = {"NAME": "lockin"}
    cursor = database.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (None,)

    apply_runtime_grants(connection=database, runtime_role="lockin_runtime")

    statements = [call.args[0] for call in cursor.execute.call_args_list]
    assert "REVOKE CREATE ON SCHEMA public FROM PUBLIC" in statements
    assert 'GRANT CONNECT ON DATABASE "lockin" TO "lockin_runtime"' in statements
    assert not any("audit_auditrecord FROM" in statement for statement in statements)


@pytest.mark.filterwarnings("ignore:Overriding setting DATABASES can lead to unexpected behavior")
def test_release_runs_ordered_production_steps_with_distinct_roles() -> None:
    output = StringIO()
    production = {
        "ENVIRONMENT": "production",
        "DATABASES": {"default": {"USER": "lockin_owner"}},
        "DATABASE_RUNTIME_ROLE": "lockin_runtime",
    }
    with (
        override_settings(**production),
        patch("platform_core.management.commands.release.call_command") as nested_command,
        patch("platform_core.management.commands.release.apply_runtime_grants") as grants,
    ):
        call_command("release", stdout=output)

    assert [call.args[0] for call in nested_command.call_args_list] == [
        "check",
        "migrate",
        "collectstatic",
    ]
    grants.assert_called_once()
    assert "Production release step completed" in output.getvalue()


def test_database_evidence_has_stable_serializable_contract() -> None:
    evidence = DatabaseEvidence(
        vendor="postgresql",
        server_version=180_004,
        current_role="lockin_runtime",
        elevated_role=False,
        schema_create=False,
        audit_mutation=False,
    )

    assert evidence_as_dict(evidence) == {
        "vendor": "postgresql",
        "server_version": 180_004,
        "current_role": "lockin_runtime",
        "elevated_role": False,
        "schema_create": False,
        "audit_mutation": False,
    }
