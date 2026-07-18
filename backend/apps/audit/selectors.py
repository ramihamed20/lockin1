from uuid import UUID

from django.db.models import QuerySet

from .models import AuditRecord


def audit_records(
    *, domain: str = "", actor_id: str = "", target_id: str = ""
) -> QuerySet[AuditRecord]:
    records = AuditRecord.objects.select_related("actor").all()
    if domain:
        records = records.filter(domain=domain)
    if actor_id:
        try:
            records = records.filter(actor_id=UUID(actor_id))
        except ValueError:
            return records.none()
    if target_id:
        records = records.filter(target_id=target_id)
    return records
