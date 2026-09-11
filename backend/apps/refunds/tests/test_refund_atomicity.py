"""A refused provider request must leave no reservation behind.

``request_refund`` is atomic on its own, so calling it and then asking the
provider committed the Refund row before the provider had answered. With
``PAYMENT_PROVIDER=none`` -- which production settings enforce -- the provider
always refuses, so every attempt returned 400 while leaving a REQUESTED row.

Those rows are not inert. ``request_refund`` sums REQUESTED, PENDING and
SUCCEEDED refunds into ``reserved`` and rejects anything above the remainder, so
each failed attempt permanently shrank the payment's refundable balance.
"""

from typing import Any

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.commerce_integrations.tests.test_phase8_domains import _settled_payment
from apps.payments.models import Payment
from apps.refunds.models import Refund

pytestmark = pytest.mark.django_db


def _admin_client() -> APIClient:
    admin = create_user(email="refund-admin@example.com", is_superuser=True, is_staff=True)
    client = APIClient()
    client.force_authenticate(admin)
    return client


def _request_refund(client: APIClient, payment: Payment, *, key: str) -> Any:
    return client.post(
        "/api/v1/admin/refunds",
        {
            "payment_id": str(payment.id),
            "amount_minor": payment.amount_minor,
            "reason": "Duplicate charge confirmed by support",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def test_a_refused_provider_leaves_no_refund_row(
    django_capture_on_commit_callbacks: Any,
) -> None:
    student = create_user()
    student_client = APIClient()
    student_client.force_authenticate(student)
    # The payment is settled under the test provider; only the refund is asked
    # of the disabled provider, which is the production shape.
    payment, _ = _settled_payment(
        client=student_client,
        django_capture_on_commit_callbacks=django_capture_on_commit_callbacks,
    )

    with override_settings(PAYMENT_PROVIDER="none"):
        response = _request_refund(_admin_client(), payment, key="refund-none-0001")

    assert response.status_code == 400
    # The provider's own words reach the operator rather than a generic failure.
    assert "no payment provider is configured" in str(response.json()["error"])
    assert not Refund.objects.filter(payment=payment).exists()


def test_repeated_failures_do_not_consume_the_refundable_balance(
    django_capture_on_commit_callbacks: Any,
) -> None:
    """The regression this fix exists for.

    Three refused attempts used to reserve three times the payment amount, after
    which the payment could never be refunded again -- not even once a provider
    was configured.
    """

    student = create_user(email="balance-student@example.com")
    student_client = APIClient()
    student_client.force_authenticate(student)
    payment, _ = _settled_payment(
        client=student_client,
        django_capture_on_commit_callbacks=django_capture_on_commit_callbacks,
    )
    client = _admin_client()

    with override_settings(PAYMENT_PROVIDER="none"):
        for attempt in range(3):
            refused = _request_refund(client, payment, key=f"refund-none-{attempt:04d}")
            assert refused.status_code == 400

    assert not Refund.objects.filter(payment=payment).exists()
    reserved = Refund.objects.filter(
        payment=payment,
        status__in=(Refund.Status.REQUESTED, Refund.Status.PENDING, Refund.Status.SUCCEEDED),
    ).count()
    assert reserved == 0

    # With a provider available again the full amount is still refundable.
    accepted = _request_refund(client, payment, key="refund-fake-0001")
    assert accepted.status_code == 201
    assert accepted.json()["amount_minor"] == payment.amount_minor


def test_replaying_one_idempotency_key_does_not_ask_the_provider_twice(
    django_capture_on_commit_callbacks: Any,
) -> None:
    student = create_user(email="idempotent-student@example.com")
    student_client = APIClient()
    student_client.force_authenticate(student)
    payment, _ = _settled_payment(
        client=student_client,
        django_capture_on_commit_callbacks=django_capture_on_commit_callbacks,
    )
    client = _admin_client()

    first = _request_refund(client, payment, key="refund-replay-0001")
    second = _request_refund(client, payment, key="refund-replay-0001")

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert Refund.objects.filter(payment=payment).count() == 1
