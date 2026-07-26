import io
from datetime import UTC, datetime
from uuid import uuid4
from zipfile import ZipFile

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import AccountSession, User
from apps.accounts.tests.helpers import create_user
from apps.administration.catalog import Capability
from apps.administration.models import OperationalRoleAssignment
from apps.administration.permissions import has_operational_capability
from apps.administration.services import replace_operational_roles
from apps.analytics.catalog import Metric
from apps.analytics.models import AnalyticsFact, DailyActiveLearner, DailyMetric
from apps.analytics.services import AnalyticsError, rebuild_daily_projections, record_metric
from apps.audit.models import AuditRecord
from apps.audit.services import record_audit
from apps.focus.events import FocusSessionCompleted
from apps.operational_actions.models import OperationalActionRun
from apps.reporting.models import ReportExport
from apps.system_configuration.models import ConfigurationEntry
from apps.system_configuration.services import ConfigurationError, update_configuration
from platform_core.events import domain_events

pytestmark = pytest.mark.django_db


def _admin() -> User:
    return create_user(email="platform-admin@example.com", is_superuser=True, is_staff=True)


def test_operational_roles_are_least_privilege_and_changes_are_audited() -> None:
    admin = _admin()
    operator = create_user(email="support@example.com")
    roles = replace_operational_roles(
        target=operator,
        actor=admin,
        role_codes={"support"},
        reason="Assign support coverage.",
        source="test",
    )

    assert roles == ("support",)
    assert has_operational_capability(operator, Capability.USERS_VIEW)
    assert not has_operational_capability(operator, Capability.CONFIGURATION_MANAGE)
    audit = AuditRecord.objects.get(action="administration.operational_roles.replaced")
    assert audit.actor == admin
    assert audit.previous_state == {"roles": []}
    assert audit.new_state == {"roles": ["support"]}

    client = APIClient()
    client.force_authenticate(operator)
    assert client.get("/api/v1/operations/session").status_code == 200
    assert client.get("/api/v1/operations/configuration").status_code == 403


def test_audit_records_redact_secrets_and_reject_mutation() -> None:
    admin = _admin()
    record = record_audit(
        actor=admin,
        action="test.changed",
        domain="test",
        target_type="test.entity",
        target_id="one",
        reason="Exercise immutable audit.",
        source="test",
        previous_state={"token": "secret-value", "nested": {"password": "hidden"}},
        new_state={"safe": "visible"},
    )

    assert record.previous_state["token"] == "[REDACTED]"
    assert record.previous_state["nested"]["password"] == "[REDACTED]"
    record.reason = "Changed"
    with pytest.raises(TypeError, match="immutable"):
        record.save()
    with pytest.raises(TypeError, match="immutable"):
        AuditRecord.objects.filter(id=record.id).update(reason="Changed")
    with pytest.raises(TypeError, match="immutable"):
        AuditRecord.objects.filter(id=record.id).delete()


def test_analytics_facts_are_idempotent_and_projections_are_rebuildable() -> None:
    user = create_user()
    occurred_at = datetime(2026, 7, 18, 10, 30, tzinfo=UTC)
    event_id = uuid4()

    record_metric(
        event_id=event_id,
        metric=Metric.LESSON_COMPLETIONS,
        occurred_at=occurred_at,
        source_event="education.lesson_completed",
        source_object_id=str(uuid4()),
        actor_id=user.id,
    )
    record_metric(
        event_id=event_id,
        metric=Metric.LESSON_COMPLETIONS,
        occurred_at=occurred_at,
        source_event="education.lesson_completed",
        source_object_id=str(uuid4()),
        actor_id=user.id,
    )

    assert AnalyticsFact.objects.count() == 1
    assert DailyMetric.objects.get(metric=Metric.LESSON_COMPLETIONS).value == 1
    assert DailyMetric.objects.get(metric=Metric.DAILY_ACTIVE_LEARNERS).value == 1
    assert DailyActiveLearner.objects.count() == 1

    result = rebuild_daily_projections(start=occurred_at.date(), end=occurred_at.date())
    assert result == {"facts": 1, "active_learners": 1, "projected_value": 2}
    assert DailyMetric.objects.get(metric=Metric.LESSON_COMPLETIONS).value == 1
    with pytest.raises(AnalyticsError):
        rebuild_daily_projections(
            start=occurred_at.date(), end=occurred_at.date().replace(year=2028)
        )


def test_focus_event_feeds_event_driven_analytics_once() -> None:
    user = create_user()
    event = FocusSessionCompleted(
        session_id=uuid4(),
        user_id=user.id,
        context_type="learning_object",
        context_id=uuid4(),
        active_duration_seconds=185,
    )

    domain_events.publish(event)
    domain_events.publish(event)

    assert AnalyticsFact.objects.filter(event_id=event.event_id).count() == 2
    assert DailyMetric.objects.get(metric=Metric.FOCUS_SESSIONS).value == 1
    assert DailyMetric.objects.get(metric=Metric.FOCUS_MINUTES).value == 3
    assert DailyMetric.objects.get(metric=Metric.DAILY_ACTIVE_LEARNERS).value == 1


def test_configuration_uses_validation_revision_and_audit() -> None:
    admin = _admin()
    entry = ConfigurationEntry.objects.get(key="analytics.default_window_days")

    updated = update_configuration(
        key=entry.key,
        value=21,
        expected_version=entry.version,
        actor=admin,
        reason="Use a three week view.",
        source="test",
    )

    assert updated.value == 21
    assert updated.version == 2
    assert AuditRecord.objects.filter(action="system_configuration.updated").exists()
    with pytest.raises(ConfigurationError, match="changed"):
        update_configuration(
            key=entry.key,
            value=14,
            expected_version=1,
            actor=admin,
            reason="Restore default window.",
            source="test",
        )
    with pytest.raises(ConfigurationError, match="at most"):
        update_configuration(
            key=entry.key,
            value=365,
            expected_version=2,
            actor=admin,
            reason="Invalid long window.",
            source="test",
        )


def test_user_status_action_requires_preview_and_is_idempotent() -> None:
    admin = _admin()
    target = create_user(email="target@example.com")
    AccountSession.objects.create(
        user=target,
        session_key="target-session-key",
        device_label="Test browser",
        expires_at=datetime(2027, 1, 1, tzinfo=UTC),
    )
    client = APIClient()
    client.force_authenticate(admin)

    preview = client.post(
        "/api/v1/operations/actions/previews",
        {
            "action_code": "users.set_status",
            "payload": {"user_ids": [str(target.id)], "status": "suspended"},
            "reason": "Investigate account safety report.",
            "idempotency_key": "suspend-target-0001",
        },
        format="json",
    )
    assert preview.status_code == 201
    assert preview.json()["preview"]["changes"][0]["from_status"] == "active"
    assert User.objects.get(id=target.id).status == User.Status.ACTIVE
    reused_with_different_reason = client.post(
        "/api/v1/operations/actions/previews",
        {
            "action_code": "users.set_status",
            "payload": {"user_ids": [str(target.id)], "status": "suspended"},
            "reason": "A different investigation reason.",
            "idempotency_key": "suspend-target-0001",
        },
        format="json",
    )
    assert reused_with_different_reason.status_code == 400

    execute_url = f"/api/v1/operations/actions/{preview.json()['id']}/execute"
    executed = client.post(
        execute_url,
        {"confirmation_token": preview.json()["confirmation_token"]},
        format="json",
    )
    repeated = client.post(
        execute_url,
        {"confirmation_token": preview.json()["confirmation_token"]},
        format="json",
    )

    assert executed.status_code == 200
    assert repeated.status_code == 200
    assert executed.json()["status"] == OperationalActionRun.Status.COMPLETED
    assert User.objects.get(id=target.id).status == User.Status.SUSPENDED
    assert not AccountSession.objects.filter(user=target).exists()
    assert (
        AuditRecord.objects.filter(
            action="operational_actions.user_status.changed", target_id=str(target.id)
        ).count()
        == 1
    )


def test_report_export_is_bounded_confirmed_and_audited() -> None:
    admin = _admin()
    record_metric(
        event_id=uuid4(),
        metric=Metric.LESSON_COMPLETIONS,
        occurred_at=datetime.now(UTC),
        source_event="education.lesson_completed",
        source_object_id=str(uuid4()),
        actor_id=admin.id,
    )
    client = APIClient()
    client.force_authenticate(admin)

    preview = client.post(
        "/api/v1/operations/reports/previews",
        {"report_code": "analytics_daily", "filters": {}},
        format="json",
    )
    assert preview.status_code == 201
    assert preview.json()["estimated_rows"] >= 1
    execute_url = f"/api/v1/operations/reports/{preview.json()['id']}/execute"
    response = client.post(
        execute_url,
        {"confirmation_token": preview.json()["confirmation_token"]},
        format="json",
    )

    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/csv")
    assert b"lesson_completions" in response.content
    export = ReportExport.objects.get(id=preview.json()["id"])
    assert export.status == ReportExport.Status.COMPLETED
    assert export.content_digest
    assert AuditRecord.objects.filter(action="reporting.export.completed").exists()
    assert (
        client.post(
            execute_url,
            {"confirmation_token": preview.json()["confirmation_token"]},
            format="json",
        ).status_code
        == 400
    )


def test_report_filters_are_strict_and_user_csv_blocks_formula_injection() -> None:
    admin = _admin()
    create_user(email="formula@example.com", full_name="=2+2")
    client = APIClient()
    client.force_authenticate(admin)

    invalid_filters: tuple[object, ...] = (
        [],
        {"unexpected": "value"},
        {"status": "unknown"},
    )
    for filters in invalid_filters:
        response = client.post(
            "/api/v1/operations/reports/previews",
            {"report_code": "user_directory", "filters": filters},
            format="json",
        )
        assert response.status_code == 400

    preview = client.post(
        "/api/v1/operations/reports/previews",
        {"report_code": "user_directory", "filters": {"status": "active"}},
        format="json",
    )
    assert preview.status_code == 201
    response = client.post(
        f"/api/v1/operations/reports/{preview.json()['id']}/execute",
        {"confirmation_token": preview.json()["confirmation_token"]},
        format="json",
    )
    assert response.status_code == 200
    assert b"'=2+2" in response.content


def test_report_can_be_exported_as_a_safe_excel_workbook() -> None:
    admin = _admin()
    create_user(email="excel@example.com", full_name="=unsafe-formula")
    client = APIClient()
    client.force_authenticate(admin)

    preview = client.post(
        "/api/v1/operations/reports/previews",
        {"report_code": "user_directory", "filters": {}, "output_format": "xlsx"},
        format="json",
    )
    assert preview.status_code == 201
    response = client.post(
        f"/api/v1/operations/reports/{preview.json()['id']}/execute",
        {"confirmation_token": preview.json()["confirmation_token"]},
        format="json",
    )
    assert response.status_code == 200
    assert response["Content-Type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert response.content[:2] == b"PK"
    with ZipFile(io.BytesIO(response.content)) as workbook:
        assert b"'=unsafe-formula" in workbook.read("xl/worksheets/sheet1.xml")


def test_final_effective_platform_administrator_cannot_be_suspended() -> None:
    operator = create_user(email="support-operator@example.com")
    target = create_user(email="only-platform-admin@example.com")
    OperationalRoleAssignment.objects.create(
        user=operator,
        role_id="support",
        granted_by=operator,
        reason="Cover support operations.",
    )
    OperationalRoleAssignment.objects.create(
        user=target,
        role_id="platform_administrator",
        granted_by=operator,
        reason="Bootstrap platform operations.",
    )
    client = APIClient()
    client.force_authenticate(operator)

    response = client.post(
        "/api/v1/operations/actions/previews",
        {
            "action_code": "users.set_status",
            "payload": {"user_ids": [str(target.id)], "status": "suspended"},
            "reason": "Investigate account access.",
            "idempotency_key": "protect-last-platform-admin",
        },
        format="json",
    )

    assert response.status_code == 400
    assert "final active platform administrator" in response.json()["error"]["message"]
    assert User.objects.get(id=target.id).status == User.Status.ACTIVE


def test_dashboards_are_separate_authorized_surfaces() -> None:
    admin = _admin()
    student = create_user()
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    student_client = APIClient()
    student_client.force_authenticate(student)

    for path in (
        "/api/v1/operations/dashboards/overview",
        "/api/v1/operations/dashboards/content",
        "/api/v1/operations/dashboards/support",
        "/api/v1/operations/system-health",
        "/api/v1/operations/users",
        "/api/v1/operations/audit",
    ):
        assert admin_client.get(path).status_code == 200
        assert student_client.get(path).status_code == 403

    overview = admin_client.get("/api/v1/operations/dashboards/overview").json()
    assert overview["period"]["timezone"] == "UTC"
    assert "queues" in overview
    health = admin_client.get("/api/v1/operations/system-health").json()
    assert health["status"] in {"ok", "degraded"}
    assert all("host" not in component for component in health["components"])


def test_operational_role_api_rejects_unknown_roles() -> None:
    admin = _admin()
    target = create_user()
    client = APIClient()
    client.force_authenticate(admin)
    response = client.patch(
        f"/api/v1/operations/users/{target.id}/roles",
        {"roles": ["root"], "reason": "Attempt unknown role."},
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "operational_role_change_rejected"
    assert not OperationalRoleAssignment.objects.filter(user=target).exists()
