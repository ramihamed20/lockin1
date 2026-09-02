from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from apps.accounts.models import User
from platform_core.logging.context import remote_address_context, request_id_context

from .models import AuditRecord

_REDACTED = "[REDACTED]"
_SENSITIVE_FRAGMENTS = (
    "password",
    "secret",
    "token",
    "authorization",
    "cookie",
    "card_number",
    "recharge",
    "payment_code",
    "cvv",
)


def sanitize_audit_value(value: Any, *, depth: int = 0) -> Any:
    if depth > 5:
        return "[TRUNCATED]"
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for raw_key, raw_value in list(value.items())[:100]:
            key = str(raw_key)[:100]
            if any(fragment in key.lower() for fragment in _SENSITIVE_FRAGMENTS):
                result[key] = _REDACTED
            else:
                result[key] = sanitize_audit_value(raw_value, depth=depth + 1)
        return result
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [sanitize_audit_value(item, depth=depth + 1) for item in list(value)[:100]]
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, str):
        return value[:2000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:2000]


def record_audit(
    *,
    actor: User | None,
    action: str,
    domain: str,
    target_type: str,
    target_id: str,
    reason: str,
    source: str,
    previous_state: Mapping[str, Any] | None = None,
    new_state: Mapping[str, Any] | None = None,
    related_entities: Sequence[Mapping[str, Any]] = (),
    metadata: Mapping[str, Any] | None = None,
    correlation_id: UUID | None = None,
    ip_address: str | None = None,
) -> AuditRecord:
    resolved_correlation_id = correlation_id
    if resolved_correlation_id is None:
        raw_request_id = request_id_context.get()
        try:
            resolved_correlation_id = UUID(raw_request_id) if raw_request_id else None
        except ValueError:
            resolved_correlation_id = None
    resolved_ip = ip_address if ip_address is not None else remote_address_context.get()
    return AuditRecord.objects.create(
        actor=actor,
        action=action[:120],
        domain=domain[:60],
        target_type=target_type[:100],
        target_id=target_id[:100],
        reason=reason.strip()[:500],
        source=source[:80],
        correlation_id=resolved_correlation_id,
        ip_address=resolved_ip or None,
        previous_state=sanitize_audit_value(previous_state or {}),
        new_state=sanitize_audit_value(new_state or {}),
        related_entities=sanitize_audit_value(related_entities),
        metadata=sanitize_audit_value(metadata or {}),
    )
