from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class SubscriptionCreated(DomainEvent):
    event_name = "subscriptions.created"
    subscription_id: UUID
    user_id: UUID | None
    status: str


@dataclass(frozen=True, slots=True, kw_only=True)
class SubscriptionStatusChanged(DomainEvent):
    event_name = "subscriptions.status_changed"
    subscription_id: UUID
    user_id: UUID | None
    from_status: str
    to_status: str
    effective_at: datetime
    reason_code: str


@dataclass(frozen=True, slots=True, kw_only=True)
class SubscriptionCancellationScheduled(DomainEvent):
    event_name = "subscriptions.cancellation_scheduled"
    subscription_id: UUID
    user_id: UUID
    effective_at: datetime | None
