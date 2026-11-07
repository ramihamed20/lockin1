from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.xp.models import XpTransaction

pytestmark = pytest.mark.django_db


def award(user, key, occurred_at):
    return XpTransaction.objects.create(
        user=user,
        source_key=key,
        source_event_name="question.answered",
        rule_code="test",
        points=5,
        category="learning",
        reason=key,
        occurred_at=occurred_at,
    )


def test_period_is_filtered_before_pagination_with_local_midnight_and_no_gaps():
    user = create_user()
    other = create_user(email="ledger-other@example.com")
    now = datetime(2026, 10, 25, 20, tzinfo=ZoneInfo("UTC"))
    start = datetime(2026, 10, 18, 22, tzinfo=ZoneInfo("UTC"))
    expected = {str(award(user, f"week:{i}", start + timedelta(hours=i)).id) for i in range(7)}
    award(user, "before-boundary", start - timedelta(seconds=1))
    award(other, "other", now)
    award(user, "future-day", now + timedelta(days=1))
    client = APIClient()
    client.force_authenticate(user)
    with patch("apps.xp.views.timezone.now", return_value=now):
        first = client.get(
            "/api/v1/progression/xp/ledger?period=week&timezone=Africa/Tripoli&page_size=5"
        ).json()
        second = client.get(first["next"]).json()
    assert first["count"] == 7 and len(first["results"]) == 5
    assert len(second["results"]) == 2 and second["next"] is None
    assert {row["id"] for row in first["results"] + second["results"]} == expected


def test_empty_period_stays_empty_and_invalid_filters_are_rejected():
    user = create_user()
    award(user, "old", datetime(2020, 1, 1, tzinfo=ZoneInfo("UTC")))
    client = APIClient()
    client.force_authenticate(user)
    assert client.get("/api/v1/progression/xp/ledger?period=week").json()["results"] == []
    assert client.get("/api/v1/progression/xp/ledger").json()["count"] == 1
    assert client.get("/api/v1/progression/xp/ledger?period=invalid").status_code == 400
    assert client.get("/api/v1/progression/xp/ledger?timezone=bad/zone").status_code == 400
