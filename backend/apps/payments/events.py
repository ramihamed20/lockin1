from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class PaymentInitiated(DomainEvent):
    event_name = "payments.initiated"
    payment_id: UUID
    subscription_id: UUID
    user_id: UUID | None
    amount_minor: int
    currency: str


@dataclass(frozen=True, slots=True, kw_only=True)
class PaymentSucceeded(DomainEvent):
    event_name = "payments.succeeded"
    payment_id: UUID
    subscription_id: UUID
    user_id: UUID | None
    amount_minor: int
    currency: str
    effective_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class PaymentFailed(DomainEvent):
    event_name = "payments.failed"
    payment_id: UUID
    subscription_id: UUID
    user_id: UUID | None
    failure_code: str
    effective_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class PaymentRefundStateChanged(DomainEvent):
    event_name = "payments.refund_state_changed"
    payment_id: UUID
    subscription_id: UUID
    user_id: UUID | None
    refunded_amount_minor: int
    fully_refunded: bool
