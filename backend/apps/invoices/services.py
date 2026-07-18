from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.payments.models import Payment
from platform_core.events import publish_after_commit

from .events import InvoicePaid, InvoiceRefundStateChanged
from .models import Invoice, InvoiceLine, InvoiceTransition
from .validation import validate_invoice_totals


@transaction.atomic
def issue_paid_invoice(*, payment_id: UUID) -> tuple[Invoice, bool]:
    payment = (
        Payment.objects.select_for_update()
        .select_related("account", "subscription", "price")
        .get(id=payment_id, status=Payment.Status.SUCCEEDED)
    )
    existing = Invoice.objects.filter(payment=payment).first()
    if existing is not None:
        return existing, False
    validate_invoice_totals(
        subtotal_minor=payment.amount_minor,
        discount_minor=0,
        tax_minor=0,
        total_minor=payment.amount_minor,
    )
    issued_at = payment.succeeded_at or timezone.now()
    invoice_id = UUID(str(payment.id))
    number = f"LI-{issued_at:%Y}-{invoice_id.hex[:12].upper()}"
    invoice = Invoice.objects.create(
        id=invoice_id,
        number=number,
        account=payment.account,
        subscription=payment.subscription,
        payment=payment,
        status=Invoice.Status.PAID,
        currency=payment.currency,
        currency_exponent=payment.currency_exponent,
        subtotal_minor=payment.amount_minor,
        total_minor=payment.amount_minor,
        amount_paid_minor=payment.amount_minor,
        period_started_at=payment.subscription.current_period_started_at,
        period_ends_at=payment.subscription.current_period_ends_at,
        issued_at=issued_at,
        paid_at=issued_at,
    )
    snapshot = payment.price_snapshot
    InvoiceLine.objects.create(
        invoice=invoice,
        line_number=1,
        description=str(snapshot.get("plan_title", "Lock-in subscription"))[:240],
        quantity=1,
        unit_amount_minor=payment.amount_minor,
        amount_minor=payment.amount_minor,
        product_code=str(snapshot.get("product_code", ""))[:60],
        plan_code=str(snapshot.get("plan_code", ""))[:60],
        price_code=str(snapshot.get("price_code", ""))[:80],
    )
    InvoiceTransition.objects.create(
        invoice=invoice,
        from_status="",
        to_status=Invoice.Status.PAID,
        reason_code="payment_succeeded",
        source_reference=f"payment:{payment.id}",
        effective_at=issued_at,
    )
    publish_after_commit(
        InvoicePaid(
            invoice_id=invoice.id,
            payment_id=payment.id,
            user_id=payment.account.primary_user_id,
            total_minor=invoice.total_minor,
            currency=invoice.currency,
        )
    )
    return invoice, True


@transaction.atomic
def apply_invoice_refund(*, payment_id: UUID, refund_id: UUID, amount_minor: int) -> Invoice:
    invoice = (
        Invoice.objects.select_for_update().select_related("account").get(payment_id=payment_id)
    )
    if (
        amount_minor <= 0
        or invoice.amount_refunded_minor + amount_minor > invoice.amount_paid_minor
    ):
        raise ValueError("Invoice refund amount is invalid.")
    if InvoiceTransition.objects.filter(
        invoice=invoice, source_reference=f"refund:{refund_id}"
    ).exists():
        return invoice
    new_total = invoice.amount_refunded_minor + amount_minor
    to_status = (
        Invoice.Status.REFUNDED
        if new_total == invoice.amount_paid_minor
        else Invoice.Status.PARTIALLY_REFUNDED
    )
    from_status = invoice.status
    invoice.amount_refunded_minor = new_total
    invoice.status = to_status
    invoice.revision += 1
    invoice.save(update_fields=("amount_refunded_minor", "status", "revision", "updated_at"))
    InvoiceTransition.objects.create(
        invoice=invoice,
        from_status=from_status,
        to_status=to_status,
        reason_code="refund_succeeded",
        source_reference=f"refund:{refund_id}",
        effective_at=timezone.now(),
        metadata={"amount_minor": amount_minor},
    )
    publish_after_commit(
        InvoiceRefundStateChanged(
            invoice_id=invoice.id,
            user_id=invoice.account.primary_user_id,
            amount_refunded_minor=new_total,
            fully_refunded=to_status == Invoice.Status.REFUNDED,
        )
    )
    return invoice
