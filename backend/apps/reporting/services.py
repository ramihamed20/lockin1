import csv
import hashlib
import hmac
import io
import json
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.administration.permissions import has_operational_capability
from apps.analytics.models import DailyMetric
from apps.audit.services import record_audit
from apps.moderation.models import Report
from apps.system_configuration.services import get_configuration_value

from .catalog import REPORTS, ReportDefinition
from .models import ReportExport


class ReportingError(ValueError):
    pass


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _date_filters(filters: dict[str, Any]) -> tuple[date, date]:
    today = datetime.now(UTC).date()
    try:
        start = date.fromisoformat(str(filters.get("from", today - timedelta(days=13))))
        end = date.fromisoformat(str(filters.get("to", today)))
    except ValueError as error:
        raise ReportingError("Report dates must use YYYY-MM-DD.") from error
    if end < start or (end - start) > timedelta(days=366):
        raise ReportingError("Report periods must cover between 1 and 367 days.")
    return start, end


def _query_rows(definition: ReportDefinition, filters: dict[str, Any]):  # type: ignore[no-untyped-def]
    if definition.code == "analytics_daily":
        start, end = _date_filters(filters)
        return DailyMetric.objects.filter(day__gte=start, day__lte=end).values(*definition.columns)
    if definition.code == "user_directory":
        users = User.objects.all()
        status = str(filters.get("status", ""))
        if status and status not in User.Status.values:
            raise ReportingError("The user status filter is invalid.")
        if status:
            users = users.filter(status=status)
        return users.values(*definition.columns)
    if definition.code == "moderation_queue":
        statuses = [Report.Status.OPEN, Report.Status.TRIAGED, Report.Status.IN_PROGRESS]
        return Report.objects.filter(status__in=statuses).values(*definition.columns)
    raise ReportingError("Unknown report definition.")


def _validated_filters(*, definition: ReportDefinition, filters: Any) -> dict[str, str]:
    if not isinstance(filters, dict):
        raise ReportingError("Report filters must be an object.")
    normalized = {str(key): value for key, value in filters.items()}
    unexpected = set(normalized) - definition.filter_names
    if unexpected:
        raise ReportingError("One or more report filters are not supported.")
    if any(not isinstance(value, str) for value in normalized.values()):
        raise ReportingError("Report filter values must be strings.")
    return {key: value[:100] for key, value in normalized.items()}


def _csv_safe_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        value = json.dumps(value, sort_keys=True)
    if isinstance(value, str) and value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


def report_catalog_for(*, user: User) -> list[dict[str, Any]]:
    return [
        {
            "code": item.code,
            "name": item.name,
            "description": item.description,
            "schedule_ready": item.schedule_ready,
        }
        for item in REPORTS.values()
        if has_operational_capability(user, item.capability)
    ]


@transaction.atomic
def preview_report(
    *, user: User, report_code: str, filters: dict[str, Any]
) -> tuple[ReportExport, str]:
    definition = REPORTS.get(report_code)
    if definition is None or not has_operational_capability(user, definition.capability):
        raise ReportingError("This report is not available to the current operator.")
    safe_filters = _validated_filters(definition=definition, filters=filters)
    rows = _query_rows(definition, safe_filters)
    maximum = int(get_configuration_value("reporting.max_export_rows"))
    total = rows.count()
    token = secrets.token_urlsafe(32)
    export = ReportExport.objects.create(
        report_code=definition.code,
        requested_by=user,
        filters=safe_filters,
        estimated_rows=min(total, maximum),
        truncated=total > maximum,
        confirmation_digest=_digest(token),
        expires_at=timezone.now()
        + timedelta(seconds=int(get_configuration_value("operations.preview_ttl_seconds"))),
    )
    return export, token


@transaction.atomic
def execute_report(
    *, export_id: str, confirmation_token: str, user: User, source: str
) -> tuple[ReportExport, bytes]:
    try:
        export = ReportExport.objects.select_for_update().get(id=export_id, requested_by=user)
    except (ReportExport.DoesNotExist, ValueError) as error:
        raise ReportingError("Report preview was not found.") from error
    if export.status != ReportExport.Status.PREVIEWED:
        raise ReportingError("Report preview has already been used.")
    if export.expires_at <= timezone.now():
        export.status = ReportExport.Status.EXPIRED
        export.save(update_fields=("status",))
        raise ReportingError("Report preview has expired.")
    if not hmac.compare_digest(export.confirmation_digest, _digest(confirmation_token)):
        raise ReportingError("Report confirmation is invalid.")
    definition = REPORTS[export.report_code]
    if not has_operational_capability(user, definition.capability):
        raise ReportingError("Report permission changed before confirmation.")
    maximum = int(get_configuration_value("reporting.max_export_rows"))
    rows = _query_rows(definition, export.filters)[:maximum]
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=definition.columns)
    writer.writeheader()
    count = 0
    for raw_row in rows.iterator(chunk_size=500):
        writer.writerow({key: _csv_safe_value(value) for key, value in raw_row.items()})
        count += 1
    content = buffer.getvalue().encode("utf-8-sig")
    export.status = ReportExport.Status.COMPLETED
    export.row_count = count
    export.content_digest = hashlib.sha256(content).hexdigest()
    export.completed_at = timezone.now()
    export.save(update_fields=("status", "row_count", "content_digest", "completed_at"))
    record_audit(
        actor=user,
        action="reporting.export.completed",
        domain="reporting",
        target_type="reporting.export",
        target_id=str(export.id),
        reason="Confirmed operational report export.",
        source=source,
        new_state={
            "report_code": export.report_code,
            "row_count": count,
            "truncated": export.truncated,
            "content_digest": export.content_digest,
        },
    )
    return export, content
