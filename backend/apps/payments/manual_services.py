from dataclasses import dataclass
from datetime import datetime, timedelta
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

from .models import ManualRechargeCode, ManualRechargeSubmission, Payment, PaymentTransition
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


EARLY_RENEWAL_WINDOW = timedelta(days=7)


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


def _telegram_username(user: User) -> str:
    return user.username or f"user-{user.id}"


def _telegram_message(
    *,
    event: str,
    payment: Payment,
    submission: ManualRechargeSubmission,
    subscription: Subscription,
    recharge_codes: tuple[str, ...] = (),
) -> ManualPaymentTelegramMessage:
    return ManualPaymentTelegramMessage(
        event=event,
        payment_id=str(payment.id),
        user_id=str(submission.user_id),
        username=_telegram_username(submission.user),
        plan=payment.price.plan_version.title,
        amount=_amount_label(payment),
        payment_method=payment.get_method_display(),
        submitted=(
            submission.submitted_at.isoformat()
            if event
            in (
                ManualPaymentTelegramMessage.Event.NEW_SUBSCRIPTION,
                ManualPaymentTelegramMessage.Event.EARLY_RENEWAL,
            )
            else None
        ),
        current_expiry=(
            submission.previous_subscription_end_at.isoformat()
            if event == ManualPaymentTelegramMessage.Event.EARLY_RENEWAL
            and submission.previous_subscription_end_at
            else None
        ),
        recharge_codes=recharge_codes,
    )


def _first_subscription_offer_available(*, user: User) -> bool:
    """A rejected card does not consume the introductory offer.

    A pending request is independently prevented by the one-pending-request
    database rule, so any completed successful paid subscription makes this
    first-subscription offer unavailable later.
    """
    return not Payment.objects.filter(
        account__primary_user=user,
        status=Payment.Status.SUCCEEDED,
    ).exists()


def _early_renewal_allowed(*, subscription: Subscription, now: datetime) -> bool:
    return bool(
        subscription.status in (Subscription.Status.ACTIVE, Subscription.Status.GRACE)
        and subscription.current_period_ends_at
        and (
            (
                subscription.status == Subscription.Status.ACTIVE
                and subscription.current_period_ends_at > now
                and subscription.current_period_ends_at - now <= EARLY_RENEWAL_WINDOW
            )
            or (
                subscription.status == Subscription.Status.GRACE
                and subscription.grace_ends_at
                and now <= subscription.grace_ends_at
            )
        )
    )


@transaction.atomic
def submit_manual_recharge(
    *,
    user: User,
    price: Price,
    recharge_codes: list[str],
    idempotency_key: str,
) -> ManualPaymentResult:
    if len(idempotency_key.strip()) < 12:
        raise ManualPaymentError("A stable idempotency key is required.")
    if price.currency != "LYD" or price.status != Price.Status.ACTIVE:
        raise ManualPaymentError("This plan is not available for Libyana payment.")
    if price.first_subscription_only and not _first_subscription_offer_available(user=user):
        raise ManualPaymentError("The first-subscription offer has already been used.")
    if not 1 <= len(recharge_codes) <= 2:
        raise ManualPaymentError("Submit one or two recharge card codes.")
    if price.amount_minor == 5 * (10**price.currency_exponent) and len(recharge_codes) != 1:
        raise ManualPaymentError("The 5 LYD plan accepts exactly one recharge card code.")
    normalized_codes = [normalize_recharge_code(code) for code in recharge_codes]
    digests = [recharge_code_digest(code) for code in normalized_codes]
    if len(set(digests)) != len(digests):
        raise DuplicateRechargeCodeError("The same recharge card cannot be submitted twice.")
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
    # A card number that has been seen before is no longer refused here.
    #
    # It used to be: the digest was globally unique, so the first submission of a
    # number burned it for everyone, for good. A card rejected in error could
    # never be re-sent, and a genuine second attempt looked like fraud. Approval
    # is a person's decision, and that person is the right one to weigh a repeat
    # -- so the repeat is recorded and surfaced to them (see
    # ``previous_submission_count`` on the operations payload) rather than
    # blocked by the schema.
    #
    # What still cannot happen is an accidental double side effect: one logical
    # attempt is pinned by the idempotency key handled above, and a user may hold
    # only one pending submission at a time.

    subscription = (
        Subscription.objects.select_for_update()
        .select_related("plan_version", "account")
        .filter(account=account)
        .order_by("-created_at")
        .first()
    )
    if subscription is None:
        raise ManualPaymentError("A subscription account is not ready yet. Please try again.")
    now = timezone.now()
    # Grace remains payable through its inclusive end instant. Do not reconcile
    # it to expired immediately before evaluating that renewal.
    if not (
        subscription.status == Subscription.Status.GRACE
        and subscription.grace_ends_at
        and now <= subscription.grace_ends_at
    ):
        subscription = refresh_subscription(subscription=subscription, now=now)
    if subscription.status == Subscription.Status.SUSPENDED:
        raise ManualPaymentError("This subscription is suspended. Contact support before paying.")
    active_unexpired = bool(
        subscription.status == Subscription.Status.ACTIVE
        and subscription.current_period_ends_at
        and subscription.current_period_ends_at > now
    )
    is_early_renewal = _early_renewal_allowed(subscription=subscription, now=now)
    if active_unexpired and not is_early_renewal:
        raise ManualPaymentError("Early renewal is available during the final seven days only.")
    previous = _snapshot_subscription(subscription)
    previous_subscription_end_at = subscription.current_period_ends_at
    paid_start, paid_end = paid_period_window(
        subscription=subscription, price=price, effective_at=now
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
        allow_out_of_order=True,
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
                # Compatibility mirror for legacy readers; all new use reads
                # the related recharge code rows below.
                recharge_code_ciphertext=encrypt_recharge_code(normalized_codes[0]),
                recharge_code_digest=digests[0],
                recharge_code_last4=normalized_codes[0][-4:],
                subscription_period_started_at=paid_start,
                subscription_period_ends_at=paid_end,
                previous_subscription_state=previous,
                is_early_renewal=is_early_renewal,
                previous_subscription_end_at=(
                    previous_subscription_end_at if is_early_renewal else None
                ),
                extension_started_at=paid_start if is_early_renewal else None,
                extension_ends_at=paid_end if is_early_renewal else None,
            )
            ManualRechargeCode.objects.bulk_create(
                [
                    ManualRechargeCode(
                        submission=submission,
                        position=position,
                        ciphertext=encrypt_recharge_code(code),
                        digest=digest,
                        last4=code[-4:],
                    )
                    for position, (code, digest) in enumerate(
                        zip(normalized_codes, digests, strict=True), start=1
                    )
                ]
            )
    except IntegrityError as error:
        # The only uniqueness left on this path is one pending submission per
        # user, which a concurrent second request can still lose.
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
            "is_early_renewal": is_early_renewal,
        },
    )
    message = _telegram_message(
        event=(
            ManualPaymentTelegramMessage.Event.EARLY_RENEWAL
            if is_early_renewal
            else ManualPaymentTelegramMessage.Event.NEW_SUBSCRIPTION
        ),
        payment=payment,
        submission=submission,
        subscription=subscription,
        recharge_codes=tuple(normalized_codes),
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
    send_notification: bool = True,
    source: str = "admin_control.api",
) -> tuple[ManualRechargeSubmission, bool]:
    """Approve or reject a manual payment. The only path that may do so.

    ``source`` names the channel on the audit record. Both callers run exactly
    this function, so the channel is the only thing that differs between a
    console review and a Telegram button, and it is the one thing the audit
    trail could not previously show.

    ``send_notification`` suppresses only the outgoing Telegram message, never
    the in-app notification, the invoice, the audit record or any state change.
    A review made from a Telegram button rewrites the original message in place
    to show the outcome, so sending a second message about the same decision
    would simply duplicate it in the same chat. Reviews made from the operations
    console still announce themselves in Telegram exactly as before.
    """

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
    previous_subscription_status = subscription.status
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
        if submission.is_early_renewal:
            if (
                submission.previous_subscription_end_at is None
                or submission.extension_ends_at is None
                or subscription.current_period_ends_at != submission.extension_ends_at
            ):
                raise ManualPaymentError(
                    "The early-renewal extension cannot be rolled back safely."
                )
            # Roll back only the segment attached to this rejected payment.  Do
            # not restore unrelated status/cancellation data or remove the
            # original paid period that existed before renewal.
            for field in (
                "plan_version_id",
                "current_period_started_at",
                "current_period_ends_at",
                "grace_ends_at",
                "payment_verification",
                "provisional_payment_id",
                "last_payment_at",
                "status_reason",
            ):
                setattr(subscription, field, _snapshot_value(field, previous[field]))
        else:
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
    submission.recharge_codes.update(ciphertext="")
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
        source=source,
        previous_state={
            "status": ManualRechargeSubmission.Status.PENDING,
            "payment_status": from_payment_status,
            "subscription_status": previous_subscription_status,
        },
        new_state={
            "status": submission.status,
            "payment_status": payment.status,
            "subscription_status": subscription.status,
            "payment_id": payment.id,
            "subscription_id": subscription.id,
            "user_id": submission.user_id,
        },
    )
    if send_notification:
        message = _telegram_message(
            event=(
                ManualPaymentTelegramMessage.Event.APPROVED
                if decision == "approve"
                else ManualPaymentTelegramMessage.Event.REJECTED
            ),
            payment=payment,
            submission=submission,
            subscription=subscription,
        )
        transaction.on_commit(lambda: notify_manual_payment(message))
    return submission, True


def recharge_codes_for_admin(submission: ManualRechargeSubmission) -> list[str]:
    codes = list(submission.recharge_codes.all())
    if not codes:
        return [
            decrypt_recharge_code(submission.recharge_code_ciphertext)
            if submission.status == ManualRechargeSubmission.Status.PENDING
            else f"********{submission.recharge_code_last4}"
        ]
    if submission.status != ManualRechargeSubmission.Status.PENDING:
        return [f"********{code.last4}" for code in codes]
    return [decrypt_recharge_code(code.ciphertext) for code in codes]


def recharge_code_for_admin(submission: ManualRechargeSubmission) -> str:
    """Compatibility helper for existing single-code operations surfaces."""
    return recharge_codes_for_admin(submission)[0]
