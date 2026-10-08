from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.admin_control.selectors import admin_purchases, serialize_purchase
from apps.payments.models import ManualRechargeCode, ManualRechargeSubmission, Payment
from apps.product_catalog.models import Price
from apps.subscriptions.services import create_trial_for_user

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("legacy_duration_prices")]


def _payment(index: int, digests: tuple[str, ...], *, legacy: bool = False) -> Payment:
    user = create_user(email=f"purchase-budget-{index}@example.com")
    subscription, _ = create_trial_for_user(user=user, source_reference="query-budget")
    price = Price.objects.get(plan_version__plan__code="lockin_monthly", status="active")
    now = timezone.now()
    payment = Payment.objects.create(
        account=subscription.account,
        subscription=subscription,
        price=price,
        amount_minor=price.amount_minor,
        currency=price.currency,
        method=Payment.Method.LIBYANA,
        idempotency_key=f"purchase-budget-{index}",
        price_snapshot={},
        initiated_at=now,
    )
    manual = ManualRechargeSubmission.objects.create(
        payment=payment,
        user=user,
        recharge_code_ciphertext="synthetic-unused-ciphertext",
        recharge_code_digest=digests[0],
        recharge_code_last4="1234",
        subscription_period_started_at=now,
        subscription_period_ends_at=now + timedelta(days=30),
    )
    if not legacy:
        ManualRechargeCode.objects.bulk_create(
            [
                ManualRechargeCode(
                    submission=manual,
                    position=position,
                    digest=digest,
                    ciphertext="synthetic-unused-ciphertext",
                    last4="1234",
                )
                for position, digest in enumerate(digests, start=1)
            ]
        )
    return payment


def test_purchase_list_queries_do_not_grow_per_manual_submission() -> None:
    admin = create_user(email="purchase-budget-admin@example.com", is_superuser=True)
    client = APIClient()
    client.force_authenticate(admin)
    _payment(0, ("shared-a", "shared-b"))
    with CaptureQueriesContext(connection) as first:
        response = client.get("/api/v1/operations/admin/purchases")
    assert response.status_code == 200
    for index in range(1, 6):
        _payment(index, ("shared-a", "shared-b"))
    with CaptureQueriesContext(connection) as many:
        response = client.get("/api/v1/operations/admin/purchases")
    assert response.status_code == 200
    assert response.json()["count"] == 6
    assert all(
        row["manual_submission"]["repeat_submission_count"] == 5
        for row in response.json()["results"]
    )
    assert len(many) == len(first), (len(first), len(many))


def test_purchase_batch_matches_detail_for_overlapping_cards_and_legacy_rows() -> None:
    _payment(0, ("shared-a", "shared-b"))
    _payment(1, ("shared-a", "shared-b"))
    _payment(2, ("shared-a",))
    _payment(3, ("unique",))
    _payment(4, ("shared-b",), legacy=True)
    admin = create_user(email="purchase-parity-admin@example.com", is_superuser=True)
    client = APIClient()
    client.force_authenticate(admin)
    # Preserve the existing definition: legacy target rows use their digest,
    # but historical matches come from ManualRechargeCode, not legacy mirrors.
    expected = {str(item.id): serialize_purchase(item) for item in admin_purchases()}
    response = client.get("/api/v1/operations/admin/purchases")
    assert response.status_code == 200
    actual = {item["id"]: item for item in response.json()["results"]}
    for payment_id, payload in expected.items():
        assert (
            actual[payment_id]["manual_submission"]["repeat_submission_count"]
            == (payload["manual_submission"]["repeat_submission_count"])
        )
