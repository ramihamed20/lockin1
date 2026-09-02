import calendar
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.product_catalog.models import Plan, PlanVersion, Price
from platform_core.events import publish_after_commit

from .events import (
    SubscriptionCancellationScheduled,
    SubscriptionCreated,
    SubscriptionStatusChanged,
)
from .models import Subscription, SubscriptionAccount, SubscriptionTransition
from .validation import validate_transition


@dataclass(frozen=True, slots=True)
class TransitionResult:
    subscription: Subscription
    changed: bool


def advance_billing_period(start: datetime, *, interval: str, count: int) -> datetime:
    """Advance an authoritative billing anchor without client-owned duration math."""
    if count <= 0:
        raise ValueError("A billing interval count must be positive.")
    if interval == Price.Interval.DAY:
        return start + timedelta(days=count)
    if interval == Price.Interval.MONTH:
        months = count
    elif interval == Price.Interval.YEAR:
        months = count * 12
    else:
        raise ValueError("Unsupported billing interval.")
    total_month = start.month - 1 + months
    year = start.year + total_month // 12
    month = total_month % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


def paid_period_window(
    *, subscription: Subscription, price: Price, effective_at: datetime
) -> tuple[datetime, datetime]:
    """Return the paid segment anchor/end while preserving trial and grace accounting."""
    if (
        subscription.status == Subscription.Status.TRIALING
        and subscription.trial_ends_at
        and subscription.trial_ends_at > effective_at
    ):
        anchor = subscription.trial_ends_at
    elif (
        subscription.status in (Subscription.Status.ACTIVE, Subscription.Status.GRACE)
        and subscription.current_period_ends_at
    ) or (
        subscription.current_period_ends_at
        and subscription.grace_ends_at
        and effective_at <= subscription.grace_ends_at
    ):
        anchor = subscription.current_period_ends_at
    else:
        anchor = effective_at
    return anchor, advance_billing_period(
        anchor, interval=price.interval, count=price.interval_count
    )


@transaction.atomic
def get_or_create_individual_account(*, user: User) -> SubscriptionAccount:
    account, _ = SubscriptionAccount.objects.select_for_update().get_or_create(
        kind=SubscriptionAccount.Kind.INDIVIDUAL,
        primary_user=user,
        defaults={"display_name": user.full_name or user.email},
    )
    return account


@transaction.atomic
def create_trial_for_user(
    *, user: User, started_at: datetime | None = None, source_reference: str = ""
) -> tuple[Subscription, bool]:
    if user.email_verified_at is None or user.status != User.Status.ACTIVE:
        raise ValueError("A trial requires a verified active account.")
    account = get_or_create_individual_account(user=user)
    existing = account.subscriptions.order_by("-created_at").first()
    if existing is not None:
        return existing, False
    plan = Plan.objects.select_related("current_version").get(
        code=settings.DEFAULT_TRIAL_PLAN_CODE,
        status=Plan.Status.ACTIVE,
        current_version__isnull=False,
    )
    version = plan.current_version
    if version is None or version.trial_days <= 0:
        raise ValueError("The configured trial plan is not published with a trial period.")
    start = started_at or user.email_verified_at or timezone.now()
    end = start + timedelta(days=version.trial_days)
    subscription = Subscription.objects.create(
        account=account,
        plan_version=version,
        status=Subscription.Status.TRIALING,
        started_at=start,
        trial_started_at=start,
        trial_ends_at=end,
        current_period_started_at=start,
        current_period_ends_at=end,
        status_reason="trial_started",
    )
    SubscriptionTransition.objects.create(
        subscription=subscription,
        from_status="",
        to_status=Subscription.Status.TRIALING,
        source=SubscriptionTransition.Source.SYSTEM,
        reason_code="trial_started",
        source_reference=source_reference,
        idempotency_key=f"trial:{user.id}",
        effective_at=start,
    )
    publish_after_commit(
        SubscriptionCreated(
            subscription_id=subscription.id,
            user_id=user.id,
            status=subscription.status,
        )
    )
    publish_after_commit(
        SubscriptionStatusChanged(
            subscription_id=subscription.id,
            user_id=user.id,
            from_status="",
            to_status=subscription.status,
            effective_at=start,
            reason_code="trial_started",
        )
    )
    return subscription, True


@transaction.atomic
def create_pending_subscription(
    *, account: SubscriptionAccount, plan_version: PlanVersion, idempotency_key: str
) -> tuple[Subscription, bool]:
    if not idempotency_key:
        raise ValueError("An idempotency key is required.")
    existing = SubscriptionTransition.objects.filter(
        subscription__account=account,
        idempotency_key=idempotency_key,
    ).first()
    if existing is not None:
        return existing.subscription, False
    pending = account.subscriptions.filter(status=Subscription.Status.PENDING).first()
    if pending is not None and pending.plan_version_id == plan_version.id:
        return pending, False
    if pending is not None:
        raise ValueError("The account already has a pending subscription change.")
    subscription = Subscription.objects.create(
        account=account,
        plan_version=plan_version,
        status=Subscription.Status.PENDING,
        status_reason="awaiting_payment",
    )
    SubscriptionTransition.objects.create(
        subscription=subscription,
        from_status="",
        to_status=Subscription.Status.PENDING,
        source=SubscriptionTransition.Source.USER,
        reason_code="checkout_started",
        idempotency_key=idempotency_key,
        effective_at=timezone.now(),
    )
    publish_after_commit(
        SubscriptionCreated(
            subscription_id=subscription.id,
            user_id=account.primary_user_id,
            status=subscription.status,
        )
    )
    return subscription, True


@transaction.atomic
def transition_subscription(
    *,
    subscription_id: UUID,
    to_status: str,
    reason_code: str,
    source: str,
    effective_at: datetime,
    idempotency_key: str,
    actor: User | None = None,
    source_reference: str = "",
    period_started_at: datetime | None = None,
    period_ends_at: datetime | None = None,
) -> TransitionResult:
    subscription = (
        Subscription.objects.select_for_update()
        .select_related("account", "plan_version")
        .get(id=subscription_id)
    )
    duplicate = SubscriptionTransition.objects.filter(
        subscription=subscription, idempotency_key=idempotency_key
    ).first()
    if duplicate is not None:
        return TransitionResult(subscription=subscription, changed=False)
    latest = subscription.transitions.order_by("-effective_at", "-created_at").first()
    if latest is not None and effective_at < latest.effective_at:
        SubscriptionTransition.objects.create(
            subscription=subscription,
            from_status=subscription.status,
            to_status=subscription.status,
            source=source,
            reason_code="out_of_order_ignored",
            actor=actor,
            source_reference=source_reference,
            idempotency_key=idempotency_key,
            effective_at=effective_at,
            metadata={"requested_status": to_status},
        )
        return TransitionResult(subscription=subscription, changed=False)
    from_status = subscription.status
    validate_transition(from_status=from_status, to_status=to_status)
    if period_started_at and period_ends_at and period_ends_at <= period_started_at:
        raise ValueError("A subscription period must end after it starts.")
    subscription.status = to_status
    subscription.status_reason = reason_code
    subscription.revision += 1
    if period_started_at is not None:
        subscription.current_period_started_at = period_started_at
    if period_ends_at is not None:
        subscription.current_period_ends_at = period_ends_at
        subscription.grace_ends_at = period_ends_at + timedelta(
            days=subscription.plan_version.grace_days
        )
    if to_status == Subscription.Status.ACTIVE:
        subscription.started_at = subscription.started_at or effective_at
        subscription.suspended_at = None
        subscription.ended_at = None
    elif to_status == Subscription.Status.SUSPENDED:
        subscription.suspended_at = effective_at
    elif to_status == Subscription.Status.CANCELLED:
        subscription.cancelled_at = effective_at
        subscription.ended_at = effective_at
    elif to_status in (Subscription.Status.EXPIRED, Subscription.Status.REFUNDED):
        subscription.ended_at = effective_at
    subscription.save()
    SubscriptionTransition.objects.create(
        subscription=subscription,
        from_status=from_status,
        to_status=to_status,
        source=source,
        reason_code=reason_code,
        actor=actor,
        source_reference=source_reference,
        idempotency_key=idempotency_key,
        effective_at=effective_at,
        metadata={
            "period_started_at": period_started_at.isoformat() if period_started_at else None,
            "period_ends_at": period_ends_at.isoformat() if period_ends_at else None,
        },
    )
    publish_after_commit(
        SubscriptionStatusChanged(
            subscription_id=subscription.id,
            user_id=subscription.account.primary_user_id,
            from_status=from_status,
            to_status=to_status,
            effective_at=effective_at,
            reason_code=reason_code,
            actor_id=actor.id if actor else None,
        )
    )
    return TransitionResult(subscription=subscription, changed=True)


@transaction.atomic
def schedule_cancellation(*, subscription: Subscription, user: User) -> Subscription:
    subscription = (
        Subscription.objects.select_for_update()
        .select_related("account")
        .get(
            id=subscription.id,
            account__primary_user=user,
            status__in=(
                Subscription.Status.TRIALING,
                Subscription.Status.ACTIVE,
                Subscription.Status.GRACE,
            ),
        )
    )
    if subscription.cancel_at_period_end:
        return subscription
    now = timezone.now()
    subscription.cancel_at_period_end = True
    subscription.cancellation_requested_at = now
    subscription.revision += 1
    subscription.save(
        update_fields=(
            "cancel_at_period_end",
            "cancellation_requested_at",
            "revision",
            "updated_at",
        )
    )
    SubscriptionTransition.objects.create(
        subscription=subscription,
        from_status=subscription.status,
        to_status=subscription.status,
        source=SubscriptionTransition.Source.USER,
        reason_code="cancellation_scheduled",
        actor=user,
        idempotency_key=f"cancel:{subscription.id}:{subscription.revision}",
        effective_at=now,
    )
    publish_after_commit(
        SubscriptionCancellationScheduled(
            subscription_id=subscription.id,
            user_id=user.id,
            effective_at=subscription.current_period_ends_at,
            actor_id=user.id,
        )
    )
    return subscription


def refresh_subscription(
    *, subscription: Subscription, now: datetime | None = None
) -> Subscription:
    current = now or timezone.now()
    if (
        subscription.status == Subscription.Status.TRIALING
        and subscription.trial_ends_at
        and subscription.trial_ends_at <= current
    ):
        target = (
            Subscription.Status.CANCELLED
            if subscription.cancel_at_period_end
            else Subscription.Status.EXPIRED
        )
        return transition_subscription(
            subscription_id=subscription.id,
            to_status=target,
            reason_code="trial_ended",
            source=SubscriptionTransition.Source.RECONCILIATION,
            effective_at=subscription.trial_ends_at,
            idempotency_key=f"trial-end:{subscription.id}",
        ).subscription
    if (
        subscription.status == Subscription.Status.ACTIVE
        and subscription.current_period_ends_at
        and subscription.current_period_ends_at <= current
    ):
        if subscription.cancel_at_period_end:
            target = Subscription.Status.CANCELLED
        elif subscription.plan_version.grace_days > 0:
            target = Subscription.Status.GRACE
        else:
            target = Subscription.Status.EXPIRED
        return transition_subscription(
            subscription_id=subscription.id,
            to_status=target,
            reason_code="period_ended",
            source=SubscriptionTransition.Source.RECONCILIATION,
            effective_at=subscription.current_period_ends_at,
            idempotency_key=(
                f"period-end:{subscription.id}:{subscription.current_period_ends_at.isoformat()}"
            ),
        ).subscription
    if (
        subscription.status == Subscription.Status.GRACE
        and subscription.grace_ends_at
        and subscription.grace_ends_at <= current
    ):
        return transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.EXPIRED,
            reason_code="grace_ended",
            source=SubscriptionTransition.Source.RECONCILIATION,
            effective_at=subscription.grace_ends_at,
            idempotency_key=(
                f"grace-end:{subscription.id}:{subscription.grace_ends_at.isoformat()}"
            ),
        ).subscription
    return subscription
