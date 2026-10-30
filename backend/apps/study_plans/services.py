"""Account-owned plans. Every writer takes the same user lock before planning.

Completion is self reported and never awards XP or certifies study time.
"""

import hashlib
import json
from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.models import User

from .models import StudyPlanItem, StudyPlanProfile
from .serializers import study_plan_item_payload


class PlanChanged(APIException):
    status_code = 409
    default_detail = "Your plan changed. Refresh it and try again."
    default_code = "plan_changed"


def profile_for(user: User) -> StudyPlanProfile:
    return StudyPlanProfile.objects.filter(user=user).first() or StudyPlanProfile(user=user)


def plan_today(profile: StudyPlanProfile) -> date:
    return timezone.localdate(timezone=ZoneInfo(profile.timezone))


def profile_payload(profile: StudyPlanProfile) -> dict[str, Any]:
    return {
        "mode": profile.mode,
        "daily_minutes": profile.daily_minutes,
        "session_minutes": profile.session_minutes,
        "weekdays": profile.weekdays,
        "subjects": profile.subjects,
        "timezone": profile.timezone,
        "review_minutes": profile.review_minutes,
        "weekly_minutes": profile.weekly_minutes,
        "date_minutes": profile.date_minutes,
        "habit_baseline_minutes": profile.habit_baseline_minutes,
        "habit_block_minutes": profile.habit_block_minutes,
        "study_rhythm": profile.study_rhythm,
        "gradual_growth": profile.gradual_growth,
        "revision": 0 if profile._state.adding else profile.revision,
        "configured": not profile._state.adding,
    }


def beginner_progress(user: User, today: date) -> dict[str, Any]:
    days = (
        StudyPlanItem.objects.filter(
            user=user,
            plan_mode="beginning",
            status="completed",
            scheduled_date__lte=today,
        )
        .values("scheduled_date")
        .distinct()
        .count()
    )
    return {
        "completed_days": days,
        "session_minutes": (10, 15, 20, 25)[min(days // 3, 3)],
        "next_step_in": max(0, 3 - days % 3) if days < 9 else 0,
        "ready_for_normal": days >= 12,
        "self_reported": True,
    }


@transaction.atomic
def save_profile(user: User, data: dict[str, Any]) -> dict[str, Any]:
    User.objects.select_for_update().get(pk=user.pk)
    profile = profile_for(user)
    changes = dict(data)
    expected = changes.pop("expected_revision")
    if expected != profile_payload(profile)["revision"]:
        raise PlanChanged()
    for field, value in changes.items():
        setattr(profile, field, value)
    profile.revision = expected + 1
    profile.save()
    return profile_payload(profile)


def _durations(total: int, session: int) -> list[int]:
    result = [session] * (total // session)
    rest = total % session
    if rest >= 5:
        result.append(rest)
    elif rest and result:
        result[-1] += rest
    return result


def preview_plan(user: User, start: date) -> dict[str, Any]:
    profile = profile_for(user)
    today = plan_today(profile)
    if profile._state.adding or profile.mode == "custom":
        raise ValidationError({"mode": "Save a Beginning or Normal plan first."})
    if start < today - timedelta(days=today.weekday()) or start > today + timedelta(days=365):
        raise ValidationError(
            {"start_date": "Choose the current week or a future week within a year."}
        )
    progress = beginner_progress(user, today)
    existing = list(
        StudyPlanItem.objects.exclude(status="superseded").filter(
            user=user,
            scheduled_date__range=(start, start + timedelta(days=6)),
        )
    )
    items: list[dict[str, Any]] = []
    skipped = 0
    for offset in range(7):
        day = start + timedelta(days=offset)
        from .availability import available_minutes

        daily_capacity = available_minutes(profile, day)
        if day < today or not daily_capacity:
            continue
        daily = [item for item in existing if item.scheduled_date == day]
        # Keep an existing generated day intact, including edited/completed work.
        if any(item.generated_slot is not None for item in daily):
            skipped += 1
            continue
        budget = max(0, 480 - sum(item.duration_minutes for item in daily))
        durations = (
            [progress["session_minutes"]]
            if profile.mode == "beginning"
            else _durations(
                max(0, daily_capacity - sum(item.duration_minutes for item in daily)),
                profile.session_minutes,
            )
        )
        if sum(durations) > budget or len(daily) + len(durations) > 48:
            skipped += 1
            continue
        for slot, minutes in enumerate(durations):
            subject = (
                profile.subjects[(day.toordinal() + slot) % len(profile.subjects)]
                if profile.subjects
                else ""
            )
            items.append(
                {
                    "title": subject or "Study session",
                    "subject": subject,
                    "scheduled_date": day.isoformat(),
                    "duration_minutes": minutes,
                    "generated_slot": slot,
                    "plan_mode": profile.mode,
                }
            )
    canonical = {
        "profile": profile_payload(profile),
        "today": today.isoformat(),
        "items": items,
        "existing": [(str(item.id), item.revision) for item in existing],
    }
    token = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
    return {
        "items": items,
        "count": len(items),
        "skipped_days": skipped,
        "minutes": sum(item["duration_minutes"] for item in items),
        "preview_token": token,
    }


@transaction.atomic
def generate_plan(user: User, start: date, token: str) -> dict[str, Any]:
    User.objects.select_for_update().get(pk=user.pk)
    preview = preview_plan(user, start)
    if preview["preview_token"] != token:
        raise PlanChanged()
    items = StudyPlanItem.objects.bulk_create(
        [StudyPlanItem(user=user, **item) for item in preview["items"]]
    )
    return {"count": len(items), "results": [study_plan_item_payload(item) for item in items]}


def validate_day(user: User, day: date, minutes: int, exclude: Any = None) -> None:
    items = StudyPlanItem.objects.filter(user=user, scheduled_date=day).exclude(status="superseded")
    if exclude is not None:
        items = items.exclude(pk=exclude)
    if (
        items.count() >= 48
        or (items.aggregate(total=Sum("duration_minutes"))["total"] or 0) + minutes > 480
    ):
        raise ValidationError(
            {"duration_minutes": "A day can contain at most 480 minutes and 48 sessions."},
            code="day_limit_exceeded",
        )
