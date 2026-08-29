from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.entitlements.services import sync_subscription_entitlements
from apps.invoices.services import issue_paid_invoice
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.product_catalog.models import Price
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import (
    get_or_create_individual_account,
    paid_period_window,
    refresh_subscription,
    transition_subscription,
)

from .models import ManualRechargeSubmission, Payment, PaymentTransition
from .recharge_codes import (
    decrypt_recharge_code,
    encrypt_recharge_code,
    normalize_recharge_code,
    recharge_code_digest,
)
from .services import create_payment
from .telegram import ManualPaymentTelegramMessage, notify_manual_payment


class ManualPaymentError(ValueError):
    pass


class DuplicateRechargeCodeError(ManualPaymentError):
    pass


@dataclass(frozen=True, slots=True)
class ManualPaymentResult:
    payment: Payment
    submission: ManualRechargeSubmission
    subscription: Subscription
    created: bool


def _snapshot_subscription(subscription: Subscription) -> dict[str, object]:
    fields = (
        "status",
        "plan_version_id",
        "started_at",
        "trial_started_at",
        "trial_ends_at",
        "current_period_started_at",
        "current_period_ends_at",
        "grace_ends_at",
        "cancel_at_period_end",
        "cancellation_requested_at",
        "cancelled_at",
        "suspended_at",
        "ended_at",
        "status_reason",
        "payment_verification",
        "provisional_payment_id",
        "last_payment_at",
    )
    result: dict[str, object] = {}
    for field in fields:
        value = getattr(subscription, field)
        result[field] = (
            value.isoformat()
            if isinstance(value, datetime)
            else str(value)
            if isinstance(value, UUID)
            else value
        )
    return result


def _snapshot_value(field: str, value: Any) -> Any:
    if value is None:
        return None
    if field.endswith("_at"):
        return datetime.fromisoformat(str(value))
    if field in {"plan_version_id", "provisional_payment_id"}:
        return UUID(str(value)) if value else None
    return value


def _amount_label(payment: Payment) -> str:
    amount = payment.amount_minor / (10**payment.currency_exponent)
    return f"{amount:g} {payment.currency}"


@transaction.atomic
def submit_manual_recharge(
    *,
    user: User,
    price: Price,
    recharge_code: str,
    idempotency_key: str,
) -> ManualPaymentResult:
    if len(idempotency_key.strip()) < 12:
        raise ManualPaymentError("A stable idempotency key is required.")
    if price.currency != "LYD" or price.status != Price.Status.ACTIVE:
        raise ManualPaymentError("This plan is not available for Libyana payment.")
    normalized_code = normalize_recharge_code(recharge_code)
    digest = recharge_code_digest(normalized_code)
    account = get_or_create_individual_account(user=user)
    existing_payment = (
        Payment.objects.filter(account=account, idempotency_key=idempotency_key)
        .select_related("subscription")
        .first()
    )
    if existing_payment is not None:
        try:
            submission = existing_payment.manual_submission
        except ManualRechargeSubmission.DoesNotExist as error:
            raise ManualPaymentError(
                "This idempotency key belongs to a different payment flow."
            ) from error
        return ManualPaymentResult(
            payment=existing_payment,
            submission=submission,
            subscription=existing_payment.subscription,
            created=False,
        )
    if ManualRechargeSubmission.objects.filter(
        user=user, status=ManualRechargeSubmission.Status.PENDING
    ).exists():
        raise ManualPaymentError("A recharge card is already awaiting review.")
    if ManualRechargeSubmission.objects.filter(recharge_code_digest=digest).exists():
        raise DuplicateRechargeCodeError("This recharge card code has already been submitted.")

    subscription = (
        Subscription.objects.select_for_update()
        .select_related("plan_version", "account")
        .filter(account=account)
        .order_by("-created_at")
        .first()
    )
    if subscription is None:
        raise ManualPaymentError("A subscription account is not ready yet. Please try again.")
    subscription = refresh_subscription(subscription=subscription)
    if subscription.status == Subscription.Status.SUSPENDED:
        raise ManualPaymentError("This subscription is suspended. Contact support before paying.")
    previous = _snapshot_subscription(subscription)
    paid_start, paid_end = paid_period_window(
        subscription=subscription, price=price, effective_at=timezone.now()
    )
    original_status = subscription.status
    subscription.plan_version = price.plan_version
    subscription.save(update_fields=("plan_version", "updated_at"))
    payment, _ = create_payment(
        account=account,
        subscription=subscription,
        price=price,
        idempotency_key=idempotency_key,
    )
    now = timezone.now()
    payment.method = Payment.Method.LIBYANA
    payment.status = Payment.Status.PENDING
    payment.revision += 1
    payment.save(update_fields=("method", "status", "revision", "updated_at"))
    PaymentTransition.objects.create(
        payment=payment,
        from_status=Payment.Status.INITIATED,
        to_status=Payment.Status.PENDING,
        source=PaymentTransition.Source.SYSTEM,
        reason_code="libyana_submitted",
        idempotency_key=f"libyana-submitted:{payment.id}",
        effective_at=now,
    )
    period_start = (
        subscription.current_period_started_at
        if original_status in (Subscription.Status.ACTIVE, Subscription.Status.GRACE)
        and subscription.current_period_started_at
        else paid_start
    )
    subscription = transition_subscription(
        subscription_id=subscription.id,
        to_status=Subscription.Status.ACTIVE,
        reason_code="manual_payment_pending_review",
        source=SubscriptionTransition.Source.USER,
        effective_at=now,
        idempotency_key=f"manual-payment:{payment.id}",
        source_reference=str(payment.id),
        period_started_at=period_start,
        period_ends_at=paid_end,
    ).subscription
    subscription.payment_verification = Subscription.PaymentVerification.PROVISIONAL
    subscription.provisional_payment_id = payment.id
    subscription.save(
        update_fields=("payment_verification", "provisional_payment_id", "updated_at")
    )
    try:
        with transaction.atomic():
            submission = ManualRechargeSubmission.objects.create(
                payment=payment,
                user=user,
                recharge_code_ciphertext=encrypt_recharge_code(normalized_code),
                recharge_code_digest=digest,
                recharge_code_last4=normalized_code[-4:],
                subscription_period_started_at=paid_start,
                subscription_period_ends_at=paid_end,
                previous_subscription_state=previous,
            )
    except IntegrityError as error:
        if ManualRechargeSubmission.objects.filter(recharge_code_digest=digest).exists():
            raise DuplicateRechargeCodeError(
                "This recharge card code has already been submitted."
            ) from error
        raise ManualPaymentError("A recharge card is already awaiting review.") from error
    record_audit(
        actor=user,
        action="payment_submitted",
        domain="payments",
        target_type="payments.manual_recharge_submission",
        target_id=str(submission.id),
        reason="Libyana recharge card submitted for review.",
        source="payments.api",
        new_state={
            "payment_id": payment.id,
            "user_id": user.id,
            "plan_id": price.plan_version.plan_id,
            "status": submission.status,
            "subscription_period_ends_at": paid_end,
        },
    )
    message = ManualPaymentTelegramMessage(
        payment_id=str(payment.id),
        user_id=str(user.id),
        username=user.username or "",
        plan=price.plan_version.title,
        amount=_amount_label(payment),
        recharge_code=normalized_code,
        submitted=submission.submitted_at.isoformat(),
    )
    transaction.on_commit(lambda: notify_manual_payment(message))
    return ManualPaymentResult(payment, submission, subscription, True)


@transaction.atomic
def review_manual_recharge(
    *,
    payment_id: UUID,
    actor: User,
    decision: str,
    reason: str,
    idempotency_key: str,
) -> tuple[ManualRechargeSubmission, bool]:
    if decision not in {"approve", "reject"}:
        raise ManualPaymentError("Choose approve or reject.")
    if len(reason.strip()) < 3:
        raise ManualPaymentError("A review reason is required.")
    if len(idempotency_key.strip()) < 12:
        raise ManualPaymentError("A stable idempotency key is required.")
    submission = (
        ManualRechargeSubmission.objects.select_for_update()
        .select_related("payment__subscription__plan_version", "user")
        .get(payment_id=payment_id)
    )
    payment = Payment.objects.select_for_update().get(id=payment_id)
    subscription = Subscription.objects.select_for_update().get(id=payment.subscription_id)
    transition_key = f"manual-review:{idempotency_key}"
    if PaymentTransition.objects.filter(payment=payment, idempotency_key=transition_key).exists():
        return submission, False
    if submission.status != ManualRechargeSubmission.Status.PENDING:
        target = (
            ManualRechargeSubmission.Status.APPROVED
            if decision == "approve"
            else ManualRechargeSubmission.Status.REJECTED
        )
        if submission.status == target:
            return submission, False
        raise ManualPaymentError("This payment has already been reviewed.")

    now = timezone.now()
    from_payment_status = payment.status
    arabic = submission.user.preferred_language == User.Language.ARABIC
    if decision == "approve":
        submission.status = ManualRechargeSubmission.Status.APPROVED
        payment.status = Payment.Status.SUCCEEDED
        payment.succeeded_at = now
        payment.failure_code = ""
        subscription.payment_verification = Subscription.PaymentVerification.VERIFIED
        subscription.provisional_payment_id = None
        subscription.last_payment_at = now
        subscription.status_reason = "manual_payment_approved"
        subscription.revision += 1
        subscription.save()
        notification_title = "تم قبول الدفع" if arabic else "Payment approved"
        notification_body = (
            "تم التحقق من دفعة ليبيانا واشتراكك نشط."
            if arabic
            else "Your Libyana payment was verified. Your subscription is active."
        )
        audit_action = "payment_approved"
        payment_reason = "manual_payment_approved"
    else:
        submission.status = ManualRechargeSubmission.Status.REJECTED
        submission.rejection_reason = reason.strip()[:500]
        payment.status = Payment.Status.FAILED
        payment.failed_at = now
        payment.failure_code = "manual_rejected"
        previous_status = subscription.status
        previous = submission.previous_subscription_state
        for field, value in previous.items():
            setattr(subscription, field, _snapshot_value(field, value))
        subscription.payment_verification = Subscription.PaymentVerification.VERIFIED
        subscription.provisional_payment_id = None
        subscription.revision += 1
        subscription.save()
        SubscriptionTransition.objects.create(
            subscription=subscription,
            from_status=previous_status,
            to_status=subscription.status,
            source=SubscriptionTransition.Source.ADMIN,
            reason_code="manual_payment_rejected",
            actor=actor,
            source_reference=str(payment.id),
            idempotency_key=f"manual-rejection:{payment.id}",
            effective_at=now,
            metadata={"rejection_reason": reason.strip()[:500]},
        )
        subscription = refresh_subscription(subscription=subscription, now=now)
        sync_subscription_entitlements(subscription_id=subscription.id)
        notification_title = "تم رفض الدفع" if arabic else "Payment rejected"
        notification_body = (
            f"لم يتم قبول دفعة ليبيانا. {reason.strip()[:220]}"
            if arabic
            else f"Your Libyana payment was not approved. {reason.strip()[:220]}"
        )
        audit_action = "payment_rejected"
        payment_reason = "manual_payment_rejected"

    payment.revision += 1
    payment.save()
    submission.reviewed_at = now
    submission.reviewed_by = actor
    # The full code is needed only while an administrator validates a pending
    # card. Keep its digest/last four digits for duplicate detection and history,
    # but remove the reversible ciphertext immediately after either decision.
    submission.recharge_code_ciphertext = ""
    submission.save()
    PaymentTransition.objects.create(
        payment=payment,
        from_status=from_payment_status,
        to_status=payment.status,
        source=PaymentTransition.Source.MANUAL_REVIEW,
        reason_code=payment_reason,
        idempotency_key=transition_key,
        source_reference=str(actor.id),
        effective_at=now,
        metadata={"review_reason": reason.strip()[:500]},
    )
    if decision == "approve":
        issue_paid_invoice(payment_id=payment.id)
    create_notification(
        recipient_id=submission.user_id,
        actor_id=actor.id,
        category=Notification.Category.BILLING,
        template_key=f"billing.manual_payment.{submission.status}",
        title=notification_title,
        body=notification_body,
        deduplication_key=f"manual-payment-review:{payment.id}:{submission.status}",
        target_type="subscription",
        target_id=subscription.id,
        target_route="/subscription",
        required=True,
    )
    record_audit(
        actor=actor,
        action=audit_action,
        domain="payments",
        target_type="payments.manual_recharge_submission",
        target_id=str(submission.id),
        reason=reason,
        source="admin_control.api",
        previous_state={"status": ManualRechargeSubmission.Status.PENDING},
        new_state={
            "status": submission.status,
            "payment_id": payment.id,
            "subscription_id": subscription.id,
            "user_id": submission.user_id,
        },
    )
    return submission, True


def recharge_code_for_admin(submission: ManualRechargeSubmission) -> str:
    if submission.status != ManualRechargeSubmission.Status.PENDING:
        return ""
    return decrypt_recharge_code(submission.recharge_code_ciphertext)
