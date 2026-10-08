import pytest
from django.db import connection


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip ``@pytest.mark.postgres`` tests on any other database.

    The SQLite convenience run (LOCKIN_TEST_USE_SQLITE) silently drops
    select_for_update() and serialises writers, so row-locking and concurrency
    tests fail there for reasons that say nothing about the code. PostgreSQL CI
    remains the authority for them; see config/settings/test.py.
    """
    del config
    if connection.vendor == "postgresql":
        return
    skip = pytest.mark.skip(reason="requires PostgreSQL row locking")
    for item in items:
        if "postgres" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def legacy_duration_prices() -> None:
    """Sell the retired duration plans again, for tests of that path.

    ``product_catalog.0007`` archived them in favour of the dentistry term plans
    and dated the 5 LYD offer. Subscriptions bought on them still renew, roll
    back and get reviewed through the same code, so their tests keep running
    against the prices they were written for, independent of today's date.
    """
    from apps.product_catalog.models import Price

    Price.objects.filter(
        code__in=(
            "lockin_monthly_10_lyd",
            "lockin_first_month_5_lyd",
            "lockin_two_months_20_lyd",
            "lockin_three_months_25_lyd",
            "lockin_four_months_30_lyd",
        )
    ).update(status=Price.Status.ACTIVE, valid_until=None)
