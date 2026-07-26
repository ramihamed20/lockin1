from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.product_catalog.models import Price
from apps.subscriptions.models import Subscription, SubscriptionAccount
from platform_core.events import publish_after_commit

from .events import PaymentFailed, PaymentInitiated, PaymentRefundStateChanged, PaymentSucceeded
from .models import Payment, PaymentTransition
from .validation import validate_payment_transition


@dataclass(frozen=True, slots=True)
class PaymentTransitionResult:
    payment: Payment
    changed: bool


def _price_snapshot(price: Price) -> dict[str, object]:
    version = price.plan_version
    return {
        "product_code": version.plan.product.code,
        "plan_code": version.plan.code,
        "plan_version": version.version,
        "plan_title": version.title,
        "price_code": price.code,
        "amount_minor": price.amount_minor,
        "currency": price.currency,
        "currency_exponent": price.currency_exponent,
        "region_code": price.region_code,
        "interval": price.interval,
        "interval_count": price.interval_count,
        "tax_behavior": price.tax_behavior,
    }


@transaction.atomic
def create_payment(
    *,
    account: SubscriptionAccount,
    subscription: Subscription,
    price: Price,
    idempotency_key: str,
) -> tuple[Payment, bool]:
    if not idempotency_key:
        raise ValueError("An idempotency key is required.")
    if (
        subscription.account_id != account.id
        or subscription.plan_version_id != price.plan_version_id
    ):
        raise ValueError("Payment price and subscription must describe the same account plan.")
    existing = Payment.objects.filter(account=account, idempotency_key=idempotency_key).first()
    if existing is not None:
        return existing, False
    now = timezone.now()
    payment = Payment.objects.create(
        account=account,
        subscription=subscription,
        price=price,
        amount_minor=price.amount_minor,
        currency=price.currency,
        currency_exponent=price.currency_exponent,
        status=Payment.Status.INITIATED,
        idempotency_key=idempotency_key,
        price_snapshot=_price_snapshot(price),
        initiated_at=now,
    )
    PaymentTransition.objects.create(
        payment=payment,
        from_status="",
        to_status=Payment.Status.INITIATED,
        source=PaymentTransition.Source.SYSTEM,
        reason_code="payment_created",
        idempotency_key=f"created:{payment.id}",
        effective_at=now,
    )
    publish_after_commit(
        PaymentInitiated(
            payment_id=payment.id,
            subscription_id=subscription.id,
            user_id=account.primary_user_id,
            amount_minor=payment.amount_minor,
            currency=payment.currency,
        )
    )
    return payment, True


@transaction.atomic
def apply_provider_payment_state(
    *,
    payment_id: UUID,
    to_status: str,
    amount_minor: int,
    currency: str,
    effective_at: datetime,
    provider_event_id: UUID,
    failure_code: str = "",
) -> PaymentTransitionResult:
    payment = (
        Payment.objects.select_for_update()
        .select_related("account", "subscription")
        .get(id=payment_id)
    )
    idempotency_key = f"provider-event:{provider_event_id}"
    if PaymentTransition.objects.filter(payment=payment, idempotency_key=idempotency_key).exists():
        return PaymentTransitionResult(payment=payment, changed=False)
    if amount_minor != payment.amount_minor or currency.upper() != payment.currency:
        raise ValueError("Verified provider amount or currency does not match the payment record.")
    latest = payment.transitions.order_by("-effective_at", "-created_at").first()
    if latest is not None and effective_at < latest.effective_at:
        PaymentTransition.objects.create(
            payment=payment,
            from_status=payment.status,
            to_status=payment.status,
            source=PaymentTransition.Source.PROVIDER,
            reason_code="out_of_order_ignored",
            idempotency_key=idempotency_key,
            source_reference=str(provider_event_id),
            effective_at=effective_at,
            metadata={"requested_status": to_status},
        )
        return PaymentTransitionResult(payment=payment, changed=False)
    from_status = payment.status
    validate_payment_transition(from_status=from_status, to_status=to_status)
    payment.status = to_status
    payment.failure_code = failure_code[:80]
    payment.revision += 1
    if to_status == Payment.Status.SUCCEEDED:
        payment.succeeded_at = effective_at
    elif to_status == Payment.Status.FAILED:
        payment.failed_at = effective_at
    payment.save()
    PaymentTransition.objects.create(
        payment=payment,
        from_status=from_status,
        to_status=to_status,
        source=PaymentTransition.Source.PROVIDER,
        reason_code="provider_confirmed",
        idempotency_key=idempotency_key,
        source_reference=str(provider_event_id),
        effective_at=effective_at,
        metadata={"failure_code": failure_code[:80]},
    )
    if to_status == Payment.Status.SUCCEEDED:
        publish_after_commit(
            PaymentSucceeded(
                payment_id=payment.id,
                subscription_id=payment.subscription_id,
                user_id=payment.account.primary_user_id,
                amount_minor=payment.amount_minor,
                currency=payment.currency,
                effective_at=effective_at,
            )
        )
    elif to_status == Payment.Status.FAILED:
        publish_after_commit(
            PaymentFailed(
                payment_id=payment.id,
                subscription_id=payment.subscription_id,
                user_id=payment.account.primary_user_id,
                failure_code=payment.failure_code,
                effective_at=effective_at,
            )
        )
    return PaymentTransitionResult(payment=payment, changed=True)


@transaction.atomic
def apply_admin_reconciled_payment_state(
    *,
    payment_id: UUID,
    to_status: str,
    provider_reference: str,
    correction_id: UUID,
    effective_at: datetime,
) -> PaymentTransitionResult:
    """Apply a dual-controlled correction using the ordinary payment rules.

    This path is deliberately separate from provider webhooks.  It is only
    called after a second administrator approved documented provider evidence.
    """
    payment = (
        Payment.objects.select_for_update()
        .select_related("account", "subscription")
        .get(id=payment_id)
    )
    idempotency_key = f"admin-correction:{correction_id}"
    if PaymentTransition.objects.filter(payment=payment, idempotency_key=idempotency_key).exists():
        return PaymentTransitionResult(payment=payment, changed=False)
    if not provider_reference.strip():
        raise ValueError("A verified provider reference is required for payment reconciliation.")
    validate_payment_transition(from_status=payment.status, to_status=to_status)
    from_status = payment.status
    payment.status = to_status
    payment.failure_code = "" if to_status == Payment.Status.SUCCEEDED else payment.failure_code
    payment.revision += 1
    if to_status == Payment.Status.SUCCEEDED:
        payment.succeeded_at = effective_at
    elif to_status == Payment.Status.FAILED:
        payment.failed_at = effective_at
    payment.save()
    PaymentTransition.objects.create(
        payment=payment,
        from_status=from_status,
        to_status=to_status,
        source=PaymentTransition.Source.RECONCILIATION,
        reason_code="dual_controlled_admin_reconciliation",
        idempotency_key=idempotency_key,
        source_reference=provider_reference.strip()[:180],
        effective_at=effective_at,
        metadata={"correction_id": str(correction_id)},
    )
    if to_status == Payment.Status.SUCCEEDED:
        publish_after_commit(
            PaymentSucceeded(
                payment_id=payment.id,
                subscription_id=payment.subscription_id,
                user_id=payment.account.primary_user_id,
                amount_minor=payment.amount_minor,
                currency=payment.currency,
                effective_at=effective_at,
            )
        )
    elif to_status == Payment.Status.FAILED:
        publish_after_commit(
            PaymentFailed(
                payment_id=payment.id,
                subscription_id=payment.subscription_id,
                user_id=payment.account.primary_user_id,
                failure_code=payment.failure_code,
                effective_at=effective_at,
            )
        )
    return PaymentTransitionResult(payment=payment, changed=True)


@transaction.atomic
def apply_successful_refund(*, payment_id: UUID, amount_minor: int, refund_id: UUID) -> Payment:
    payment = Payment.objects.select_for_update().select_related("account").get(id=payment_id)
    transition_key = f"refund:{refund_id}"
    if PaymentTransition.objects.filter(payment=payment, idempotency_key=transition_key).exists():
        return payment
    if amount_minor <= 0:
        raise ValueError("Refund amount must be positive.")
    new_total = payment.refunded_amount_minor + amount_minor
    if new_total > payment.amount_minor:
        raise ValueError("Refund total cannot exceed the payment amount.")
    to_status = (
        Payment.Status.REFUNDED
        if new_total == payment.amount_minor
        else Payment.Status.PARTIALLY_REFUNDED
    )
    validate_payment_transition(from_status=payment.status, to_status=to_status)
    from_status = payment.status
    payment.refunded_amount_minor = new_total
    payment.status = to_status
    payment.revision += 1
    payment.save(update_fields=("refunded_amount_minor", "status", "revision", "updated_at"))
    PaymentTransition.objects.create(
        payment=payment,
        from_status=from_status,
        to_status=to_status,
        source=PaymentTransition.Source.REFUND,
        reason_code="refund_succeeded",
        idempotency_key=transition_key,
        source_reference=str(refund_id),
        effective_at=timezone.now(),
        metadata={"amount_minor": amount_minor, "refunded_total": new_total},
    )
    publish_after_commit(
        PaymentRefundStateChanged(
            payment_id=payment.id,
            subscription_id=payment.subscription_id,
            user_id=payment.account.primary_user_id,
            refunded_amount_minor=new_total,
            fully_refunded=to_status == Payment.Status.REFUNDED,
        )
    )
    return payment
