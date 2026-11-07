import json
from datetime import datetime, time, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.notifications.delivery_policy import quiet_until
from apps.notifications.models import Notification, PushDelivery, StudyReminder
from apps.notifications.push import dispatch_push
from apps.notifications.reminders import dispatch_study_reminders, next_due
from apps.review.models import ReviewItem
from apps.streaks.activity_selectors import recent_study_days
from apps.streaks.models import StreakActivity
from apps.streaks.services import active_policy

from .test_push import (
    enroll,
    keys,  # noqa: F401 - shared autouse Web Push key fixture
    notice,
)
from .test_reminders import URL, config

pytestmark = pytest.mark.django_db
NOW = datetime(2026, 10, 26, 16, 1, tzinfo=ZoneInfo("UTC"))


def scheduled(user, **changes):
    return StudyReminder.objects.create(
        user=user, enabled=True, next_due_at=NOW - timedelta(minutes=1), **changes
    )


def mistake(user, **changes):
    return ReviewItem.objects.create(
        user=user,
        canonical_key=f"question:{ReviewItem.objects.count()}",
        subject_key="histology",
        subject_label_snapshot="Histology",
        source_type="practice",
        prompt_snapshot="Private prompt",
        options_snapshot=[{"id": "a", "text": "Private answer"}],
        correct_option_ids_snapshot=["a"],
        first_mistake_at=NOW,
        last_mistake_at=NOW,
        next_review_at=NOW - timedelta(days=1),
        **changes,
    )


def run():
    with patch("apps.notifications.reminders.timezone.now", return_value=NOW):
        return dispatch_study_reminders()


def test_new_choices_are_opt_in_and_old_clients_preserve_them():
    client = APIClient()
    client.force_authenticate(create_user())
    defaults = client.get(URL).json()
    assert defaults["study_enabled"] and not defaults["review_enabled"]
    assert defaults["weekdays"] == list(range(7)) and not defaults["quiet_enabled"]
    saved = client.put(
        URL, config(review_enabled=True, weekly_enabled=True, weekdays=[4, 0]), format="json"
    )
    assert saved.status_code == 200 and saved.json()["weekdays"] == [0, 4]
    saved = client.put(URL, config(expected_revision=1), format="json")
    assert saved.json()["review_enabled"] and saved.json()["weekly_enabled"]
    assert saved.json()["weekdays"] == [0, 4]


@pytest.mark.parametrize(
    "changes",
    [
        {"weekdays": []},
        {"weekdays": [0, 0]},
        {"weekdays": [7]},
        {"weekly_day": 7},
        {"study_enabled": False},
        {"quiet_enabled": True, "quiet_start": "08:00", "quiet_end": "08:00"},
        {"quiet_enabled": True, "time": "23:30"},
        {"pause_hours": 999},
        {"paused_until": "2099-01-01"},
    ],
)
def test_invalid_schedules_are_rejected_without_creating_settings(changes):
    client = APIClient()
    client.force_authenticate(create_user())
    assert client.put(URL, config(**changes), format="json").status_code == 400
    assert not StudyReminder.objects.exists()


def test_selected_days_and_weekly_only_schedule_use_local_calendar():
    assert next_due(NOW, time(18), "Africa/Tripoli", [4]).isoformat() == "2026-10-30T16:00:00+00:00"
    client = APIClient()
    client.force_authenticate(create_user())
    with patch("apps.notifications.reminders.timezone.now", return_value=NOW):
        response = client.put(
            URL, config(study_enabled=False, weekly_enabled=True, weekly_day=6), format="json"
        )
    assert response.json()["next_due_at"] == "2026-11-01T16:00:00+00:00"


def test_due_review_alert_is_owned_and_uses_only_ready_usable_items():
    user = create_user()
    other = create_user(email="other-briefing@example.test")
    scheduled(user, review_enabled=True)
    mistake(user)
    mistake(user, state=ReviewItem.State.HIDDEN)
    future = mistake(user)
    future.next_review_at = NOW + timedelta(days=1)
    future.save()
    unusable = mistake(user)
    unusable.options_snapshot = []
    unusable.save()
    mistake(other)
    assert run()["created"] == 1
    notification = Notification.objects.get(recipient=user)
    assert notification.template_key == "study.review" and notification.target_route == "/review"
    assert "1" in notification.body and "Private" not in notification.body
    StudyReminder.objects.filter(user=user).update(next_due_at=NOW, review_enabled=False)
    assert run()["created"] == 0
    assert Notification.objects.count() == 1


def test_review_only_is_silent_without_questions_and_off_days_are_silent():
    user = create_user()
    reminder = scheduled(user, study_enabled=False, review_enabled=True)
    assert run()["created"] == 0
    mistake(user)
    reminder.weekdays, reminder.next_due_at = [4], NOW
    reminder.save()
    assert run()["created"] == 0
    reminder.refresh_from_db()
    assert reminder.next_due_at.weekday() == 4


def test_activity_dates_are_deduplicated_in_the_chosen_timezone_and_skip_study_only():
    user = create_user()
    other = create_user(email="other-activity@example.test")
    policy = active_policy()
    for index, (owner, at) in enumerate(
        [
            (user, NOW - timedelta(hours=17, minutes=31)),
            (user, NOW - timedelta(hours=1)),
            (user, NOW - timedelta(days=7)),
            (other, NOW - timedelta(days=1)),
            (user, NOW + timedelta(hours=1)),
        ]
    ):
        StreakActivity.objects.create(
            user=owner,
            policy=policy,
            source_key=f"briefing:{index}",
            activity_type="focus.deep_session",
            qualified_on=at.date(),
            occurred_at=at,
        )
    assert recent_study_days(user=user, now=NOW, zone_name="Africa/Tripoli") == ["2026-10-26"]
    scheduled(user, skip_if_studied=True)
    assert run()["created"] == 0
    mistake(user)
    StudyReminder.objects.filter(user=user).update(review_enabled=True, next_due_at=NOW)
    assert run()["created"] == 1
    assert Notification.objects.get().template_key == "study.review"


def test_weekly_summary_combines_review_count_and_takes_priority_once():
    user = create_user()
    scheduled(user, weekly_enabled=True, weekly_day=0, review_enabled=True)
    mistake(user)
    policy = active_policy()
    for index in range(3):
        at = NOW - timedelta(days=index)
        StreakActivity.objects.create(
            user=user,
            policy=policy,
            source_key=f"weekly:{index}",
            activity_type="focus.deep_session",
            qualified_on=at.date(),
            occurred_at=at,
        )
    assert run()["created"] == 1
    notification = Notification.objects.get()
    assert notification.template_key == "study.weekly" and notification.target_route == "/progress"
    assert "3" in notification.body and "1" in notification.body
    assert run()["created"] == 0


def test_pause_cancels_queued_alerts_and_resumes_without_catchup():
    user, client, _ = enroll()
    scheduled(user, review_enabled=True)
    mistake(user)
    assert run()["created"] == 1
    delivery = PushDelivery.objects.get()
    with patch("apps.notifications.reminders.timezone.now", return_value=NOW):
        paused = client.put(URL, config(expected_revision=1, pause_hours=24), format="json")
        assert paused.status_code == 200
        assert paused.json()["paused_until"] == (NOW + timedelta(hours=24)).isoformat()
        assert datetime.fromisoformat(paused.json()["next_due_at"]) > NOW + timedelta(hours=24)
        resumed = client.put(URL, config(expected_revision=2, pause_hours=0), format="json")
        assert resumed.json()["paused_until"] is None
        assert datetime.fromisoformat(resumed.json()["next_due_at"]) > NOW
    delivery.refresh_from_db()
    assert delivery.status == "cancelled"


def test_quiet_hours_defer_without_consuming_retries_and_protect_privacy():
    user, _, _ = enroll()
    StudyReminder.objects.create(
        user=user, quiet_enabled=True, quiet_start=time(17), quiet_end=time(19), push_preview=False
    )
    notification = notice(user)
    Notification.objects.filter(pk=notification.pk).update(created_at=NOW)
    PushDelivery.objects.update(next_attempt_at=NOW)
    with (
        patch("apps.notifications.push.timezone.now", return_value=NOW),
        patch("apps.notifications.push.webpush") as send,
    ):
        assert dispatch_push()["deferred"] == 1
        send.assert_not_called()
    delivery = PushDelivery.objects.get()
    assert delivery.status == "pending" and delivery.attempts == 0
    assert delivery.next_attempt_at == NOW.replace(hour=17, minute=0)
    with (
        patch("apps.notifications.push.timezone.now", return_value=NOW.replace(hour=17, minute=1)),
        patch("apps.notifications.push.webpush") as send,
    ):
        assert dispatch_push()["accepted"] == 1
    body = json.loads(send.call_args.kwargs["data"])
    assert body["body"] == "افتح Lockin لقراءة إشعارك." and body["title"] == "Lockin"
    notification.refresh_from_db()
    assert notification.body == "Ready to study"


def test_overnight_quiet_end_and_repeated_dst_hour_are_in_the_future():
    reminder = StudyReminder(quiet_enabled=True)
    assert quiet_until(reminder, NOW.replace(hour=21)) == NOW.replace(day=27, hour=6, minute=0)
    reminder.timezone = "Europe/Berlin"
    reminder.quiet_end = time(2, 30)
    repeated = datetime(2026, 10, 25, 2, 15, tzinfo=ZoneInfo("Europe/Berlin"), fold=1)
    end = quiet_until(reminder, repeated)
    assert end > repeated.astimezone(ZoneInfo("UTC"))
    assert (end - repeated.astimezone(ZoneInfo("UTC"))).total_seconds() == 900


def test_required_bypasses_quiet_and_scheduled_push_expires_in_two_hours():
    from apps.notifications.services import create_notification

    user, _, _ = enroll()
    reminder = scheduled(user, quiet_enabled=True, quiet_start=time(17), quiet_end=time(19))
    with patch("apps.notifications.push.timezone.now", return_value=NOW):
        create_notification(
            recipient_id=user.id,
            category="account",
            template_key="account.test",
            title="Account",
            body="Required",
            deduplication_key="account-test",
            required=True,
        )
        PushDelivery.objects.update(next_attempt_at=NOW)
        with patch("apps.notifications.push.webpush") as send:
            assert dispatch_push()["accepted"] == 1
        assert json.loads(send.call_args.kwargs["data"])["body"] == "Required"
    reminder.quiet_enabled = False
    reminder.save()
    assert run()["created"] == 1
    PushDelivery.objects.update(next_attempt_at=NOW)
    with (
        patch("apps.notifications.push.timezone.now", return_value=NOW + timedelta(minutes=30)),
        patch("apps.notifications.push.webpush") as send,
    ):
        assert dispatch_push()["accepted"] == 1
    expires = datetime.fromisoformat(json.loads(send.call_args.kwargs["data"])["expires_at"])
    assert expires == NOW + timedelta(hours=2)
    assert send.call_args.kwargs["ttl"] == 5400
