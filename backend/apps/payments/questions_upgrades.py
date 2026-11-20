"""Verified, same-term questions-only -> full-content upgrade offers.

These are strictly *feature* upgrades: a reader retains the original paid end
date, and never purchases additional term days through the discount.
"""

from dataclasses import dataclass
from datetime import datetime

from django.utils import timezone

from apps.payments.models import PARTIAL_COLLECTION_FAILURE_CODE, Payment
from apps.product_catalog.dentistry_terms import (
    POST_MIDTERM_ENDS_AT,
    PRE_MIDTERM_ENDS_AT,
)
from apps.product_catalog.models import Price
from apps.subscriptions.models import Subscription


@dataclass(frozen=True)
class QuestionsUpgrade:
    source_plan_code: str
    target_plan_code: str
    price_eligibility: str
    already_paid_minor: int
    full_price_minor: int
    period_ends_at: datetime

    @property
    def difference_minor(self) -> int:
        return self.full_price_minor - self.already_paid_minor


UPGRADES = (
    QuestionsUpgrade(
        "tripoli_y2_questions_pre",
        "dentistry_pre_midterm",
        Price.Eligibility.QUESTIONS_PRE_UPGRADE,
        15_000,
        30_000,
        PRE_MIDTERM_ENDS_AT,
    ),
    QuestionsUpgrade(
        "tripoli_y2_questions_post",
        "dentistry_post_midterm",
        Price.Eligibility.QUESTIONS_POST_UPGRADE,
        35_000,
        50_000,
        POST_MIDTERM_ENDS_AT,
    ),
    QuestionsUpgrade(
        "tripoli_y2_questions_year",
        "dentistry_full_year",
        Price.Eligibility.QUESTIONS_YEAR_UPGRADE,
        50_000,
        80_000,
        POST_MIDTERM_ENDS_AT,
    ),
)
UPGRADE_BY_SOURCE = {rule.source_plan_code: rule for rule in UPGRADES}
UPGRADE_BY_ELIGIBILITY = {rule.price_eligibility: rule for rule in UPGRADES}


def eligible_questions_upgrade(
    *, subscription: Subscription | None, now: datetime | None = None
) -> QuestionsUpgrade | None:
    """A verified, fully paid questions-only period may add the PDFs once.

    This is checked again under the subscription-account lock on submission.
    We never accept a pending card, installment debt, refunded payment,
    manually gifted plan or earlier payment from another subscription.
    """
    if subscription is None or subscription.status != Subscription.Status.ACTIVE:
        return None
    if (
        subscription.payment_verification != Subscription.PaymentVerification.VERIFIED
        or subscription.provisional_payment_id is not None
    ):
        return None
    current = now or timezone.now()
    rule = UPGRADE_BY_SOURCE.get(subscription.plan_version.plan.code)
    if rule is None or not (subscription.plan_version.terms or {}).get("questions_only"):
        return None
    if (
        subscription.current_period_ends_at != rule.period_ends_at
        or subscription.current_period_ends_at <= current
    ):
        return None
    from apps.payments.installments import active_agreement, is_installment_suspension

    if is_installment_suspension(subscription) or active_agreement(subscription=subscription):
        return None
    paid = (
        Payment.objects.filter(
            subscription=subscription,
            price__plan_version_id=subscription.plan_version_id,
            price__amount_minor=rule.already_paid_minor,
            status=Payment.Status.SUCCEEDED,
            refunded_amount_minor=0,
        )
        .exclude(failure_code=PARTIAL_COLLECTION_FAILURE_CODE)
        .exists()
    )
    return rule if paid else None


def questions_upgrade_for_price(
    *, subscription: Subscription | None, price: Price, now: datetime | None = None
) -> QuestionsUpgrade | None:
    rule = UPGRADE_BY_ELIGIBILITY.get(price.eligibility)
    if rule is None:
        return None
    eligible = eligible_questions_upgrade(subscription=subscription, now=now)
    if (
        eligible != rule
        or price.plan_version.plan.code != rule.target_plan_code
        or price.amount_minor != rule.difference_minor
        or price.currency != "LYD"
        or price.currency_exponent != 3
    ):
        return None
    return rule
