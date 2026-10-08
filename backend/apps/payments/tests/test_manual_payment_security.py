from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from threading import Barrier, BrokenBarrierError
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.db import close_old_connections
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.product_catalog.models import Price


def _submit(user, address="198.51.100.1"):
    client = APIClient()
    client.force_authenticate(user)
    return client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(uuid4()), "recharge_codes": ["1234567890123"]},
        format="json",
        REMOTE_ADDR=address,
    ).status_code


@pytest.mark.django_db
def test_manual_payment_budget_follows_the_account_across_source_addresses(settings) -> None:
    settings.MANUAL_PAYMENT_RATE_LIMIT = 2
    user = create_user()
    assert [_submit(user, f"198.51.100.{n}") for n in range(1, 4)] == [400, 400, 429]


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_parallel_manual_submissions_cannot_both_take_the_last_budget_slot(settings) -> None:
    settings.MANUAL_PAYMENT_RATE_LIMIT = 1
    user = create_user()
    after_budget = Barrier(2)

    def missing_price(*args, **kwargs):
        with suppress(BrokenBarrierError):
            after_budget.wait(timeout=1)
        raise Price.DoesNotExist

    def submit(_):
        close_old_connections()
        try:
            return _submit(user)
        finally:
            close_old_connections()

    with (
        patch("apps.payments.views.active_libyana_price_for_plan", side_effect=missing_price),
        ThreadPoolExecutor(max_workers=2) as pool,
    ):
        assert sorted(pool.map(submit, range(2))) == [400, 429]
