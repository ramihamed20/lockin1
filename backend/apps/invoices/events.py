from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class InvoicePaid(DomainEvent):
    event_name = "invoices.paid"
    invoice_id: UUID
    payment_id: UUID
    user_id: UUID | None
    total_minor: int
    currency: str


@dataclass(frozen=True, slots=True, kw_only=True)
class InvoiceRefundStateChanged(DomainEvent):
    event_name = "invoices.refund_state_changed"
    invoice_id: UUID
    user_id: UUID | None
    amount_refunded_minor: int
    fully_refunded: bool
