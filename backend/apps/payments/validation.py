from .models import Payment

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    Payment.Status.INITIATED: frozenset(
        {
            Payment.Status.PENDING,
            Payment.Status.SUCCEEDED,
            Payment.Status.FAILED,
            Payment.Status.CANCELLED,
        }
    ),
    Payment.Status.PENDING: frozenset(
        {Payment.Status.SUCCEEDED, Payment.Status.FAILED, Payment.Status.CANCELLED}
    ),
    Payment.Status.SUCCEEDED: frozenset(
        {Payment.Status.PARTIALLY_REFUNDED, Payment.Status.REFUNDED}
    ),
    Payment.Status.PARTIALLY_REFUNDED: frozenset(
        {Payment.Status.PARTIALLY_REFUNDED, Payment.Status.REFUNDED}
    ),
    Payment.Status.FAILED: frozenset(),
    Payment.Status.CANCELLED: frozenset(),
    Payment.Status.REFUNDED: frozenset(),
}


def validate_payment_transition(*, from_status: str, to_status: str) -> None:
    if to_status not in ALLOWED_TRANSITIONS.get(from_status, frozenset()):
        raise ValueError(f"Payment transition {from_status} -> {to_status} is not allowed.")
