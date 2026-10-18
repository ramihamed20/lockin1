"""Refund arithmetic over one purchase, using its immutable policy snapshot."""

from datetime import datetime, timedelta

from apps.accounts.policies import USER_POLICY_VERSION
from apps.payments.models import ManualRechargeSubmission, Payment

REFUND_WINDOW = timedelta(days=15)
FULL_INSTALLMENT_WINDOW = timedelta(days=10)


def activation_at(payment: Payment) -> datetime | None:
    first = payment
    if payment.installment_agreement is not None:
        candidate = payment.installment_agreement.payments.filter(installment_number=1).first()
        if candidate is None:
            return None
        first = candidate
    if first.succeeded_at is None:
        return None
    try:
        submission = first.manual_submission
    except ManualRechargeSubmission.DoesNotExist:
        return first.succeeded_at
    if (
        submission.reviewed_at is None
        or submission.status != ManualRechargeSubmission.Status.APPROVED
    ):
        return None
    return max(
        first.succeeded_at, submission.reviewed_at, submission.subscription_period_started_at
    )


def voluntary_rate(payment: Payment, *, received_at: datetime) -> int:
    start = activation_at(payment)
    if start is None:
        return 100  # Money received before activation remains returnable.
    if received_at > start + REFUND_WINDOW:
        return 0
    first = payment
    if payment.installment_agreement is not None:
        first = (
            payment.installment_agreement.payments.filter(installment_number=1).first() or payment
        )
    # Earlier transactions keep the earlier, more favourable 15-day guarantee.
    if first.price_snapshot.get("policy_version") != USER_POLICY_VERSION:
        return 100
    if payment.installment_agreement_id and received_at > start + FULL_INSTALLMENT_WINDOW:
        return 50
    return 100
