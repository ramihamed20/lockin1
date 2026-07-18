from datetime import timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.accounts.models import User

from .models import UserStreak
from .services import active_policy


def streak_summary_for_user(*, user: User) -> dict[str, object]:
    policy = active_policy()
    state = UserStreak.objects.filter(user=user).first()
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
        "policy": {
            "title": policy.title,
            "version": policy.version,
            "qualifying_activity_types": policy.qualifying_activity_types,
            "grace_days": policy.grace_days,
            "freeze_tokens_enabled": policy.freeze_tokens_enabled,
        },
    }
