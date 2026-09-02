from apps.accounts.events import UserEmailVerified
from apps.accounts.models import User
from apps.entitlements.services import sync_subscription_entitlements
from apps.invoices.services import apply_invoice_refund, issue_paid_invoice
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.payments.events import PaymentFailed, PaymentSucceeded
from apps.payments.models import Payment
from apps.payments.services import apply_successful_refund
from apps.provider_integrations.events import ProviderEventVerified
from apps.provider_integrations.services import process_provider_event
from apps.refunds.events import RefundFailed, RefundSucceeded
from apps.subscriptions.events import SubscriptionStatusChanged
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import (
    advance_billing_period,
    create_trial_for_user,
    transition_subscription,
)
from platform_core.events import domain_events

_registered = False


def _email_verified(event: UserEmailVerified) -> None:
    user = User.objects.get(id=event.user_id)
    create_trial_for_user(
        user=user,
        started_at=event.occurred_at,
        source_reference=f"event:{event.event_id}",
    )


def _subscription_changed(event: SubscriptionStatusChanged) -> None:
    sync_subscription_entitlements(subscription_id=event.subscription_id)
    if event.user_id is None:
        return
    messages: dict[str, tuple[str, str]] = {
        Subscription.Status.TRIALING: (
            "Trial started",
            "Your Lock-in trial and included access are ready.",
        ),
        Subscription.Status.ACTIVE: (
            "Subscription active",
            "Your plan and entitlements are active.",
        ),
        Subscription.Status.GRACE: (
            "Payment attention needed",
            "Your access is in a grace period. Review billing details.",
        ),
        Subscription.Status.EXPIRED: (
            "Subscription expired",
            "Your plan ended. Your learning records remain safe.",
        ),
        Subscription.Status.CANCELLED: ("Subscription cancelled", "Your subscription has ended."),
        Subscription.Status.SUSPENDED: (
            "Subscription suspended",
            "Your subscription needs administrator review.",
        ),
        Subscription.Status.REFUNDED: (
            "Subscription refunded",
            "Your subscription was refunded and paid access ended.",
        ),
    }
    message = messages.get(event.to_status)
    if message is None:
        return
    create_notification(
        recipient_id=event.user_id,
        category=Notification.Category.BILLING,
        template_key=f"billing.subscription.{event.to_status}",
        title=message[0],
        body=message[1],
        deduplication_key=f"subscription-status:{event.subscription_id}:{event.event_id}",
        target_type="subscription",
        target_id=event.subscription_id,
        target_route="/subscription",
        required=True,
    )


def _provider_event_verified(event: ProviderEventVerified) -> None:
    process_provider_event(provider_event_id=event.provider_event_id)


def _payment_succeeded(event: PaymentSucceeded) -> None:
    payment = Payment.objects.select_related(
        "subscription__account", "subscription__plan_version", "price"
    ).get(id=event.payment_id)
    subscription = payment.subscription
    live_statuses = (
        Subscription.Status.TRIALING,
        Subscription.Status.ACTIVE,
        Subscription.Status.GRACE,
        Subscription.Status.SUSPENDED,
    )
    other_live = (
        subscription.account.subscriptions.filter(status__in=live_statuses)
        .exclude(id=subscription.id)
        .first()
    )
    if other_live is not None:
        transition_subscription(
            subscription_id=other_live.id,
            to_status=Subscription.Status.CANCELLED,
            reason_code="plan_replaced",
            source=SubscriptionTransition.Source.PROVIDER,
            effective_at=event.effective_at,
            idempotency_key=f"replacement:{payment.id}",
            source_reference=str(payment.id),
        )
    period_end = advance_billing_period(
        event.effective_at,
        interval=payment.price.interval,
        count=payment.price.interval_count,
    )
    transition_subscription(
        subscription_id=subscription.id,
        to_status=Subscription.Status.ACTIVE,
        reason_code="payment_succeeded",
        source=SubscriptionTransition.Source.PROVIDER,
        effective_at=event.effective_at,
        idempotency_key=f"payment:{payment.id}",
        source_reference=str(payment.id),
        period_started_at=event.effective_at,
        period_ends_at=period_end,
    )
    issue_paid_invoice(payment_id=payment.id)
    if event.user_id is not None:
        create_notification(
            recipient_id=event.user_id,
            category=Notification.Category.BILLING,
            template_key="billing.payment.succeeded",
            title="Payment confirmed",
            body="Your payment was verified by the server and your invoice is ready.",
            deduplication_key=f"payment-succeeded:{payment.id}",
            target_route="/subscription",
            required=True,
        )


def _payment_failed(event: PaymentFailed) -> None:
    subscription = Subscription.objects.select_related("plan_version").get(id=event.subscription_id)
    if subscription.status == Subscription.Status.PENDING:
        transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.CANCELLED,
            reason_code="payment_failed",
            source=SubscriptionTransition.Source.PROVIDER,
            effective_at=event.effective_at,
            idempotency_key=f"payment-failed:{event.payment_id}",
            source_reference=str(event.payment_id),
        )
    elif (
        subscription.status == Subscription.Status.ACTIVE
        and subscription.current_period_ends_at is not None
        and subscription.current_period_ends_at <= event.effective_at
    ):
        target = (
            Subscription.Status.GRACE
            if subscription.plan_version.grace_days > 0
            else Subscription.Status.EXPIRED
        )
        transition_subscription(
            subscription_id=subscription.id,
            to_status=target,
            reason_code="renewal_failed",
            source=SubscriptionTransition.Source.PROVIDER,
            effective_at=event.effective_at,
            idempotency_key=f"renewal-failed:{event.payment_id}",
            source_reference=str(event.payment_id),
        )
    if event.user_id is not None:
        create_notification(
            recipient_id=event.user_id,
            category=Notification.Category.BILLING,
            template_key="billing.payment.failed",
            title="Payment was not completed",
            body="No paid access was granted. Review your billing details before trying again.",
            deduplication_key=f"payment-failed:{event.payment_id}",
            target_route="/subscription",
            required=True,
        )


def _refund_succeeded(event: RefundSucceeded) -> None:
    payment = apply_successful_refund(
        payment_id=event.payment_id,
        amount_minor=event.amount_minor,
        refund_id=event.refund_id,
    )
    apply_invoice_refund(
        payment_id=event.payment_id,
        refund_id=event.refund_id,
        amount_minor=event.amount_minor,
    )
    if payment.status == Payment.Status.REFUNDED:
        transition_subscription(
            subscription_id=event.subscription_id,
            to_status=Subscription.Status.REFUNDED,
            reason_code="payment_fully_refunded",
            source=SubscriptionTransition.Source.PROVIDER,
            effective_at=event.effective_at,
            idempotency_key=f"refund:{event.refund_id}",
            source_reference=str(event.refund_id),
        )
    if event.user_id is not None:
        create_notification(
            recipient_id=event.user_id,
            category=Notification.Category.BILLING,
            template_key="billing.refund.succeeded",
            title="Refund confirmed",
            body="Your verified refund is now reflected in billing history.",
            deduplication_key=f"refund-succeeded:{event.refund_id}",
            target_route="/subscription",
            required=True,
        )


def _refund_failed(event: RefundFailed) -> None:
    if event.user_id is None:
        return
    create_notification(
        recipient_id=event.user_id,
        category=Notification.Category.BILLING,
        template_key="billing.refund.failed",
        title="Refund needs attention",
        body="The refund was not confirmed. An administrator can safely retry it.",
        deduplication_key=f"refund-failed:{event.refund_id}",
        target_route="/subscription",
        required=True,
    )


def register_subscribers() -> None:
    global _registered
    if _registered:
        return
    domain_events.subscribe(UserEmailVerified, _email_verified)
    domain_events.subscribe(SubscriptionStatusChanged, _subscription_changed)
    domain_events.subscribe(ProviderEventVerified, _provider_event_verified)
    domain_events.subscribe(PaymentSucceeded, _payment_succeeded)
    domain_events.subscribe(PaymentFailed, _payment_failed)
    domain_events.subscribe(RefundSucceeded, _refund_succeeded)
    domain_events.subscribe(RefundFailed, _refund_failed)
    _registered = True
