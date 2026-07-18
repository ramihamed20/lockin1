from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class NotificationCreated(DomainEvent):
    event_name = "notifications.created"

    notification_id: UUID
    recipient_id: UUID
    category: str
