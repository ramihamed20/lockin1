from datetime import datetime

from django.db.models import Q, QuerySet, Subquery
from django.utils import timezone

from apps.accounts.models import User
from apps.subscriptions.models import Subscription

from .models import EntitlementGrant

PAID_ACCESS_SUBSCRIPTION_STATUSES = (
    Subscription.Status.TRIALING,
    Subscription.Status.ACTIVE,
    Subscription.Status.GRACE,
)


def effective_grants_for_user(
    *, user: User, at: datetime | None = None
) -> QuerySet[EntitlementGrant]:
    """Return grants that can authorize access at this instant.

    A subscription-backed grant is only effective while its source subscription
    is itself in an access-granting lifecycle state. This makes reads fail
    closed when a stale grant row survives cancellation or suspension, while
    convergence remains the repair and audit mechanism.
    """
    now = at or timezone.now()
    # An ACTIVE subscription whose paid period has just ended is still inside
    # its grace window; only the reconciliation job has not relabelled it yet.
    # Requiring ``current_period_ends_at > now`` alone denied that reader every
    # study endpoint from the instant their period ended until something
    # happened to run the lifecycle -- the one moment a renewal reminder is
    # supposed to be reachable. A subscription set to end at period end gets no
    # such window, because it is heading for CANCELLED rather than GRACE.
    within_grace = Q(status=Subscription.Status.ACTIVE, cancel_at_period_end=False) & Q(
        grace_ends_at__gt=now
    )
    live_subscription_ids = (
        Subscription.objects.filter(account__primary_user=user)
        .filter(
            Q(status=Subscription.Status.TRIALING, trial_ends_at__gt=now)
            | Q(status=Subscription.Status.ACTIVE, current_period_ends_at__gt=now)
            | within_grace
            | Q(status=Subscription.Status.GRACE, grace_ends_at__gt=now)
        )
        .values("id")
    )
    return (
        EntitlementGrant.objects.filter(
            user=user,
            status=EntitlementGrant.Status.ACTIVE,
            entitlement__is_active=True,
            starts_at__lte=now,
        )
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        .filter(
            ~Q(source_type=EntitlementGrant.SourceType.SUBSCRIPTION)
            | Q(source_id__in=Subquery(live_subscription_ids))
        )
        .select_related("entitlement")
        .order_by("entitlement__code", "ends_at")
    )


def active_grants_for_user(*, user: User) -> QuerySet[EntitlementGrant]:
    """Compatibility name for the canonical effective-grant selector."""
    return effective_grants_for_user(user=user)
