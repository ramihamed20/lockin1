from datetime import datetime, time, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.notifications.models import (
    Notification,
    NotificationPreference,
    PushDelivery,
    StudyReminder,
)
from apps.notifications.push import dispatch_push
from apps.notifications.reminders import dispatch_study_reminders, next_due

from .test_push import payload, tracked_client

pytestmark = pytest.mark.django_db
URL = "/api/v1/notifications/study-reminder"


def config(**changes):
    return {
        "enabled": True,
        "time": "18:00",
        "timezone": "Africa/Tripoli",
        "locale": "ar",
        "expected_revision": 0,
        **changes,
    }


def test_reminder_is_opt_in_account_owned_and_revision_checked():
    user = create_user()
    other = create_user(email="reminder-other@example.com")
    client = APIClient()
    assert client.get(URL).status_code in (401, 403)
    client.force_authenticate(user)
    assert client.get(URL).json()["enabled"] is False
    assert not StudyReminder.objects.exists()
    saved = client.put(URL, config(), format="json")
    assert saved.status_code == 200 and saved.json()["revision"] == 1
    assert client.put(URL, config(time="19:00"), format="json").status_code == 409
    assert (
        client.put(URL, config(timezone="bad/zone", expected_revision=1), format="json").status_code
        == 400
    )
    assert (
        client.put(URL, config(time="25:00", expected_revision=1), format="json").status_code == 400
    )
    client.force_authenticate(other)
    assert client.get(URL).json()["revision"] == 0
    assert StudyReminder.objects.get(user=user).time == time(18)


def test_scheduler_queues_once_without_a_browser_and_disabling_cancels_push():
    user = create_user()
    client = tracked_client(user)
    with (
        patch("apps.notifications.push.configured", return_value=True),
        patch("apps.notifications.push_views.configured", return_value=True),
    ):
        assert (
            client.post("/api/v1/notifications/push", payload(user), format="json").status_code
            == 201
        )
        assert client.put(URL, config(), format="json").status_code == 200
        now = datetime(2026, 10, 26, 16, 1, tzinfo=ZoneInfo("UTC"))
        StudyReminder.objects.filter(user=user).update(next_due_at=now - timedelta(minutes=1))
        with patch("apps.notifications.reminders.timezone.now", return_value=now):
            assert dispatch_study_reminders()["created"] == 1
            assert dispatch_study_reminders()["created"] == 0
        notice = Notification.objects.get(recipient=user, template_key="study.reminder")
        assert notice.title == "حان وقت الدراسة" and notice.target_route == "/dashboard"
        assert PushDelivery.objects.filter(notification=notice, status="pending").count() == 1
        assert (
            client.put(URL, config(enabled=False, expected_revision=1), format="json").status_code
            == 200
        )
        assert PushDelivery.objects.get(notification=notice).status == "cancelled"
        with patch("apps.notifications.push.webpush") as sender:
            dispatch_push()
            sender.assert_not_called()


def test_late_jobs_skip_old_reminders_and_respect_category_preferences():
    user = create_user()
    now = datetime(2026, 10, 26, 16, tzinfo=ZoneInfo("UTC"))
    reminder = StudyReminder.objects.create(
        user=user, enabled=True, next_due_at=now - timedelta(days=1)
    )
    with patch("apps.notifications.reminders.timezone.now", return_value=now):
        assert dispatch_study_reminders()["skipped"] == 1
        assert not Notification.objects.filter(recipient=user).exists()
        NotificationPreference.objects.create(
            user=user, category="learning", channel="in_app", enabled=False
        )
        reminder.next_due_at = now - timedelta(minutes=1)
        reminder.save()
        assert dispatch_study_reminders()["created"] == 0
    reminder.refresh_from_db()
    assert reminder.next_due_at > now


def test_schedule_uses_local_days_across_dst_without_fixed_24_hour_drift():
    zone = ZoneInfo("Europe/Berlin")
    now = datetime(2026, 10, 24, 18, 30, tzinfo=zone)
    due = next_due(now, time(18), "Europe/Berlin").astimezone(zone)
    assert due.isoformat() == "2026-10-25T18:00:00+01:00"


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_schedulers_skip_the_locked_reminder():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections
    from django.utils import timezone

    from apps.notifications.services import create_notification

    user = create_user()
    StudyReminder.objects.create(
        user=user, enabled=True, next_due_at=timezone.now() - timedelta(minutes=1)
    )
    entered, release = Event(), Event()

    def create_while_locked(**kwargs):
        entered.set()
        assert release.wait(timeout=10)
        return create_notification(**kwargs)

    def dispatch():
        close_old_connections()
        try:
            return dispatch_study_reminders(limit=1)
        finally:
            close_old_connections()

    with patch(
        "apps.notifications.reminders.create_notification", side_effect=create_while_locked
    ), ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(dispatch)
        assert entered.wait(timeout=10)
        try:
            assert pool.submit(dispatch).result(timeout=10)["created"] == 0
        finally:
            release.set()
        assert first.result(timeout=10)["created"] == 1
    assert Notification.objects.filter(recipient=user, template_key="study.reminder").count() == 1


def test_students_can_change_only_their_own_optional_notification_preferences():
    user = create_user()
    other = create_user(email="preference-other@example.com")
    client = APIClient()
    client.force_authenticate(user)
    url = "/api/v1/notifications/preferences"
    assert client.get(url).status_code == 200
    assert (
        client.put(
            url, [{"category": "learning", "channel": "push", "enabled": False}], format="json"
        ).status_code
        == 200
    )
    assert not NotificationPreference.objects.filter(user=other).exists()
    assert (
        client.put(
            url, [{"category": "account", "channel": "push", "enabled": False}], format="json"
        ).status_code
        == 400
    )
