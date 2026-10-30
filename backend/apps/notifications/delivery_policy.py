"""Timing and privacy rules shared by scheduled notices and device delivery."""

from datetime import datetime, timedelta
from datetime import time as wall_time
from zoneinfo import ZoneInfo

from .models import Notification, StudyReminder

STUDY_TEMPLATES = ("study.reminder", "study.review", "study.weekly")


def in_quiet_hours(at: wall_time, start: wall_time, end: wall_time) -> bool:
    return start <= at < end if start < end else at >= start or at < end


def quiet_until(reminder: StudyReminder | None, now: datetime) -> datetime | None:
    if reminder is None or not reminder.quiet_enabled:
        return None
    local = now.astimezone(ZoneInfo(reminder.timezone))
    if not in_quiet_hours(local.time(), reminder.quiet_start, reminder.quiet_end):
        return None
    end_date = local.date()
    if reminder.quiet_start > reminder.quiet_end and local.time() >= reminder.quiet_start:
        end_date += timedelta(days=1)
    end = datetime.combine(end_date, reminder.quiet_end, tzinfo=local.tzinfo)
    if end_date == local.date():
        end = end.replace(fold=local.fold)
    return end.astimezone(ZoneInfo("UTC"))


def scheduled_push_allowed(
    notice: Notification, reminder: StudyReminder | None, now: datetime
) -> bool:
    if notice.template_key not in STUDY_TEMPLATES:
        return True
    if reminder is None or not reminder.enabled:
        return False
    if reminder.paused_until and reminder.paused_until > now:
        return False
    if notice.data.get("reminder_revision", reminder.revision) != reminder.revision:
        return False
    return bool(
        {
            "study.reminder": reminder.study_enabled,
            "study.review": reminder.review_enabled,
            "study.weekly": reminder.weekly_enabled,
        }[notice.template_key]
    )


def push_expires_at(notice: Notification, session_expiry: datetime) -> datetime:
    lifetime = timedelta(hours=2) if notice.template_key in STUDY_TEMPLATES else timedelta(days=1)
    return min(notice.created_at + lifetime, session_expiry)
