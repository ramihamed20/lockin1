from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.entitlements.free_access import free_access_ends_at
from apps.entitlements.services import sync_subscription_entitlements
from apps.invoices.services import issue_paid_invoice
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.product_catalog.dentistry_terms import (
    FIRST_MONTH_OFFER_ENDS_AT,
    FOUR_MONTHS,
    LEGACY_DURATION_PLANS,
)
from apps.product_catalog.models import Price, fixed_period_end
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import (
    lock_individual_account,
    paid_period_window,
    refresh_subscription,
    transition_subscription,
)

from .installments import (
    active_agreement,
    installment_snapshot,
    installments_available,
    is_installment_suspension,
)
from .models import (
    InstallmentAgreement,
    ManualRechargeCode,
    ManualRechargeSubmission,
    Payment,
    PaymentTransition,
)
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
MAX_RECHARGE_CODES = 5


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


def _plan_label(payment: Payment) -> str:
    title = payment.price.plan_version.title
    agreement = payment.installment_agreement
    if agreement is None or payment.installment_number is None:
        return title
    count = len(agreement.installment_amounts_minor)
    return f"{title} — قسط {payment.installment_number}/{count}"


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
        plan=_plan_label(payment),
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


def price_eligibilities(*, user: User) -> frozenset[str]:
    """The restricted prices this reader may buy at.

    Four-month subscribers already hold the pre-midterm term, so they get the
    full-year upgrade instead of the loyalty price. Everyone else who paid for
    any duration plan submitted before the first-month offer closed -- approved
    then or later -- gets the loyalty price. A free trial alone does not count.
    """

    paid = Payment.objects.filter(account__primary_user=user, status=Payment.Status.SUCCEEDED)
    if paid.filter(price__plan_version__plan__code=FOUR_MONTHS).exists():
        return frozenset({Price.Eligibility.FOUR_MONTH_UPGRADE})
    if paid.filter(
        created_at__lt=FIRST_MONTH_OFFER_ENDS_AT,
        price__plan_version__plan__code__in=LEGACY_DURATION_PLANS,
    ).exists():
        return frozenset({Price.Eligibility.LOYALTY_2026})
    return frozenset()


def purchase_block_reason(
    *, subscription: Subscription | None, price: Price, now: datetime
) -> str | None:
    """Why this reader cannot buy this price right now, or ``None``.

    Shared by the catalog (to show only what can be bought) and the submission
    path (which is the authority), so the two cannot disagree.
    """

    if subscription is None:
        return None
    if is_installment_suspension(subscription):
        return "Pay the installment that is due before buying another plan."
    if subscription.status == Subscription.Status.SUSPENDED:
        return "This subscription is suspended. Contact support before paying."
    fixed_end = fixed_period_end(price.plan_version)
    live = subscription.status in (Subscription.Status.ACTIVE, Subscription.Status.GRACE)
    if fixed_end is not None:
        if fixed_end <= now:
            return "This term has already ended."
        if live and active_agreement(subscription=subscription) is not None:
            return "Finish paying your current installments before changing plan."
        if (
            live
            and subscription.current_period_ends_at
            and subscription.current_period_ends_at >= fixed_end
        ):
            return "Your current subscription already covers this term."
        return None
    active_unexpired = bool(
        subscription.status == Subscription.Status.ACTIVE
        and subscription.current_period_ends_at
        and subscription.current_period_ends_at > now
    )
    if active_unexpired and not _early_renewal_allowed(subscription=subscription, now=now):
        return "Early renewal is available during the final seven days only."
    return None


def _validated_codes(recharge_codes: list[str]) -> tuple[list[str], list[str]]:
    if not 1 <= len(recharge_codes) <= MAX_RECHARGE_CODES:
        raise ManualPaymentError(f"Submit between one and {MAX_RECHARGE_CODES} recharge cards.")
    normalized_codes = [normalize_recharge_code(code) for code in recharge_codes]
    digests = [recharge_code_digest(code) for code in normalized_codes]
    if len(set(digests)) != len(digests):
        raise DuplicateRechargeCodeError("The same recharge card cannot be submitted twice.")
    return normalized_codes, digests


def _store_recharge_codes(
    *,
    payment: Payment,
    user: User,
    normalized_codes: list[str],
    digests: list[str],
    period_started_at: datetime,
    period_ends_at: datetime,
    previous: dict[str, object],
    is_early_renewal: bool,
    previous_subscription_end_at: datetime | None,
) -> ManualRechargeSubmission:
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
                subscription_period_started_at=period_started_at,
                subscription_period_ends_at=period_ends_at,
                previous_subscription_state=previous,
                is_early_renewal=is_early_renewal,
                previous_subscription_end_at=(
                    previous_subscription_end_at if is_early_renewal else None
                ),
                extension_started_at=period_started_at if is_early_renewal else None,
                extension_ends_at=period_ends_at if is_early_renewal else None,
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
    return submission


@transaction.atomic
def submit_manual_recharge(
    *,
    user: User,
    price: Price,
    recharge_codes: list[str],
    idempotency_key: str,
    pay_in_installments: bool = False,
) -> ManualPaymentResult:
    if len(idempotency_key.strip()) < 12:
        raise ManualPaymentError("A stable idempotency key is required.")
    if price.currency != "LYD" or price.status != Price.Status.ACTIVE:
        raise ManualPaymentError("This plan is not available for Libyana payment.")
    if price.first_subscription_only and not _first_subscription_offer_available(user=user):
        raise ManualPaymentError("The first-subscription offer has already been used.")
    if price.eligibility and price.eligibility not in price_eligibilities(user=user):
        raise ManualPaymentError("This price is not available for your account.")
    if price.amount_minor == 5 * (10**price.currency_exponent) and len(recharge_codes) != 1:
        raise ManualPaymentError("The 5 LYD plan accepts exactly one recharge card code.")
    if free_access_ends_at(user) is not None:
        raise ManualPaymentError("Your program is free for now, so no payment is needed.")
    normalized_codes, digests = _validated_codes(recharge_codes)
    # Locked for the whole submission: the account's single subscription is read,
    # re-anchored and transitioned below, and two submissions racing each other
    # would otherwise both price a period from the same starting point.
    account = lock_individual_account(user=user)
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
        # An account with no subscription row at all used to be told to "try
        # again", for ever: the trial is created on email verification, so a
        # reader whose verification predates the trial plan -- or ran while that
        # plan was unpublished -- had no row, and the only screen that could
        # have fixed it was the one refusing to take their money. Open the
        # subscription here instead, in the state a payment is waiting on.
        subscription = Subscription.objects.create(
            account=account,
            plan_version=price.plan_version,
            status=Subscription.Status.PENDING,
            status_reason="awaiting_payment",
        )
        SubscriptionTransition.objects.create(
            subscription=subscription,
            from_status="",
            to_status=Subscription.Status.PENDING,
            source=SubscriptionTransition.Source.USER,
            reason_code="manual_payment_started",
            idempotency_key=f"manual-open:{subscription.id}",
            effective_at=timezone.now(),
        )
    now = timezone.now()
    # Grace remains payable through its inclusive end instant. Do not reconcile
    # it to expired immediately before evaluating that renewal.
    if not (
        subscription.status == Subscription.Status.GRACE
        and subscription.grace_ends_at
        and now <= subscription.grace_ends_at
    ):
        subscription = refresh_subscription(subscription=subscription, now=now)
    blocked = purchase_block_reason(subscription=subscription, price=price, now=now)
    if blocked:
        raise ManualPaymentError(blocked)
    installment_amounts = [int(value) for value in price.installment_amounts_minor or []]
    if pay_in_installments and not installments_available(price=price, now=now):
        raise ManualPaymentError("This plan cannot be paid in installments now.")
    # Buying a later term while one is running extends it, and is rolled back
    # exactly like an early renewal if the card is rejected.
    is_early_renewal = _early_renewal_allowed(subscription=subscription, now=now) or bool(
        fixed_period_end(price.plan_version) is not None
        and subscription.status in (Subscription.Status.ACTIVE, Subscription.Status.GRACE)
        and subscription.current_period_ends_at
        and (
            subscription.current_period_ends_at > now
            or (subscription.grace_ends_at and now <= subscription.grace_ends_at)
        )
    )
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
        amount_minor=installment_amounts[0] if pay_in_installments else None,
    )
    if pay_in_installments:
        agreement = InstallmentAgreement.objects.create(
            account=account,
            subscription=subscription,
            price=price,
            total_amount_minor=price.amount_minor,
            currency=price.currency,
            currency_exponent=price.currency_exponent,
            installment_amounts_minor=installment_amounts,
            anchor_at=now,
        )
        payment.installment_agreement = agreement
        payment.installment_number = 1
    payment.method = Payment.Method.LIBYANA
    payment.status = Payment.Status.PENDING
    payment.revision += 1
    payment.save(
        update_fields=(
            "method",
            "status",
            "installment_agreement",
            "installment_number",
            "revision",
            "updated_at",
        )
    )
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
    submission = _store_recharge_codes(
        payment=payment,
        user=user,
        normalized_codes=normalized_codes,
        digests=digests,
        period_started_at=paid_start,
        period_ends_at=paid_end,
        previous=previous,
        is_early_renewal=is_early_renewal,
        previous_subscription_end_at=previous_subscription_end_at,
    )
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
            "installment_agreement_id": payment.installment_agreement_id,
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
def submit_installment_payment(
    *,
    user: User,
    agreement_id: UUID,
    recharge_codes: list[str],
    idempotency_key: str,
) -> ManualPaymentResult:
    """Pay the next installment of a term bought in parts.

    The term itself was granted with the first installment, so this payment
    reserves no period and rolls nothing back when rejected. What it changes is
    whether the installment schedule holds access back, which
    ``refresh_subscription`` re-derives after the payment is recorded and again
    after it is reviewed.
    """

    if len(idempotency_key.strip()) < 12:
        raise ManualPaymentError("A stable idempotency key is required.")
    normalized_codes, digests = _validated_codes(recharge_codes)
    account = lock_individual_account(user=user)
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
    agreement = (
        InstallmentAgreement.objects.select_for_update()
        .select_related("price__plan_version")
        .filter(id=agreement_id, account=account, status=InstallmentAgreement.Status.ACTIVE)
        .first()
    )
    if agreement is None:
        raise ManualPaymentError("There is no installment plan to pay.")
    subscription = Subscription.objects.select_for_update().get(id=agreement.subscription_id)
    now = timezone.now()
    subscription = refresh_subscription(subscription=subscription, now=now)
    if subscription.status not in (Subscription.Status.ACTIVE, Subscription.Status.SUSPENDED):
        raise ManualPaymentError("This subscription has ended.")
    if not subscription.current_period_started_at or not subscription.current_period_ends_at:
        raise ManualPaymentError("This subscription has no paid term to pay toward.")
    snapshot = installment_snapshot(agreement, now=now)
    if snapshot.next_number is None or snapshot.next_amount_minor is None:
        raise ManualPaymentError("Every installment is already paid.")
    try:
        payment, _ = create_payment(
            account=account,
            subscription=subscription,
            price=agreement.price,
            idempotency_key=idempotency_key,
            amount_minor=snapshot.next_amount_minor,
        )
    except ValueError as error:
        raise ManualPaymentError(str(error)) from error
    payment.method = Payment.Method.LIBYANA
    payment.status = Payment.Status.PENDING
    payment.installment_agreement = agreement
    payment.installment_number = snapshot.next_number
    payment.revision += 1
    try:
        with transaction.atomic():
            payment.save(
                update_fields=(
                    "method",
                    "status",
                    "installment_agreement",
                    "installment_number",
                    "revision",
                    "updated_at",
                )
            )
    except IntegrityError as error:
        raise ManualPaymentError("This installment is already paid or awaiting review.") from error
    PaymentTransition.objects.create(
        payment=payment,
        from_status=Payment.Status.INITIATED,
        to_status=Payment.Status.PENDING,
        source=PaymentTransition.Source.SYSTEM,
        reason_code="libyana_installment_submitted",
        idempotency_key=f"libyana-submitted:{payment.id}",
        effective_at=now,
    )
    submission = _store_recharge_codes(
        payment=payment,
        user=user,
        normalized_codes=normalized_codes,
        digests=digests,
        period_started_at=subscription.current_period_started_at,
        period_ends_at=subscription.current_period_ends_at,
        previous=_snapshot_subscription(subscription),
        is_early_renewal=False,
        previous_subscription_end_at=None,
    )
    # Paid inside the two-day window: access comes back now, not at approval.
    subscription = refresh_subscription(subscription=subscription, now=now)
    record_audit(
        actor=user,
        action="payment_submitted",
        domain="payments",
        target_type="payments.manual_recharge_submission",
        target_id=str(submission.id),
        reason="Libyana recharge card submitted for an installment.",
        source="payments.api",
        new_state={
            "payment_id": payment.id,
            "user_id": user.id,
            "installment_agreement_id": agreement.id,
            "installment_number": payment.installment_number,
            "status": submission.status,
        },
    )
    message = _telegram_message(
        event=ManualPaymentTelegramMessage.Event.NEW_SUBSCRIPTION,
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
    # Whether this payment is still the one the subscription is provisionally
    # resting on. It may not be: an administrator can have cancelled or replaced
    # the subscription while the card sat in the queue. A review of this payment
    # must still settle *the payment*, but it must not reach past that and undo
    # what someone else decided afterwards.
    owns_subscription_state = subscription.provisional_payment_id == payment.id
    # Whether the period this payment reserved is still the period in force. If
    # an administrator has extended or replaced it since, the snapshot taken at
    # submission no longer describes anything anyone wants back, and writing it
    # over their work would undo a decision made with more information than this
    # one has.
    reserved_period_intact = (
        subscription.current_period_ends_at == submission.subscription_period_ends_at
    )
    if decision == "approve":
        submission.status = ManualRechargeSubmission.Status.APPROVED
        payment.status = Payment.Status.SUCCEEDED
        payment.succeeded_at = now
        payment.failure_code = ""
        if owns_subscription_state:
            subscription.payment_verification = Subscription.PaymentVerification.VERIFIED
            subscription.provisional_payment_id = None
            subscription.last_payment_at = now
            subscription.status_reason = "manual_payment_approved"
            subscription.revision += 1
            subscription.save()
            # The paid period was reserved at submission and is not extended
            # again here -- that is what makes a repeated approval harmless --
            # but the subscription's own history had nothing to show for the
            # approval, and entitlements were left to whatever convergence ran
            # at submission time. Record the decision and re-converge, so the
            # grant a reader holds after approval is the grant this subscription
            # implies now, not the one it implied while the card was pending.
            SubscriptionTransition.objects.create(
                subscription=subscription,
                from_status=previous_subscription_status,
                to_status=subscription.status,
                source=SubscriptionTransition.Source.ADMIN,
                reason_code="manual_payment_approved",
                actor=actor,
                source_reference=str(payment.id),
                idempotency_key=f"manual-approval:{payment.id}",
                effective_at=now,
                metadata={"review_reason": reason.strip()[:500]},
            )
            subscription = refresh_subscription(subscription=subscription, now=now)
            sync_subscription_entitlements(subscription_id=subscription.id)
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
        # When ``owns_subscription_state`` is false, someone else has already
        # moved this subscription off the provisional state this payment
        # created. Rolling a stale snapshot over their decision would silently
        # revert it, so the rejection is recorded against the payment and the
        # subscription is left to its current owner.
        if owns_subscription_state and submission.is_early_renewal:
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
        elif owns_subscription_state and reserved_period_intact:
            for field, value in previous.items():
                setattr(subscription, field, _snapshot_value(field, value))
        if owns_subscription_state:
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
            # Reconciled, not merely restored. The snapshot describes the
            # subscription as it was when the card was submitted, which may be
            # days of trial or paid period ago; running it back through the
            # lifecycle here is what stops a rejection from leaving a reader
            # holding a trial that ended while the card was in the queue.
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
    if payment.installment_agreement_id:
        if decision == "reject" and payment.installment_number == 1:
            # The purchase itself was refused and rolled back above; there is
            # nothing left to pay installments toward.
            InstallmentAgreement.objects.filter(
                id=payment.installment_agreement_id,
                status=InstallmentAgreement.Status.ACTIVE,
            ).update(status=InstallmentAgreement.Status.CANCELLED, cancelled_at=now, updated_at=now)
        # Re-derive the hold: an approval can release it, a rejection can
        # bring it back.
        subscription = refresh_subscription(
            subscription=Subscription.objects.select_related("plan_version", "account").get(
                id=subscription.id
            ),
            now=now,
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
