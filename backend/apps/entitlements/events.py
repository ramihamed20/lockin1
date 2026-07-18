from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class EntitlementGranted(DomainEvent):
    event_name = "entitlements.granted"
    grant_id: UUID
    user_id: UUID
    entitlement_code: str
    ends_at: datetime | None


@dataclass(frozen=True, slots=True, kw_only=True)
class EntitlementRevoked(DomainEvent):
    event_name = "entitlements.revoked"
    grant_id: UUID
    user_id: UUID
    entitlement_code: str
    reason_code: str
