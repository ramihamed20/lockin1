"""Opt-in study briefings dispatched by the existing operations scheduler."""

from datetime import datetime, timedelta
from datetime import time as wall_time
from typing import Any
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.models import User
from apps.review.selectors import due_review_count
from apps.streaks.activity_selectors import recent_study_days

from .delivery_policy import STUDY_TEMPLATES, in_quiet_hours
from .models import Notification, PushDelivery, StudyReminder
from .services import create_notification

REMINDER_FIELDS = (
    "enabled",
    "time",
    "timezone",
    "locale",
    "weekdays",
    "study_enabled",
    "review_enabled",
    "weekly_enabled",
    "weekly_day",
    "skip_if_studied",
    "quiet_enabled",
    "quiet_start",
    "quiet_end",
    "push_preview",
)


class ReminderChanged(APIException):
    status_code = 409
    default_code = "reminder_changed"
    default_detail = "Your reminder changed on another device. Reload it first."


def next_due(
    now: datetime, at: wall_time, zone_name: str, weekdays: list[int] | None = None
) -> datetime:
    zone = ZoneInfo(zone_name)
    local = now.astimezone(zone)
    allowed = list(range(7)) if weekdays is None else weekdays
    for offset in range(8):
        day = local.date() + timedelta(days=offset)
        candidate = datetime.combine(day, at, tzinfo=zone)
        # Compare wall time to avoid sending twice in a repeated DST hour.
        if day.weekday() in allowed and candidate > local:
            return candidate.astimezone(ZoneInfo("UTC"))
    raise ValueError("At least one scheduled weekday is required.")


def _schedule(reminder: StudyReminder, now: datetime) -> datetime | None:
    if not reminder.enabled:
        return None
    days = set(reminder.weekdays) if reminder.study_enabled or reminder.review_enabled else set()
    if reminder.weekly_enabled:
        days.add(reminder.weekly_day)
    anchor = max(now, reminder.paused_until) if reminder.paused_until else now
    return next_due(anchor, reminder.time, reminder.timezone, sorted(days))


def reminder_payload(reminder: StudyReminder) -> dict[str, Any]:
    result = {field: getattr(reminder, field) for field in REMINDER_FIELDS}
    for field in ("time", "quiet_start", "quiet_end"):
        result[field] = result[field].strftime("%H:%M")
    result.update(
        revision=0 if reminder._state.adding else reminder.revision,
        next_due_at=reminder.next_due_at.isoformat() if reminder.next_due_at else None,
        paused_until=reminder.paused_until.isoformat() if reminder.paused_until else None,
    )
    return result


def get_reminder(user: User) -> dict[str, Any]:
    return reminder_payload(
        StudyReminder.objects.filter(user=user).first() or StudyReminder(user=user)
    )


@transaction.atomic
def save_reminder(user: User, data: dict[str, Any]) -> dict[str, Any]:
    # Do not block notification FK inserts while the scheduler holds this reminder.
    User.objects.select_for_update(no_key=True).get(pk=user.pk)
    reminder = StudyReminder.objects.select_for_update().filter(user=user).first()
    if reminder is None:
        reminder = StudyReminder(user=user)
    revision = 0 if reminder._state.adding else reminder.revision
    if revision != data["expected_revision"]:
        raise ReminderChanged()
    for field in REMINDER_FIELDS:
        if field in data:
            setattr(reminder, field, data[field])
    if reminder.enabled and not any(
        (reminder.study_enabled, reminder.review_enabled, reminder.weekly_enabled)
    ):
        raise ValidationError({"enabled": "Choose at least one study notification."})
    if reminder.quiet_enabled:
        if reminder.quiet_start == reminder.quiet_end:
            raise ValidationError({"quiet_end": "Quiet hours need different start and end times."})
        if reminder.enabled and in_quiet_hours(
            reminder.time, reminder.quiet_start, reminder.quiet_end
        ):
            raise ValidationError({"time": "Choose a reminder time outside quiet hours."})
    now = timezone.now()
    if "pause_hours" in data:
        reminder.paused_until = (
            now + timedelta(hours=data["pause_hours"]) if data["pause_hours"] else None
        )
    reminder.revision = revision + 1
    reminder.next_due_at = _schedule(reminder, now)
    reminder.save()
    PushDelivery.objects.filter(
        notification__recipient=user,
        notification__template_key__in=STUDY_TEMPLATES,
        status__in=("pending", "sending"),
    ).update(status="cancelled", lock_token=None, locked_until=None)
    return reminder_payload(reminder)


def _briefing(reminder: StudyReminder, now: datetime) -> dict[str, str] | None:
    local = now.astimezone(ZoneInfo(reminder.timezone))
    user = reminder.user
    arabic = reminder.locale == "ar"
    if reminder.weekly_enabled and local.weekday() == reminder.weekly_day:
        days = recent_study_days(user=user, now=now, zone_name=reminder.timezone)
        count = due_review_count(user=user, now=now) if reminder.review_enabled else 0
        body = (
            f"درست في {len(days)} أيام خلال آخر 7 أيام. افتح تقدمك وحدد خطوتك القادمة."
            if arabic
            else (
                f"You studied on {len(days)} of the last 7 days. "
                "See your progress and plan your next step."
            )
        )
        if count:
            body = (
                f"درست في {len(days)} أيام خلال آخر 7 أيام. لديك {count} أسئلة جاهزة للمراجعة."
                if arabic
                else (
                    f"You studied on {len(days)} of the last 7 days. "
                    f"{count} questions are ready to review."
                )
            )
        return {
            "template_key": "study.weekly",
            "title": "أسبوعك في الدراسة" if arabic else "Your study week",
            "body": body,
            "target_route": "/progress",
        }
    if local.weekday() not in reminder.weekdays:
        return None
    if reminder.review_enabled:
        count = due_review_count(user=user, now=now)
        if count:
            return {
                "template_key": "study.review",
                "title": "مراجعة قصيرة تثبّت معلوماتك"
                if arabic
                else "A little review helps it stick",
                "body": f"لديك {count} أسئلة جاهزة في بنك المراجعة. ابدأ ببضعة أسئلة اليوم."
                if arabic
                else f"{count} questions are ready in your Review Bank. Try a few today.",
                "target_route": "/review",
            }
    if not reminder.study_enabled:
        return None
    if reminder.skip_if_studied and local.date().isoformat() in recent_study_days(
        user=user, now=now, zone_name=reminder.timezone
    ):
        return None
    from apps.study_plans.reminders import daily_plan_briefing

    plan = daily_plan_briefing(user=user, today=local.date())
    if plan:
        return {
            "template_key": "study.reminder",
            "title": "خطتك الدراسية اليوم" if arabic else "Your study plan today",
            "body": (
                f"لديك {plan['count']} مهام، نحو {plan['minutes']} دقيقة. ابدأ خطوتك التالية."
                if arabic
                else (
                    f"{plan['count']} tasks, about {plan['minutes']} minutes. Start your next step."
                )
            ),
            "target_route": "/study-plan",
        }
    return {
        "template_key": "study.reminder",
        "title": "حان وقت الدراسة" if arabic else "Time to study",
        "body": "جلسة قصيرة خطوة نحو هدفك. تابع دراستك في Lockin."
        if arabic
        else "A short session moves you forward. Continue your study in Lockin.",
        "target_route": "/dashboard",
    }


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
            assert due is not None  # noqa: S101 - guaranteed by the due query
            local = now.astimezone(ZoneInfo(reminder.timezone))
            timely = (
                now - due <= timedelta(hours=2)
                and due.astimezone(ZoneInfo(reminder.timezone)).date() == local.date()
                and not (reminder.paused_until and reminder.paused_until > now)
            )
            active = User.objects.filter(pk=reminder.user_id, is_active=True).exists()
            briefing = _briefing(reminder, now) if timely and active else None
            if briefing:
                _, created = create_notification(
                    recipient_id=reminder.user_id,
                    category=Notification.Category.LEARNING,
                    template_key=briefing["template_key"],
                    title=briefing["title"],
                    body=briefing["body"],
                    deduplication_key=f"study-reminder:{local.date().isoformat()}",
                    target_route=briefing["target_route"],
                    data={"reminder_revision": reminder.revision},
                )
                counts["created" if created else "skipped"] += 1
            else:
                counts["skipped"] += 1
            reminder.next_due_at = _schedule(reminder, now)
            reminder.save(update_fields=("next_due_at",))
    return counts
