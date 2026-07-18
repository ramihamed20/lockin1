from .models import Subscription

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    Subscription.Status.PENDING: frozenset(
        {
            Subscription.Status.ACTIVE,
            Subscription.Status.CANCELLED,
            Subscription.Status.EXPIRED,
            Subscription.Status.SUSPENDED,
        }
    ),
    Subscription.Status.TRIALING: frozenset(
        {
            Subscription.Status.ACTIVE,
            Subscription.Status.CANCELLED,
            Subscription.Status.EXPIRED,
            Subscription.Status.SUSPENDED,
        }
    ),
    Subscription.Status.ACTIVE: frozenset(
        {
            Subscription.Status.ACTIVE,
            Subscription.Status.GRACE,
            Subscription.Status.CANCELLED,
            Subscription.Status.EXPIRED,
            Subscription.Status.SUSPENDED,
            Subscription.Status.REFUNDED,
        }
    ),
    Subscription.Status.GRACE: frozenset(
        {
            Subscription.Status.ACTIVE,
            Subscription.Status.EXPIRED,
            Subscription.Status.CANCELLED,
            Subscription.Status.SUSPENDED,
            Subscription.Status.REFUNDED,
        }
    ),
    Subscription.Status.SUSPENDED: frozenset(
        {
            Subscription.Status.ACTIVE,
            Subscription.Status.EXPIRED,
            Subscription.Status.CANCELLED,
            Subscription.Status.REFUNDED,
        }
    ),
    Subscription.Status.EXPIRED: frozenset({Subscription.Status.ACTIVE}),
    Subscription.Status.CANCELLED: frozenset({Subscription.Status.ACTIVE}),
    Subscription.Status.REFUNDED: frozenset(),
}


def validate_transition(*, from_status: str, to_status: str) -> None:
    if to_status not in ALLOWED_TRANSITIONS.get(from_status, frozenset()):
        raise ValueError(f"Subscription transition {from_status} -> {to_status} is not allowed.")
