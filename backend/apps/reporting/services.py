import csv
import hashlib
import hmac
import io
import json
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.administration.permissions import has_operational_capability
from apps.analytics.models import DailyMetric
from apps.assessments.models import Attempt
from apps.audit.models import AuditRecord
from apps.audit.services import record_audit
from apps.focus.models import FocusSession
from apps.moderation.models import Report
from apps.payments.models import Payment
from apps.subscriptions.models import Subscription
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
    if definition.code == "purchase_records":
        payments = Payment.objects.all()
        status = str(filters.get("status", ""))
        if status:
            if status not in Payment.Status.values:
                raise ReportingError("The payment status filter is invalid.")
            payments = payments.filter(status=status)
        if "from" in filters or "to" in filters:
            start, end = _date_filters(filters)
            payments = payments.filter(created_at__date__gte=start, created_at__date__lte=end)
        return payments.values(*definition.columns)
    if definition.code == "subscription_records":
        subscriptions = Subscription.objects.all()
        status = str(filters.get("status", ""))
        if status:
            if status not in Subscription.Status.values:
                raise ReportingError("The subscription status filter is invalid.")
            subscriptions = subscriptions.filter(status=status)
        if "from" in filters or "to" in filters:
            start, end = _date_filters(filters)
            subscriptions = subscriptions.filter(
                created_at__date__gte=start, created_at__date__lte=end
            )
        return subscriptions.values(*definition.columns)
    if definition.code == "focus_activity":
        start, end = _date_filters(filters)
        return FocusSession.objects.filter(
            started_at__date__gte=start, started_at__date__lte=end
        ).values(*definition.columns)
    if definition.code == "assessment_attempts":
        attempts = Attempt.objects.all()
        status = str(filters.get("status", ""))
        if status:
            if status not in Attempt.Status.values:
                raise ReportingError("The assessment status filter is invalid.")
            attempts = attempts.filter(status=status)
        if "from" in filters or "to" in filters:
            start, end = _date_filters(filters)
            attempts = attempts.filter(created_at__date__gte=start, created_at__date__lte=end)
        return attempts.values(*definition.columns)
    if definition.code == "audit_log":
        records = AuditRecord.objects.all()
        domain = str(filters.get("domain", ""))
        if domain:
            records = records.filter(domain=domain)
        if "from" in filters or "to" in filters:
            start, end = _date_filters(filters)
            records = records.filter(occurred_at__date__gte=start, occurred_at__date__lte=end)
        return records.values(*definition.columns)
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


def _xlsx_content(*, columns: tuple[str, ...], rows: Any) -> tuple[bytes, int]:
    """Create a minimal standards-compliant workbook without evaluating formulas."""
    row_xml: list[str] = []
    count = 0
    all_rows = [dict(zip(columns, columns, strict=True))]
    for raw_row in rows.iterator(chunk_size=500):
        all_rows.append({key: _csv_safe_value(raw_row.get(key, "")) for key in columns})
        count += 1
    for row_index, row in enumerate(all_rows, start=1):
        cells = "".join(
            f'<c r="{chr(64 + column_index)}{row_index}" t="inlineStr"><is><t>'
            f"{escape(str(value if value is not None else ''))}</t></is></c>"
            for column_index, value in enumerate(row.values(), start=1)
        )
        row_xml.append(f'<row r="{row_index}">{cells}</row>')
    worksheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<sheetData>" + "".join(row_xml) + "</sheetData></worksheet>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    workbook_relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )
    buffer = io.BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships)
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return buffer.getvalue(), count


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
    *,
    user: User,
    report_code: str,
    filters: dict[str, Any],
    output_format: str = ReportExport.OutputFormat.CSV,
) -> tuple[ReportExport, str]:
    definition = REPORTS.get(report_code)
    if definition is None or not has_operational_capability(user, definition.capability):
        raise ReportingError("This report is not available to the current operator.")
    safe_filters = _validated_filters(definition=definition, filters=filters)
    if output_format not in ReportExport.OutputFormat.values:
        raise ReportingError("The requested export format is invalid.")
    rows = _query_rows(definition, safe_filters)
    maximum = int(get_configuration_value("reporting.max_export_rows"))
    total = rows.count()
    token = secrets.token_urlsafe(32)
    export = ReportExport.objects.create(
        report_code=definition.code,
        output_format=output_format,
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
) -> tuple[ReportExport, bytes, str, str]:
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
    if export.output_format == ReportExport.OutputFormat.XLSX:
        content, count = _xlsx_content(columns=definition.columns, rows=rows)
        content_type, extension = (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xlsx",
        )
    else:
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=definition.columns)
        writer.writeheader()
        count = 0
        for raw_row in rows.iterator(chunk_size=500):
            writer.writerow({key: _csv_safe_value(value) for key, value in raw_row.items()})
            count += 1
        content = buffer.getvalue().encode("utf-8-sig")
        content_type, extension = "text/csv; charset=utf-8", "csv"
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
            "output_format": export.output_format,
        },
    )
    return export, content, content_type, extension
