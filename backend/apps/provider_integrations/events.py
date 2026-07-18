from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class ProviderEventVerified(DomainEvent):
    event_name = "provider_integrations.event_verified"
    provider_event_id: UUID
    provider: str
    external_event_id: str
    event_type: str
