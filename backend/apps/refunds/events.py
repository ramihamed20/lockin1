from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class RefundRequested(DomainEvent):
    event_name = "refunds.requested"
    refund_id: UUID
    payment_id: UUID
    user_id: UUID | None
    amount_minor: int
    currency: str


@dataclass(frozen=True, slots=True, kw_only=True)
class RefundSucceeded(DomainEvent):
    event_name = "refunds.succeeded"
    refund_id: UUID
    payment_id: UUID
    subscription_id: UUID
    user_id: UUID | None
    amount_minor: int
    currency: str
    effective_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class RefundFailed(DomainEvent):
    event_name = "refunds.failed"
    refund_id: UUID
    payment_id: UUID
    user_id: UUID | None
    failure_code: str
