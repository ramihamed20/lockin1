from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.streaks.models import StreakActivity
from apps.streaks.services import active_policy

pytestmark = pytest.mark.django_db


def test_calendar_is_bounded_deduplicated_and_owned_independently_of_xp_pages():
    user = create_user()
    other = create_user(email="calendar-other@example.com")
    policy = active_policy()
    policy.boundary_timezone = "Africa/Tripoli"
    policy.save()
    now = datetime(2026, 10, 25, 22, 30, tzinfo=ZoneInfo("UTC"))
    today = now.astimezone(ZoneInfo(policy.boundary_timezone)).date()
    for index, (owner, day) in enumerate(
        [
            (user, today),
            (user, today),
            (user, today - timedelta(days=21)),
            (user, today - timedelta(days=22)),
            (user, today + timedelta(days=1)),
            (other, today - timedelta(days=2)),
        ]
    ):
        StreakActivity.objects.create(
            user=owner,
            policy=policy,
            source_key=f"calendar:{index}",
            activity_type="focus.deep_session",
            qualified_on=day,
            occurred_at=now,
        )
    client = APIClient()
    client.force_authenticate(user)
    with patch("apps.streaks.selectors.timezone.now", return_value=now):
        response = client.get("/api/v1/progression/streak")
    assert response.status_code == 200
    calendar = response.json()["calendar"]
    assert calendar["today"] == "2026-10-26"
    assert calendar["timezone"] == "Africa/Tripoli"
    assert calendar["start"] == "2026-10-05"
    assert calendar["end"] == "2026-11-01"
    assert calendar["qualified_days"] == ["2026-10-05", "2026-10-26"]


def test_anonymous_cannot_read_calendar():
    assert APIClient().get("/api/v1/progression/streak").status_code in (401, 403)
