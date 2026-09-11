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
