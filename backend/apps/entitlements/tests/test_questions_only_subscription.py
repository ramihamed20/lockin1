"""Question-only plans must never unlock PDFs or survive a rejected payment."""
import base64
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort
from apps.entitlements.services import entitlement_decision, sync_subscription_entitlements
from apps.payments.models import Payment
from apps.product_catalog.models import Plan, Price
from apps.product_catalog.selectors import plan_version_available_to_user
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db

TRIPOLI = dt_timezone(timedelta(hours=2))
YEAR_END = datetime(2027, 5, 21, 23, 59, 59, tzinfo=TRIPOLI)
PLANS = {
    "tripoli_y2_questions_pre": 15_000,
    "tripoli_y2_questions_post": 35_000,
    "tripoli_y2_questions_year": 50_000,
}


@pytest.fixture(autouse=True)
def payment_settings(settings):
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""


def _student(*, email, cohort_code="year-2"):
    user = create_user(email=email, username=email.split("@")[0].replace("-", "_")[:30])
    user.cohort = StudentCohort.objects.get(
        program__code="dentistry-tripoli", code=cohort_code
    )
    user.save(update_fields=["cohort", "updated_at"])
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def _paid_subscription(user, code):
    subscription, _ = create_trial_for_user(user=user, source_reference="test")
    plan = Plan.objects.select_related("current_version").get(code=code)
    subscription.plan_version = plan.current_version
    subscription.status = Subscription.Status.ACTIVE
    subscription.current_period_started_at = timezone.now()
    subscription.current_period_ends_at = YEAR_END
    subscription.grace_ends_at = YEAR_END
    subscription.save()
    sync_subscription_entitlements(subscription_id=subscription.id)
    return subscription


def _expired_subscription(user):
    subscription, _ = create_trial_for_user(user=user, source_reference="test")
    now = timezone.now()
    subscription.status = Subscription.Status.EXPIRED
    subscription.trial_started_at = None
    subscription.trial_ends_at = None
    subscription.current_period_started_at = now - timedelta(days=32)
    subscription.current_period_ends_at = now - timedelta(days=1)
    subscription.ended_at = now - timedelta(days=1)
    subscription.save()
    sync_subscription_entitlements(subscription_id=subscription.id)
    return subscription


def _manual_payment(client, code="tripoli_y2_questions_pre", key="question-plan-payment-0001"):
    plan = Plan.objects.get(code=code)
    return client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(plan.id), "recharge_codes": ["1234567890123"]},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def _review(payment_id, decision, key):
    admin = create_user(
        email=f"questions-review-{decision}@example.com",
        username=f"question_review_{decision}",
        is_staff=True,
        is_superuser=True,
    )
    return _client(admin).post(
        f"/api/v1/operations/admin/purchases/{payment_id}/manual-review",
        {"decision": decision, "reason": "Verified recharge card review"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_question_only_prices_and_scoped_access_rules():
    year2 = _student(email="questions-plan-year2@example.com")
    year1 = _student(email="questions-plan-year1@example.com", cohort_code="year-1")
    for plan_code, price_minor in PLANS.items():
        plan = Plan.objects.select_related("current_version").get(code=plan_code)
        price = Price.objects.get(plan_version=plan.current_version, status="active")
        assert price.amount_minor == price_minor
        assert price.currency == "LYD"
        assert plan_version_available_to_user(version=plan.current_version, user=year2)
        assert not plan_version_available_to_user(version=plan.current_version, user=year1)
        granted = set(plan.current_version.entitlement_rules.values_list("entitlement__code", flat=True))
        assert granted == {"questions.access"}
        assert plan.current_version.terms["questions_only"] is True
    assert Price.objects.get(code="tripoli_y2_questions_post_35_lyd").valid_from == datetime(
        2027, 1, 26, tzinfo=TRIPOLI
    )


def test_questions_plan_unblocks_questions_but_not_pdf_or_workspace():
    user = _student(email="questions-access@example.com")
    subscription = _paid_subscription(user, "tripoli_y2_questions_year")
    client = _client(user)
    assert entitlement_decision(user=user, entitlement_code="questions.access").allowed
    assert not entitlement_decision(user=user, entitlement_code="content.premium").allowed
    assert not entitlement_decision(user=user, entitlement_code="focus.workspace").allowed
    assert client.get("/api/v1/subscriptions/current").json()["subscription"]["access_allowed"]
    for url in (
        "/api/v1/catalog/questions",
        "/api/v1/catalog/questions?source=lab",
        "/api/v1/catalog/questions/mix",
        "/api/v1/review-bank",
        "/api/v1/quizzes",
    ):
        assert client.get(url).status_code == 200, url
    for url in (
        "/api/v1/catalog/materials",
        "/api/v1/catalog/workspaces/recent",
    ):
        assert client.get(url).status_code == 403, url
    # Unknown managed files may 404 before per-object permission is evaluated;
    # either is a denial, never a download.
    assert client.get(
        "/api/v1/files/00000000-0000-0000-0000-000000000001/view"
    ).status_code in (403, 404)

    subscription.status = Subscription.Status.EXPIRED
    subscription.current_period_ends_at = timezone.now() - timedelta(seconds=1)
    subscription.save()
    sync_subscription_entitlements(subscription_id=subscription.id)
    assert client.get("/api/v1/catalog/questions").status_code == 403
    assert client.get("/api/v1/review-bank").status_code == 403


def test_other_cohort_cannot_buy_questions_plan():
    user = _student(email="wrong-cohort-questions@example.com", cohort_code="year-1")
    _expired_subscription(user)
    response = _manual_payment(_client(user), key="questions-wrong-cohort-0001")
    assert response.status_code == 400


def test_rejected_question_plan_revokes_provisional_access():
    user = _student(email="rejected-questions@example.com")
    _expired_subscription(user)
    client = _client(user)
    payment = _manual_payment(client, key="questions-reject-submission-0001")
    assert payment.status_code == 201, payment.data
    payment_id = payment.json()["payment"]["id"]
    rejected = _review(payment_id, "reject", "questions-reject-decision-0001")
    assert rejected.status_code == 200, rejected.data
    assert Payment.objects.get(id=payment_id).status == Payment.Status.FAILED
    assert not entitlement_decision(user=user, entitlement_code="questions.access").allowed
    assert client.get("/api/v1/catalog/questions").status_code == 403
    assert client.get("/api/v1/review-bank").status_code == 403


def test_approved_question_plan_works_and_standard_paid_plan_remains_full():
    user = _student(email="approved-questions@example.com")
    _expired_subscription(user)
    client = _client(user)
    payment = _manual_payment(client, key="questions-approve-submission-0001")
    assert payment.status_code == 201, payment.data
    approved = _review(
        payment.json()["payment"]["id"], "approve", "questions-approve-decision-0001"
    )
    assert approved.status_code == 200, approved.data
    assert client.get("/api/v1/catalog/questions").status_code == 200
    assert client.get("/api/v1/review-bank").status_code == 200
    assert client.get("/api/v1/catalog/materials").status_code == 403

    full = _student(email="standard-full-paid@example.com")
    _paid_subscription(full, "dentistry_full_year")
    full_client = _client(full)
    assert full_client.get("/api/v1/catalog/questions").status_code == 200
    assert full_client.get("/api/v1/catalog/materials").status_code == 200
    assert full_client.get("/api/v1/review-bank").status_code == 200
