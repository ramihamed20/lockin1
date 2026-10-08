"""Installment schedules for term plans, and what a missed one does to access.

The rule the product owner set: the first installment is paid at purchase and
grants the whole term; each later one falls due a month after the previous.
A missed installment suspends access at once and warns the reader. Paying
within two days restores access as soon as the cards are submitted; after that
the access returns only once a reviewer approves the payment.

Nothing here is stored as "overdue": the state is derived from the schedule and
the payments attached to the agreement, so a late approval or a rejection can
never leave a stale flag behind. ``enforce_installments`` converges the
subscription status to that derived state and is called from
``refresh_subscription``, which every reader, reviewer and the scheduler pass
through.
"""

from dataclasses import dataclass
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.product_catalog.dentistry_terms import (
    INSTALLMENT_PAYMENT_WINDOW,
    INSTALLMENT_REMINDER_LEAD,
)
from apps.product_catalog.models import Price, fixed_period_end
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import advance_billing_period, transition_subscription

from .models import InstallmentAgreement, Payment

INSTALLMENT_REASON_PREFIX = "installment_"


class InstallmentState:
    CURRENT = "current"
    # Due, but paid inside the window: access holds while the card is reviewed.
    IN_REVIEW = "in_review"
    OVERDUE = "overdue"
    DEFAULTED = "defaulted"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class InstallmentSnapshot:
    agreement: InstallmentAgreement
    state: str
    next_number: int | None
    next_amount_minor: int | None
    next_due_at: datetime | None
    payment_window_ends_at: datetime | None
    pending_number: int | None
    paid_minor: int
    items: tuple[dict[str, object], ...]

    @property
    def blocks_access(self) -> bool:
        return self.state in (InstallmentState.OVERDUE, InstallmentState.DEFAULTED)


def due_at(anchor: datetime, number: int) -> datetime:
    if number <= 1:
        return anchor
    return advance_billing_period(anchor, interval=Price.Interval.MONTH, count=number - 1)


def installments_available(*, price: Price, now: datetime) -> bool:
    """Whether this price can be paid in parts if bought now.

    Every installment must fall due before the term ends; a term bought too late
    for its schedule is sold in full only.
    """

    amounts = price.installment_amounts_minor or []
    ends_at = fixed_period_end(price.plan_version)
    if len(amounts) < 2 or ends_at is None:
        return False
    return due_at(now, len(amounts)) < ends_at


def installment_snapshot(
    agreement: InstallmentAgreement, *, now: datetime | None = None
) -> InstallmentSnapshot:
    current = now or timezone.now()
    amounts = [int(value) for value in agreement.installment_amounts_minor]
    payments = list(
        agreement.payments.filter(
            status__in=(Payment.Status.PENDING, Payment.Status.SUCCEEDED)
        ).order_by("installment_number", "created_at")
    )
    settled = {p.installment_number for p in payments if p.status == Payment.Status.SUCCEEDED}
    pending = {p.installment_number: p for p in payments if p.status == Payment.Status.PENDING}
    paid_minor = sum(amounts[n - 1] for n in settled if n and 1 <= n <= len(amounts))
    next_number = next((n for n in range(1, len(amounts) + 1) if n not in settled), None)
    items: tuple[dict[str, object], ...] = tuple(
        {
            "number": n,
            "amount_minor": amounts[n - 1],
            "due_at": due_at(agreement.anchor_at, n),
            "status": (
                "paid"
                if n in settled
                else "pending"
                if n in pending
                else "due"
                if due_at(agreement.anchor_at, n) <= current
                else "upcoming"
            ),
        }
        for n in range(1, len(amounts) + 1)
    )
    if agreement.status == InstallmentAgreement.Status.CANCELLED:
        state = InstallmentState.CANCELLED
    elif next_number is None:
        state = InstallmentState.COMPLETED
    else:
        state = InstallmentState.CURRENT
    open_schedule = state == InstallmentState.CURRENT and next_number is not None
    next_due = due_at(agreement.anchor_at, next_number) if open_schedule and next_number else None
    window_end = next_due + INSTALLMENT_PAYMENT_WINDOW if next_due else None
    submitted = pending.get(next_number) if open_schedule else None
    if next_due and window_end and next_due <= current:
        if submitted is not None and submitted.created_at <= window_end:
            state = InstallmentState.IN_REVIEW
        elif submitted is None and current <= window_end:
            state = InstallmentState.OVERDUE
        else:
            state = InstallmentState.DEFAULTED
    return InstallmentSnapshot(
        agreement=agreement,
        state=state,
        next_number=next_number if open_schedule else None,
        next_amount_minor=amounts[next_number - 1] if open_schedule and next_number else None,
        next_due_at=next_due,
        payment_window_ends_at=window_end,
        pending_number=next_number if submitted is not None else None,
        paid_minor=paid_minor,
        items=items,
    )


def active_agreement(*, subscription: Subscription) -> InstallmentAgreement | None:
    return (
        InstallmentAgreement.objects.filter(
            subscription=subscription, status=InstallmentAgreement.Status.ACTIVE
        )
        .select_related("price__plan_version")
        .first()
    )


def latest_agreement(*, subscription: Subscription) -> InstallmentAgreement | None:
    return (
        InstallmentAgreement.objects.filter(subscription=subscription)
        .exclude(status=InstallmentAgreement.Status.CANCELLED)
        .select_related("price__plan_version")
        .order_by("-created_at", "-id")
        .first()
    )


def _notify(
    *, subscription: Subscription, kind: str, key: str, snapshot: InstallmentSnapshot
) -> None:
    user = subscription.account.primary_user
    if user is None or snapshot.next_amount_minor is None:
        return
    amount = snapshot.next_amount_minor / (10**snapshot.agreement.currency_exponent)
    amount_label = f"{amount:g} {snapshot.agreement.currency}"
    arabic = user.preferred_language == User.Language.ARABIC
    copy = {
        "reminder": (
            ("القسط القادم قريب", f"قسط بقيمة {amount_label} مستحق خلال أيام. ادفعه من الاشتراك.")
            if arabic
            else (
                "Installment due soon",
                f"An installment of {amount_label} is due in a few days. Pay it from Subscription.",
            )
        ),
        "overdue": (
            (
                "تم تعليق الوصول: قسط مستحق",
                f"لم يُدفع قسط بقيمة {amount_label}. ادفعه خلال يومين ليعود وصولك فوراً، "
                "وإلا يتوقف حسابك حتى يُدفع.",
            )
            if arabic
            else (
                "Access paused: installment due",
                f"An installment of {amount_label} is unpaid. Pay within two days to restore "
                "access immediately, or access stops until it is paid.",
            )
        ),
        "defaulted": (
            (
                "توقف الاشتراك",
                f"لم يُدفع القسط ({amount_label}) خلال المهلة. ادفعه وسيعود وصولك بعد التحقق.",
            )
            if arabic
            else (
                "Subscription stopped",
                f"The installment ({amount_label}) was not paid in time. Pay it and access "
                "returns once the payment is verified.",
            )
        ),
    }[kind]
    create_notification(
        recipient_id=user.id,
        category=Notification.Category.BILLING,
        template_key=f"billing.installment.{kind}",
        title=copy[0],
        body=copy[1],
        deduplication_key=key,
        target_type="subscription",
        target_id=subscription.id,
        target_route="/subscription",
        required=True,
    )


def is_installment_suspension(subscription: Subscription) -> bool:
    return subscription.status == Subscription.Status.SUSPENDED and (
        subscription.status_reason.startswith(INSTALLMENT_REASON_PREFIX)
    )


@transaction.atomic
def enforce_installments(*, subscription: Subscription, now: datetime) -> Subscription:
    """Converge the subscription's status to what its installments allow."""

    if subscription.status not in (Subscription.Status.ACTIVE, Subscription.Status.SUSPENDED):
        return subscription
    installment_suspended = is_installment_suspension(subscription)
    if (
        installment_suspended
        and subscription.current_period_ends_at
        and subscription.current_period_ends_at <= now
    ):
        return transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.EXPIRED,
            reason_code="period_ended",
            source=SubscriptionTransition.Source.RECONCILIATION,
            effective_at=subscription.current_period_ends_at,
            idempotency_key=(
                f"period-end:{subscription.id}:{subscription.current_period_ends_at.isoformat()}"
            ),
            allow_out_of_order=True,
        ).subscription
    agreement = active_agreement(subscription=subscription)
    if agreement is None:
        if installment_suspended:
            # The agreement was cancelled or settled elsewhere; nothing holds
            # access back any more.
            return _resume(subscription=subscription, now=now)
        return subscription
    snapshot = installment_snapshot(agreement, now=now)
    if snapshot.state == InstallmentState.COMPLETED:
        InstallmentAgreement.objects.filter(id=agreement.id).update(
            status=InstallmentAgreement.Status.COMPLETED, completed_at=now, updated_at=now
        )
        if installment_suspended:
            return _resume(subscription=subscription, now=now)
        return subscription
    number = snapshot.next_number
    if (
        snapshot.state == InstallmentState.CURRENT
        and snapshot.next_due_at
        and snapshot.pending_number is None
        and snapshot.next_due_at - INSTALLMENT_REMINDER_LEAD <= now
    ):
        _notify(
            subscription=subscription,
            kind="reminder",
            key=f"installment-reminder:{agreement.id}:{number}",
            snapshot=snapshot,
        )
    if snapshot.blocks_access:
        if snapshot.state == InstallmentState.DEFAULTED and snapshot.pending_number is None:
            _notify(
                subscription=subscription,
                kind="defaulted",
                key=f"installment-defaulted:{agreement.id}:{number}",
                snapshot=snapshot,
            )
        if subscription.status == Subscription.Status.ACTIVE:
            _notify(
                subscription=subscription,
                kind="overdue" if snapshot.state == InstallmentState.OVERDUE else "defaulted",
                key=f"installment-{snapshot.state}:{agreement.id}:{number}",
                snapshot=snapshot,
            )
            return transition_subscription(
                subscription_id=subscription.id,
                to_status=Subscription.Status.SUSPENDED,
                reason_code="installment_overdue",
                source=SubscriptionTransition.Source.SYSTEM,
                effective_at=now,
                idempotency_key=f"installment-suspend:{agreement.id}:{subscription.revision}",
                source_reference=str(agreement.id),
                allow_out_of_order=True,
            ).subscription
        return subscription
    if installment_suspended:
        return _resume(subscription=subscription, now=now)
    return subscription


def _resume(*, subscription: Subscription, now: datetime) -> Subscription:
    return transition_subscription(
        subscription_id=subscription.id,
        to_status=Subscription.Status.ACTIVE,
        reason_code="installment_resumed",
        source=SubscriptionTransition.Source.SYSTEM,
        effective_at=now,
        idempotency_key=f"installment-resume:{subscription.id}:{subscription.revision}",
        allow_out_of_order=True,
    ).subscription


def installment_payload(subscription: Subscription) -> dict[str, object] | None:
    agreement = latest_agreement(subscription=subscription)
    if agreement is None:
        return None
    snapshot = installment_snapshot(agreement)
    return {
        "agreement_id": str(agreement.id),
        "state": snapshot.state,
        "total_amount_minor": agreement.total_amount_minor,
        "paid_amount_minor": snapshot.paid_minor,
        "remaining_amount_minor": agreement.total_amount_minor - snapshot.paid_minor,
        "currency": agreement.currency,
        "currency_exponent": agreement.currency_exponent,
        "next_number": snapshot.next_number,
        "next_amount_minor": snapshot.next_amount_minor,
        "next_due_at": snapshot.next_due_at,
        "payment_window_ends_at": snapshot.payment_window_ends_at,
        "pending_number": snapshot.pending_number,
        "installments": list(snapshot.items),
    }
