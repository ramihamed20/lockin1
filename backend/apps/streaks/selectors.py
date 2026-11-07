from datetime import timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.accounts.models import User

from .models import StreakActivity, UserStreak
from .services import active_policy


def streak_summary_for_user(*, user: User) -> dict[str, object]:
    policy = active_policy()
    state = UserStreak.objects.filter(user=user).first()
    today = timezone.now().astimezone(ZoneInfo(policy.boundary_timezone)).date()
    start = today - timedelta(days=today.weekday() + 21)
    end = today + timedelta(days=6 - today.weekday())
    days = list(
        StreakActivity.objects.filter(user=user, qualified_on__range=(start, today))
        .order_by("qualified_on")
        .values_list("qualified_on", flat=True)
        .distinct()
    )
    current_days = state.current_days if state else 0
    if state and state.last_qualified_on:
        today = timezone.now().astimezone(ZoneInfo(policy.boundary_timezone)).date()
        allowed_gap = timedelta(days=1 + policy.grace_days)
        if today - state.last_qualified_on > allowed_gap:
            current_days = 0
    return {
        "current_days": current_days,
        "longest_days": state.longest_days if state else 0,
        "last_qualified_on": state.last_qualified_on if state else None,
        "freeze_tokens_available": state.freeze_tokens_available if state else 0,
        "calendar": {
            "timezone": policy.boundary_timezone,
            "today": today.isoformat(),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "qualified_days": [day.isoformat() for day in days],
        },
        "policy": {
            "title": policy.title,
            "version": policy.version,
            "qualifying_activity_types": policy.qualifying_activity_types,
            "grace_days": policy.grace_days,
            "freeze_tokens_enabled": policy.freeze_tokens_enabled,
        },
    }
