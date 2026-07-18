from .models import Refund

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    Refund.Status.REQUESTED: frozenset(
        {
            Refund.Status.PENDING,
            Refund.Status.SUCCEEDED,
            Refund.Status.FAILED,
            Refund.Status.CANCELLED,
        }
    ),
    Refund.Status.PENDING: frozenset(
        {Refund.Status.SUCCEEDED, Refund.Status.FAILED, Refund.Status.CANCELLED}
    ),
    Refund.Status.FAILED: frozenset({Refund.Status.PENDING}),
    Refund.Status.SUCCEEDED: frozenset(),
    Refund.Status.CANCELLED: frozenset(),
}


def validate_refund_transition(*, from_status: str, to_status: str) -> None:
    if to_status not in ALLOWED_TRANSITIONS.get(from_status, frozenset()):
        raise ValueError(f"Refund cannot transition from {from_status} to {to_status}.")
