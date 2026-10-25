"""Daily study reminders owned by the account and dispatched without an open tab."""

from datetime import datetime, timedelta
from datetime import time as wall_time
from typing import Any
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.accounts.models import User

from .models import Notification, PushDelivery, StudyReminder
from .services import create_notification


class ReminderChanged(APIException):
    status_code = 409
    default_code = "reminder_changed"
    default_detail = "Your reminder changed on another device. Reload it first."


def next_due(now: datetime, at: wall_time, zone_name: str) -> datetime:
    zone = ZoneInfo(zone_name)
    local = now.astimezone(zone)
    candidate = datetime.combine(local.date(), at, tzinfo=zone)
    if candidate <= local:
        candidate = datetime.combine(local.date() + timedelta(days=1), at, tzinfo=zone)
    return candidate.astimezone(ZoneInfo("UTC"))


def reminder_payload(reminder: StudyReminder) -> dict[str, Any]:
    return {
        "enabled": reminder.enabled,
        "time": reminder.time.strftime("%H:%M"),
        "timezone": reminder.timezone,
        "locale": reminder.locale,
        "revision": 0 if reminder._state.adding else reminder.revision,
        "next_due_at": reminder.next_due_at.isoformat() if reminder.next_due_at else None,
    }


def get_reminder(user: User) -> dict[str, Any]:
    return reminder_payload(
        StudyReminder.objects.filter(user=user).first() or StudyReminder(user=user)
    )


@transaction.atomic
def save_reminder(user: User, data: dict[str, Any]) -> dict[str, Any]:
    # Serialize first-time settings creation without blocking notification FK
    # inserts while a scheduler holds the existing reminder row.
    User.objects.select_for_update(no_key=True).get(pk=user.pk)
    reminder = StudyReminder.objects.select_for_update().filter(user=user).first()
    if reminder is None:
        reminder = StudyReminder(user=user)
    revision = 0 if reminder._state.adding else reminder.revision
    if revision != data["expected_revision"]:
        raise ReminderChanged()
    for field in ("enabled", "time", "timezone", "locale"):
        setattr(reminder, field, data[field])
    reminder.revision = revision + 1
    reminder.next_due_at = (
        next_due(timezone.now(), reminder.time, reminder.timezone) if reminder.enabled else None
    )
    reminder.save()
    # A disabled/rescheduled reminder must not retain an obsolete queued push.
    PushDelivery.objects.filter(
        notification__recipient=user,
        notification__template_key="study.reminder",
        status__in=("pending", "sending"),
    ).update(status="cancelled", lock_token=None, locked_until=None)
    return reminder_payload(reminder)


def dispatch_study_reminders(*, limit: int = 100) -> dict[str, int]:
    counts = {"created": 0, "skipped": 0}
    for _ in range(min(max(limit, 0), 1000)):
        now = timezone.now()
        with transaction.atomic():
            reminder = (
                StudyReminder.objects.select_for_update(skip_locked=True)
                .filter(enabled=True, next_due_at__lte=now)
                .order_by("next_due_at", "user_id")
                .first()
            )
            if reminder is None:
                break
            due = reminder.next_due_at
            assert due is not None  # noqa: S101 - required by the due query
            local = now.astimezone(ZoneInfo(reminder.timezone))
            timely = (
                now - due <= timedelta(hours=2)
                and due.astimezone(ZoneInfo(reminder.timezone)).date() == local.date()
            )
            active = User.objects.filter(pk=reminder.user_id, is_active=True).exists()
            if timely and active:
                _, created = create_notification(
                    recipient_id=reminder.user_id,
                    category=Notification.Category.LEARNING,
                    template_key="study.reminder",
                    title="حان وقت الدراسة" if reminder.locale == "ar" else "Time to study",
                    body="جلسة قصيرة خطوة نحو هدفك. تابع دراستك في Lockin."
                    if reminder.locale == "ar"
                    else "A short session moves you forward. Continue your study in Lockin.",
                    deduplication_key=f"study-reminder:{local.date().isoformat()}",
                    target_route="/dashboard",
                )
                counts["created" if created else "skipped"] += 1
            else:
                counts["skipped"] += 1
            reminder.next_due_at = next_due(now, reminder.time, reminder.timezone)
            reminder.save(update_fields=("next_due_at",))
    return counts
