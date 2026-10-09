"""The 2026/27 dentistry term plans: prices, upgrades, installments, conversion."""

import base64
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.services import entitlement_decision
from apps.notifications.models import Notification
from apps.payments.installments import InstallmentState, installment_snapshot
from apps.payments.manual_services import (
    ManualPaymentError,
    review_manual_recharge,
    submit_manual_recharge,
)
from apps.payments.models import InstallmentAgreement, Payment
from apps.product_catalog.dentistry_terms import (
    FIRST_MONTH_OFFER_ENDS_AT,
    POST_MIDTERM_ENDS_AT,
    PRE_MIDTERM_ENDS_AT,
)
from apps.product_catalog.models import Plan, Price
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user, refresh_subscription

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("legacy_duration_prices")]

START = datetime(2026, 10, 8, 10, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def manual_payment_settings(settings):  # type: ignore[no-untyped-def]
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""
    settings.MANUAL_PAYMENT_RATE_LIMIT = 100


@contextmanager
def at(moment: datetime):
    with patch("django.utils.timezone.now", return_value=moment):
        yield


_codes = iter(range(1_000_000_000_000, 9_999_999_999_999, 7_919))


def _code() -> str:
    return str(next(_codes))


def _keys():
    n = 0
    while True:
        n += 1
        yield f"term-plan-attempt-{n:06d}"


_key = _keys()


def _reader(name: str):
    with at(START):
        user = create_user(email=f"{name}@example.com", username=name.replace("-", "_")[:30])
        create_trial_for_user(user=user, source_reference="test")
    return user


@pytest.fixture(autouse=True)
def reviewer():  # type: ignore[no-untyped-def]
    return create_user(email="reviewer@example.com", username="reviewer", is_staff=True)


def _plan(code: str) -> Plan:
    return Plan.objects.get(code=code)


def _price(code: str) -> Price:
    return Price.objects.select_related("plan_version").get(code=code)


def _buy(user, price_code: str, *, installments: bool = False, cards: int = 1):  # type: ignore[no-untyped-def]
    return submit_manual_recharge(
        user=user,
        price=_price(price_code),
        recharge_codes=[_code() for _ in range(cards)],
        idempotency_key=next(_key),
        pay_in_installments=installments,
    )


def _review(payment: Payment, decision: str) -> None:
    from apps.accounts.models import User

    review_manual_recharge(
        payment_id=payment.id,
        actor=User.objects.get(username="reviewer"),
        decision=decision,
        reason="checked",
        idempotency_key=f"review-{payment.id}-{decision}",
    )


def _catalog(user) -> dict[str, dict]:  # type: ignore[no-untyped-def]
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/v1/catalog/products")
    assert response.status_code == 200
    return {
        plan["code"]: plan["current_version"]
        for product in response.json()["results"]
        for plan in product["plans"]
        if plan["current_version"]
    }


def _subscription(user) -> Subscription:  # type: ignore[no-untyped-def]
    return Subscription.objects.select_related("plan_version", "account").get(
        account__primary_user=user
    )


def _has_access(user) -> bool:  # type: ignore[no-untyped-def]
    return entitlement_decision(user=user, entitlement_code="content.premium").allowed


# --- catalog and prices -----------------------------------------------------


def test_a_new_reader_sees_the_three_terms_at_their_general_prices() -> None:
    user = _reader("new-reader")
    with at(START):
        catalog = _catalog(user)

    def amount(code: str) -> list[int]:
        return [p["amount_minor"] for p in catalog[code]["prices"]]

    assert amount("dentistry_pre_midterm") == [30_000]
    assert amount("dentistry_post_midterm") == [50_000]
    assert amount("dentistry_full_year") == [80_000]
    full_year = catalog["dentistry_full_year"]["prices"][0]
    assert full_year["installment_amounts_minor"] == [30_000] + [10_000] * 5
    assert full_year["installments_available"] is True
    assert full_year["purchase_blocked_reason"] is None
    assert catalog["dentistry_pre_midterm"]["fixed_period_ends_at"] == (
        PRE_MIDTERM_ENDS_AT.isoformat()
    )


def test_the_first_month_offer_stops_at_midnight_tripoli_on_the_ninth() -> None:
    from apps.product_catalog.models import Price as CatalogPrice

    # Undo the legacy fixture for this one price: production keeps the date.
    CatalogPrice.objects.filter(code="lockin_first_month_5_lyd").update(
        valid_until=FIRST_MONTH_OFFER_ENDS_AT
    )
    user = _reader("offer-deadline")
    with at(FIRST_MONTH_OFFER_ENDS_AT - timedelta(minutes=1)):
        assert _catalog(user)["lockin_first_month"]["prices"]
    with at(FIRST_MONTH_OFFER_ENDS_AT):
        assert _catalog(user)["lockin_first_month"]["prices"] == []
    assert datetime(2026, 10, 9, 22, 0, tzinfo=UTC) == FIRST_MONTH_OFFER_ENDS_AT


def test_a_paying_subscriber_before_the_deadline_gets_pre_midterm_for_25() -> None:
    user = _reader("loyal")
    with at(START):
        result = _buy(user, "lockin_first_month_5_lyd")
        _review(result.payment, "approve")
    with at(START + timedelta(days=3)):
        prices = _catalog(user)["dentistry_pre_midterm"]["prices"]
        assert [p["amount_minor"] for p in prices] == [25_000]
        assert prices[0]["installment_amounts_minor"] == [10_000, 10_000, 5_000]
        upgrade = submit_manual_recharge(
            user=user,
            price=_price("dentistry_pre_midterm_loyalty_25_lyd"),
            recharge_codes=[_code(), _code()],
            idempotency_key=next(_key),
        )
    assert upgrade.payment.amount_minor == 25_000
    subscription = _subscription(user)
    assert subscription.current_period_ends_at == PRE_MIDTERM_ENDS_AT
    # The running month is kept, not cut short or restarted.
    assert subscription.current_period_started_at == result.subscription.current_period_started_at
    assert upgrade.submission.is_early_renewal is True


def test_a_payment_submitted_after_the_deadline_does_not_earn_the_loyalty_price() -> None:
    user = _reader("late")
    with at(FIRST_MONTH_OFFER_ENDS_AT + timedelta(hours=1)):
        result = _buy(user, "lockin_first_month_5_lyd")
        _review(result.payment, "approve")
        prices = _catalog(user)["dentistry_pre_midterm"]["prices"]
    assert [p["amount_minor"] for p in prices] == [30_000]


def test_a_free_trial_alone_cannot_buy_at_the_loyalty_price() -> None:
    user = _reader("trial-only")
    with at(START), pytest.raises(ManualPaymentError, match="not available for your account"):
        _buy(user, "dentistry_pre_midterm_loyalty_25_lyd")


def test_four_month_subscribers_get_post_midterm_for_20_and_not_the_loyalty_price() -> None:
    user = _reader("four-months")
    with at(START):
        result = _buy(user, "lockin_four_months_30_lyd", cards=2)
        _review(result.payment, "approve")
        catalog = _catalog(user)
    post = catalog["dentistry_post_midterm"]["prices"]
    assert [p["amount_minor"] for p in post] == [20_000]
    assert post[0]["installment_amounts_minor"] == [10_000, 10_000]
    assert [p["amount_minor"] for p in catalog["dentistry_full_year"]["prices"]] == [20_000]
    assert [p["amount_minor"] for p in catalog["dentistry_pre_midterm"]["prices"]] == [30_000]


def test_pre_midterm_subscribers_get_no_special_price() -> None:
    user = _reader("pre-midterm-plain")
    with at(START):
        result = _buy(user, "dentistry_pre_midterm_30_lyd", cards=3)
        _review(result.payment, "approve")
        catalog = _catalog(user)
    assert [p["amount_minor"] for p in catalog["dentistry_post_midterm"]["prices"]] == [50_000]
    assert [p["amount_minor"] for p in catalog["dentistry_full_year"]["prices"]] == [80_000]


def test_a_loyal_subscriber_gets_25_pre_midterm_50_post_midterm_and_70_full_year() -> None:
    loyal = _reader("loyal-full-year")
    with at(START):
        offer = _buy(loyal, "lockin_first_month_5_lyd")
        _review(offer.payment, "approve")
        catalog = _catalog(loyal)
    assert [p["amount_minor"] for p in catalog["dentistry_full_year"]["prices"]] == [70_000]
    assert [p["amount_minor"] for p in catalog["dentistry_pre_midterm"]["prices"]] == [25_000]
    assert [p["amount_minor"] for p in catalog["dentistry_post_midterm"]["prices"]] == [50_000]


def test_a_rejected_term_upgrade_restores_the_running_subscription() -> None:
    user = _reader("rejected-upgrade")
    with at(START):
        first = _buy(user, "lockin_first_month_5_lyd")
        _review(first.payment, "approve")
    before = _subscription(user)
    with at(START + timedelta(days=1)):
        upgrade = _buy(user, "dentistry_full_year_80_lyd", cards=3)
        assert _subscription(user).current_period_ends_at == POST_MIDTERM_ENDS_AT
        _review(upgrade.payment, "reject")
    after = _subscription(user)
    assert after.current_period_ends_at == before.current_period_ends_at
    assert after.plan_version_id == before.plan_version_id


def test_a_term_already_covered_cannot_be_bought_again() -> None:
    user = _reader("covered")
    with at(START):
        result = _buy(user, "dentistry_full_year_80_lyd", cards=3)
        _review(result.payment, "approve")
        catalog = _catalog(user)
        assert catalog["dentistry_pre_midterm"]["prices"][0]["purchase_blocked_reason"]
        with pytest.raises(ManualPaymentError, match="already covers"):
            _buy(user, "dentistry_pre_midterm_30_lyd")


def test_up_to_five_cards_are_accepted_and_six_are_refused() -> None:
    user = _reader("five-cards")
    with at(START):
        result = _buy(user, "dentistry_full_year_80_lyd", cards=5)
    assert result.submission.recharge_codes.count() == 5
    other = _reader("six-cards")
    with at(START), pytest.raises(ManualPaymentError, match="between one and 5"):
        _buy(other, "dentistry_full_year_80_lyd", cards=6)


def test_the_api_accepts_an_installment_purchase() -> None:
    user = _reader("api-installments")
    client = APIClient()
    client.force_authenticate(user)
    with at(START):
        response = client.post(
            "/api/v1/payments/manual-libyana",
            {
                "plan_id": str(_plan("dentistry_pre_midterm").id),
                "recharge_codes": [_code()],
                "pay_in_installments": True,
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=next(_key),
        )
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["payment"]["amount_minor"] == 15_000
    plan = body["subscription"]["installment_plan"]
    assert [item["amount_minor"] for item in plan["installments"]] == [15_000, 10_000, 5_000]
    assert plan["state"] == InstallmentState.IN_REVIEW


# --- installments -----------------------------------------------------------


def _installment_reader(name: str, price_code: str = "dentistry_pre_midterm_30_lyd"):
    user = _reader(name)
    with at(START):
        first = _buy(user, price_code, installments=True)
        _review(first.payment, "approve")
    agreement = InstallmentAgreement.objects.get(account__primary_user=user)
    return user, agreement


def _refresh(user, moment: datetime) -> Subscription:  # type: ignore[no-untyped-def]
    with at(moment):
        return refresh_subscription(subscription=_subscription(user), now=moment)


def _pay_next(user, agreement, moment: datetime):  # type: ignore[no-untyped-def]
    from apps.payments.manual_services import submit_installment_payment

    with at(moment):
        return submit_installment_payment(
            user=user,
            agreement_id=agreement.id,
            recharge_codes=[_code()],
            idempotency_key=next(_key),
        )


def test_the_first_installment_grants_the_whole_term() -> None:
    user, agreement = _installment_reader("whole-term")
    subscription = _subscription(user)
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.current_period_ends_at == PRE_MIDTERM_ENDS_AT
    assert agreement.installment_amounts_minor == [15_000, 10_000, 5_000]
    assert Payment.objects.get(installment_agreement=agreement).amount_minor == 15_000
    assert _has_access(user)


def test_a_missed_installment_suspends_access_and_paying_in_the_window_restores_it() -> None:
    user, agreement = _installment_reader("missed")
    due = START + timedelta(days=31)  # 8 November

    assert _refresh(user, due - timedelta(minutes=1)).status == Subscription.Status.ACTIVE
    suspended = _refresh(user, due + timedelta(minutes=1))
    assert suspended.status == Subscription.Status.SUSPENDED
    assert suspended.status_reason == "installment_overdue"
    assert not _has_access(user)
    assert Notification.objects.filter(
        recipient=user, template_key="billing.installment.overdue"
    ).exists()

    # Paid within two days: access returns on submission, before review.
    result = _pay_next(user, agreement, due + timedelta(days=1))
    assert result.payment.amount_minor == 10_000
    assert _subscription(user).status == Subscription.Status.ACTIVE
    assert _has_access(user)

    # A rejection puts the hold back.
    with at(due + timedelta(days=1, hours=1)):
        _review(result.payment, "reject")
    assert _subscription(user).status == Subscription.Status.SUSPENDED


def test_after_the_window_access_returns_only_on_approval() -> None:
    user, agreement = _installment_reader("defaulted")
    due = START + timedelta(days=31)
    _refresh(user, due + timedelta(minutes=1))
    late = due + timedelta(days=3)
    assert _refresh(user, late).status == Subscription.Status.SUSPENDED
    assert Notification.objects.filter(
        recipient=user, template_key="billing.installment.defaulted"
    ).exists()
    assert installment_snapshot(agreement, now=late).state == InstallmentState.DEFAULTED

    result = _pay_next(user, agreement, late)
    assert _subscription(user).status == Subscription.Status.SUSPENDED
    with at(late + timedelta(hours=2)):
        _review(result.payment, "approve")
    assert _subscription(user).status == Subscription.Status.ACTIVE
    assert _has_access(user)


def test_paying_every_installment_completes_the_agreement() -> None:
    user, agreement = _installment_reader("paid-off")
    for months, moment in ((1, START + timedelta(days=20)), (2, START + timedelta(days=45))):
        result = _pay_next(user, agreement, moment)
        with at(moment):
            _review(result.payment, "approve")
        assert result.payment.installment_number == months + 1
    _refresh(user, START + timedelta(days=90))
    agreement.refresh_from_db()
    assert agreement.status == InstallmentAgreement.Status.COMPLETED
    assert _subscription(user).status == Subscription.Status.ACTIVE
    assert (
        sum(
            Payment.objects.filter(
                installment_agreement=agreement, status=Payment.Status.SUCCEEDED
            ).values_list("amount_minor", flat=True)
        )
        == 30_000
    )


def test_a_rejected_first_installment_cancels_the_agreement() -> None:
    user = _reader("first-rejected")
    with at(START):
        first = _buy(user, "dentistry_post_midterm_50_lyd", installments=True)
        _review(first.payment, "reject")
    agreement = InstallmentAgreement.objects.get(account__primary_user=user)
    assert agreement.status == InstallmentAgreement.Status.CANCELLED
    assert _subscription(user).status == Subscription.Status.TRIALING


def test_installments_are_not_offered_when_the_schedule_would_outrun_the_term() -> None:
    user = _reader("too-late")
    december = datetime(2026, 12, 25, 10, 0, tzinfo=UTC)
    with at(december):
        full_year = _catalog(user)["dentistry_full_year"]["prices"][0]
        assert full_year["installments_available"] is False
        with pytest.raises(ManualPaymentError, match="installments"):
            _buy(user, "dentistry_full_year_80_lyd", installments=True)


def test_another_plan_cannot_be_bought_while_installments_are_open() -> None:
    user, _ = _installment_reader("one-at-a-time")
    with at(START + timedelta(days=2)), pytest.raises(ManualPaymentError, match="installments"):
        _buy(user, "dentistry_full_year_80_lyd", cards=3)


# --- four-month conversion --------------------------------------------------


def test_the_conversion_is_a_dry_run_until_applied() -> None:
    user = _reader("convert")
    with at(START):
        result = _buy(user, "lockin_four_months_30_lyd", cards=2)
        _review(result.payment, "approve")
    original_end = _subscription(user).current_period_ends_at
    pending_user = _reader("convert-pending")
    with at(START):
        _buy(pending_user, "lockin_four_months_30_lyd", cards=2)

    call_command("convert_four_month_subscriptions")
    assert _subscription(user).current_period_ends_at == original_end

    call_command("convert_four_month_subscriptions", "--apply")
    converted = _subscription(user)
    assert converted.plan_version.plan.code == "dentistry_pre_midterm"
    assert converted.current_period_ends_at == max(original_end, PRE_MIDTERM_ENDS_AT)
    assert converted.status == Subscription.Status.ACTIVE
    assert _has_access(user)
    # Still under review: left alone so a rejection can restore it.
    assert _subscription(pending_user).plan_version.plan.code == "lockin_four_months"

    call_command("convert_four_month_subscriptions", "--apply")
    assert converted.transitions.filter(reason_code="four_month_converted").count() == 1


# --- refund policy ----------------------------------------------------------


def _refund(payment: Payment, moment: datetime, amount: int | None = None):  # type: ignore[no-untyped-def]
    from apps.accounts.models import User
    from apps.refunds.services import request_refund

    with at(moment):
        return request_refund(
            payment_id=payment.id,
            actor=User.objects.get(username="reviewer"),
            amount_minor=amount or payment.amount_minor,
            reason="refund policy",
            idempotency_key=f"refund-{payment.id}-{moment.isoformat()}",
        )


def test_a_subscription_is_refundable_for_fifteen_days_and_not_after() -> None:
    early = _reader("refund-early")
    late = _reader("refund-late")
    with at(START):
        early_payment = _buy(early, "dentistry_pre_midterm_30_lyd").payment
        late_payment = _buy(late, "dentistry_pre_midterm_30_lyd").payment
        _review(early_payment, "approve")
        _review(late_payment, "approve")

    refund, created = _refund(early_payment, START + timedelta(days=14, hours=23))
    assert created is True
    with pytest.raises(ValueError, match="15-day refund period"):
        _refund(late_payment, START + timedelta(days=15, minutes=1))


def test_a_later_installment_does_not_reopen_the_refund_period() -> None:
    user, agreement = _installment_reader("refund-installment")
    second = _pay_next(user, agreement, START + timedelta(days=20)).payment
    with at(START + timedelta(days=20)):
        _review(second, "approve")
    with pytest.raises(ValueError, match="15-day refund period"):
        _refund(second, START + timedelta(days=21))
