from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.payments.models import Payment
from platform_core.events import publish_after_commit

from .events import RefundFailed, RefundRequested, RefundSucceeded
from .models import Refund, RefundTransition
from .validation import validate_refund_transition


@dataclass(frozen=True, slots=True)
class RefundTransitionResult:
    refund: Refund
    changed: bool


@transaction.atomic
def request_refund(
    *, payment_id: UUID, actor: User, amount_minor: int, reason: str, idempotency_key: str
) -> tuple[Refund, bool]:
    if not idempotency_key:
        raise ValueError("An idempotency key is required.")
    payment = Payment.objects.select_for_update().select_related("account").get(id=payment_id)
    existing = Refund.objects.filter(payment=payment, idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing, False
    if payment.status not in (
        Payment.Status.SUCCEEDED,
        Payment.Status.PARTIALLY_REFUNDED,
    ):
        raise ValueError("Only a settled payment can be refunded.")
    reserved = (
        payment.refunds.filter(
            status__in=(Refund.Status.REQUESTED, Refund.Status.PENDING, Refund.Status.SUCCEEDED)
        ).aggregate(total=Sum("amount_minor"))["total"]
        or 0
    )
    if amount_minor <= 0 or amount_minor > payment.amount_minor - reserved:
        raise ValueError("Refund amount exceeds the refundable payment balance.")
    now = timezone.now()
    refund = Refund.objects.create(
        payment=payment,
        requested_by=actor,
        amount_minor=amount_minor,
        currency=payment.currency,
        currency_exponent=payment.currency_exponent,
        reason=reason.strip()[:240],
        idempotency_key=idempotency_key,
        requested_at=now,
    )
    RefundTransition.objects.create(
        refund=refund,
        from_status="",
        to_status=Refund.Status.REQUESTED,
        source=RefundTransition.Source.ADMIN,
        reason_code="refund_requested",
        idempotency_key=f"requested:{refund.id}",
        effective_at=now,
    )
    publish_after_commit(
        RefundRequested(
            refund_id=refund.id,
            payment_id=payment.id,
            user_id=payment.account.primary_user_id,
            amount_minor=refund.amount_minor,
            currency=refund.currency,
            actor_id=actor.id,
        )
    )
    return refund, True


@transaction.atomic
def mark_refund_pending(*, refund_id: UUID, source_reference: str) -> Refund:
    refund = Refund.objects.select_for_update().get(id=refund_id)
    if refund.status == Refund.Status.PENDING:
        return refund
    validate_refund_transition(from_status=refund.status, to_status=Refund.Status.PENDING)
    from_status = refund.status
    refund.status = Refund.Status.PENDING
    refund.revision += 1
    refund.save(update_fields=("status", "revision", "updated_at"))
    RefundTransition.objects.create(
        refund=refund,
        from_status=from_status,
        to_status=refund.status,
        source=RefundTransition.Source.ADMIN,
        reason_code="provider_request_created",
        idempotency_key=f"provider-request:{source_reference}",
        source_reference=source_reference,
        effective_at=timezone.now(),
    )
    return refund


@transaction.atomic
def apply_provider_refund_state(
    *,
    refund_id: UUID,
    to_status: str,
    amount_minor: int,
    currency: str,
    effective_at: datetime,
    provider_event_id: UUID,
    failure_code: str = "",
) -> RefundTransitionResult:
    refund = Refund.objects.select_for_update().select_related("payment__account").get(id=refund_id)
    idempotency_key = f"provider-event:{provider_event_id}"
    if RefundTransition.objects.filter(refund=refund, idempotency_key=idempotency_key).exists():
        return RefundTransitionResult(refund=refund, changed=False)
    if amount_minor != refund.amount_minor or currency.upper() != refund.currency:
        raise ValueError("Verified provider amount or currency does not match the refund record.")
    latest = refund.transitions.order_by("-effective_at", "-created_at").first()
    if latest is not None and effective_at < latest.effective_at:
        RefundTransition.objects.create(
            refund=refund,
            from_status=refund.status,
            to_status=refund.status,
            source=RefundTransition.Source.PROVIDER,
            reason_code="out_of_order_ignored",
            idempotency_key=idempotency_key,
            source_reference=str(provider_event_id),
            effective_at=effective_at,
            metadata={"requested_status": to_status},
        )
        return RefundTransitionResult(refund=refund, changed=False)
    from_status = refund.status
    validate_refund_transition(from_status=from_status, to_status=to_status)
    refund.status = to_status
    refund.failure_code = failure_code[:80]
    refund.revision += 1
    if to_status == Refund.Status.SUCCEEDED:
        refund.succeeded_at = effective_at
    elif to_status == Refund.Status.FAILED:
        refund.failed_at = effective_at
    refund.save()
    RefundTransition.objects.create(
        refund=refund,
        from_status=from_status,
        to_status=to_status,
        source=RefundTransition.Source.PROVIDER,
        reason_code="provider_confirmed",
        idempotency_key=idempotency_key,
        source_reference=str(provider_event_id),
        effective_at=effective_at,
        metadata={"failure_code": failure_code[:80]},
    )
    if to_status == Refund.Status.SUCCEEDED:
        publish_after_commit(
            RefundSucceeded(
                refund_id=refund.id,
                payment_id=refund.payment_id,
                subscription_id=refund.payment.subscription_id,
                user_id=refund.payment.account.primary_user_id,
                amount_minor=refund.amount_minor,
                currency=refund.currency,
                effective_at=effective_at,
            )
        )
    elif to_status == Refund.Status.FAILED:
        publish_after_commit(
            RefundFailed(
                refund_id=refund.id,
                payment_id=refund.payment_id,
                user_id=refund.payment.account.primary_user_id,
                failure_code=refund.failure_code,
            )
        )
    return RefundTransitionResult(refund=refund, changed=True)
