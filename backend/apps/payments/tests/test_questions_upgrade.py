"""End-to-end Libyana questions-only -> same-term full-study upgrades."""

import base64
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort
from apps.education.tests.helpers import create_admin
from apps.entitlements.services import entitlement_decision
from apps.payments.manual_services import (
    ManualPaymentError,
    price_eligibilities,
    review_manual_recharge,
    submit_manual_recharge,
)
from apps.payments.models import Payment
from apps.payments.telegram import ManualPaymentTelegramMessage
from apps.product_catalog.models import Plan, Price
from apps.product_catalog.selectors import price_for_reader
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db
TRIPOLI = dt_timezone(timedelta(hours=2))
PRE_END = datetime(2027, 1, 25, 23, 59, 59, tzinfo=TRIPOLI)
YEAR_END = datetime(2027, 5, 21, 23, 59, 59, tzinfo=TRIPOLI)
PRE_DATE = datetime(2026, 11, 21, 12, 0, tzinfo=TRIPOLI)
POST_DATE = datetime(2027, 2, 3, 12, 0, tzinfo=TRIPOLI)

CASES = [
    (
        "tripoli_y2_questions_pre",
        "dentistry_pre_midterm",
        "dentistry_pre_midterm_questions_upgrade_15_lyd",
        15_000,
        30_000,
        PRE_END,
        PRE_DATE,
    ),
    (
        "tripoli_y2_questions_post",
        "dentistry_post_midterm",
        "dentistry_post_midterm_questions_upgrade_15_lyd",
        35_000,
        50_000,
        YEAR_END,
        POST_DATE,
    ),
    (
        "tripoli_y2_questions_year",
        "dentistry_full_year",
        "dentistry_full_year_questions_upgrade_30_lyd",
        50_000,
        80_000,
        YEAR_END,
        PRE_DATE,
    ),
]


@pytest.fixture(autouse=True)
def payment_settings(settings):
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""
    settings.MANUAL_PAYMENT_RATE_LIMIT = 100


def _student(email: str):
    user = create_user(email=email, username=email.split("@")[0].replace("-", "_")[:30])
    user.cohort = StudentCohort.objects.get(program__code="dentistry-tripoli", code="year-2")
    user.save(update_fields=["cohort", "updated_at"])
    create_trial_for_user(user=user, source_reference="upgrade-test")
    return user


def _client(user):
    result = APIClient()
    result.force_authenticate(user)
    return result


def _catalog_price(user, plan_code: str) -> dict:
    catalog = _client(user).get("/api/v1/catalog/products")
    assert catalog.status_code == 200
    prices = [
        price
        for product in catalog.json()["results"]
        for plan in product["plans"]
        if plan["code"] == plan_code and plan["current_version"]
        for price in plan["current_version"]["prices"]
    ]
    assert len(prices) == 1, prices
    return prices[0]


def _pay_questions(user, plan_code: str, label: str):
    price = Price.objects.select_related("plan_version").get(
        plan_version__plan__code=plan_code, status=Price.Status.ACTIVE
    )
    result = submit_manual_recharge(
        user=user,
        price=price,
        recharge_codes=["1234567890123"],
        idempotency_key=f"questions-source-{label}-00001",
    )
    review_manual_recharge(
        payment_id=result.payment.id,
        actor=create_admin(email=f"review-{label}@example.com"),
        decision="approve",
        reason="Verified questions-only recharge",
        idempotency_key=f"questions-source-review-{label}-00001",
    )
    return result.payment


@pytest.mark.parametrize(
    ("source", "target", "upgrade_code", "previous", "full", "end", "moment"), CASES
)
def test_upgrade_charges_only_the_difference_and_unlocks_sheets_after_review(
    source, target, upgrade_code, previous, full, end, moment
):
    with patch("django.utils.timezone.now", return_value=moment):
        user = _student(f"upgrade-{source}@example.com")
        assert _catalog_price(user, target)["amount_minor"] == full
        _pay_questions(user, source, source)
        client = _client(user)
        before = Subscription.objects.get(account__primary_user=user)
        original_start = before.current_period_started_at
        assert before.current_period_ends_at == end
        assert entitlement_decision(user=user, entitlement_code="questions.access").allowed
        assert not entitlement_decision(user=user, entitlement_code="content.premium").allowed

        quote = _catalog_price(user, target)
        assert quote["code"] == upgrade_code
        assert quote["amount_minor"] == full - previous
        assert quote["upgrade_offer"] == {
            "already_paid_minor": previous,
            "full_price_minor": full,
        }
        key = f"upgrade-checkout-{source}-00001"
        payment_response = client.post(
            "/api/v1/payments/manual-libyana",
            {
                "plan_id": str(Plan.objects.get(code=target).id),
                "recharge_codes": ["2345678901234"],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        assert payment_response.status_code == 201, payment_response.data
        payment_id = payment_response.json()["payment"]["id"]
        assert payment_response.json()["payment"]["amount_minor"] == full - previous
        pending = Subscription.objects.get(account__primary_user=user)
        assert pending.current_period_ends_at == end
        assert pending.current_period_started_at == original_start
        assert not entitlement_decision(user=user, entitlement_code="content.premium").allowed
        assert entitlement_decision(user=user, entitlement_code="questions.access").allowed

        # A retry remains the SAME payment, even after the provisional switch
        # has removed the upgrade price from new checkout quotes.
        replay = client.post(
            "/api/v1/payments/manual-libyana",
            {
                "plan_id": str(Plan.objects.get(code=target).id),
                "recharge_codes": ["2345678901234"],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )
        assert replay.status_code == 200, replay.data
        assert replay.json()["payment"]["id"] == payment_id

        review_manual_recharge(
            payment_id=payment_id,
            actor=create_admin(email=f"upgrade-review-{source}@example.com"),
            decision="approve",
            reason="Verified upgrade payment",
            idempotency_key=f"upgrade-review-{source}-00001",
        )
        updated = Subscription.objects.get(account__primary_user=user)
        assert updated.plan_version.plan.code == target
        assert updated.current_period_started_at == original_start
        assert updated.current_period_ends_at == end
        assert entitlement_decision(user=user, entitlement_code="content.premium").allowed
        assert entitlement_decision(user=user, entitlement_code="focus.workspace").allowed
        assert Payment.objects.get(id=payment_id).status == Payment.Status.SUCCEEDED
        # The original payment and one difference payment: no second full charge.
        amounts = list(
            Payment.objects.filter(
                subscription=updated, status=Payment.Status.SUCCEEDED
            ).values_list("amount_minor", flat=True)
        )
        assert sorted(amounts) == sorted([previous, full - previous])


def test_rejected_upgrade_retains_paid_questions_and_allows_a_new_attempt():
    with patch("django.utils.timezone.now", return_value=PRE_DATE):
        user = _student("questions-upgrade-rejected@example.com")
        _pay_questions(user, "tripoli_y2_questions_pre", "rejected")
        before = Subscription.objects.get(account__primary_user=user)
        price = Price.objects.get(code="dentistry_pre_midterm_questions_upgrade_15_lyd")
        upgrade = submit_manual_recharge(
            user=user,
            price=price,
            recharge_codes=["3456789012345"],
            idempotency_key="upgrade-will-be-rejected-00001",
        )
        review_manual_recharge(
            payment_id=upgrade.payment.id,
            actor=create_admin(email="review-upgrade-rejected@example.com"),
            decision="reject",
            reason="Invalid recharge card",
            idempotency_key="upgrade-reject-decision-00001",
        )
        restored = Subscription.objects.get(account__primary_user=user)
        assert restored.plan_version_id == before.plan_version_id
        assert restored.current_period_ends_at == before.current_period_ends_at
        assert entitlement_decision(user=user, entitlement_code="questions.access").allowed
        assert not entitlement_decision(user=user, entitlement_code="content.premium").allowed
        assert _catalog_price(user, "dentistry_pre_midterm")["amount_minor"] == 15_000


def test_discount_requires_current_verified_fully_paid_questions_subscription():
    with patch("django.utils.timezone.now", return_value=PRE_DATE):
        user = _student("questions-upgrade-not-paid@example.com")
        price = Price.objects.get(code="dentistry_pre_midterm_questions_upgrade_15_lyd")
        assert price.eligibility not in price_eligibilities(user=user)
        with pytest.raises(ManualPaymentError, match="not available"):
            submit_manual_recharge(
                user=user,
                price=price,
                recharge_codes=["4567890123456"],
                idempotency_key="upgrade-no-source-payment-00001",
            )
        _pay_questions(user, "tripoli_y2_questions_pre", "qualifying")
        subscription = Subscription.objects.get(account__primary_user=user)
        subscription.payment_verification = Subscription.PaymentVerification.PROVISIONAL
        subscription.save(update_fields=["payment_verification"])
        assert price.eligibility not in price_eligibilities(user=user)
        subscription.payment_verification = Subscription.PaymentVerification.VERIFIED
        subscription.save(update_fields=["payment_verification"])
        source_payment = Payment.objects.get(
            subscription=subscription,
            price__plan_version_id=subscription.plan_version_id,
            status=Payment.Status.SUCCEEDED,
        )
        source_payment.refunded_amount_minor = source_payment.amount_minor
        source_payment.save(update_fields=["refunded_amount_minor"])
        assert price.eligibility not in price_eligibilities(user=user)


def test_questions_upgrade_price_is_not_hidden_by_old_four_month_discount():
    # The old 20 LYD full-year discount is intended for a different purchase
    # and cannot replace the 30 LYD feature-only upgrade of an existing year.
    upgrade = Price.objects.get(code="dentistry_full_year_questions_upgrade_30_lyd")
    legacy = Price.objects.get(code="dentistry_full_year_upgrade_20_lyd")
    standard = Price.objects.get(code="dentistry_full_year_80_lyd")
    chosen = price_for_reader(
        prices=[standard, legacy, upgrade],
        eligibilities=frozenset({legacy.eligibility, upgrade.eligibility}),
    )
    assert chosen is not None
    assert chosen.code == upgrade.code


def test_telegram_labels_upgrade_as_upgrade_not_renewal(
    django_capture_on_commit_callbacks,
):
    with patch("django.utils.timezone.now", return_value=PRE_DATE):
        user = _student("upgrade-telegram-label@example.com")
        _pay_questions(user, "tripoli_y2_questions_pre", "telegram")
        price = Price.objects.get(code="dentistry_pre_midterm_questions_upgrade_15_lyd")
        with patch("apps.payments.manual_services.notify_manual_payment") as notify:
            with django_capture_on_commit_callbacks(execute=True):
                submit_manual_recharge(
                    user=user,
                    price=price,
                    recharge_codes=["5678901234567"],
                    idempotency_key="upgrade-telegram-notice-00001",
                )
        message = notify.call_args.args[0]
        assert message.event == ManualPaymentTelegramMessage.Event.UPGRADE
        assert "ترقية" in message.render()
        assert message.amount == "15 LYD"
