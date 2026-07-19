import pytest
from django.db import connection

pytestmark = [pytest.mark.django_db, pytest.mark.postgres]


def require_postgresql() -> None:
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL readiness evidence requires PostgreSQL.")


def test_supported_postgresql_runtime_and_transaction_features() -> None:
    require_postgresql()
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT current_setting('server_version_num')::integer, "
            "current_setting('default_transaction_isolation'), "
            "current_setting('standard_conforming_strings')"
        )
        version, isolation, conforming_strings = cursor.fetchone()

    assert int(version) >= 160_000
    assert isolation == "read committed"
    assert conforming_strings == "on"
    assert connection.features.has_select_for_update


def test_critical_indexes_and_constraints_exist_after_migration() -> None:
    require_postgresql()
    expected_indexes = {
        "focus_user_started_idx",
        "focus_annotation_sync_idx",
        "attempt_user_status_idx",
        "attempt_deadline_idx",
        "notify_user_unread_idx",
        "analytics_metric_time_idx",
        "payment_account_state_idx",
        "audit_time_id_idx",
    }
    expected_constraints = {
        "focus_workspace_zoom_range",
        "focus_sync_receipt_unique",
        "attempt_start_key_unique",
        "submission_user_key_unique",
        "notification_recipient_dedup_unique",
        "analytics_event_metric_unique",
        "payment_account_idempotent",
        "payment_refund_not_over_amount",
    }
    with connection.cursor() as cursor:
        cursor.execute("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
        indexes = {str(row[0]) for row in cursor.fetchall()}
        cursor.execute(
            "SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace"
        )
        constraints = {str(row[0]) for row in cursor.fetchall()}

    assert expected_indexes <= indexes
    assert expected_constraints <= constraints
