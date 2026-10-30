"""Conservative study-habit calibration from existing account-owned activity.

Time is evidence of app usage/self-report, never evidence of understanding.
Avoid double-counting time that appears both in a Focus session and a reading report.
"""

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from math import floor
from statistics import median
from typing import Any
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.accounts.models import User
from apps.focus.models import FocusSession, FocusSessionParticipant

from .availability import available_minutes
from .models import StudyEvidence, StudyPlanProfile


def difficulty_multiplier(level: int) -> float:
    """Admin workload ratings are heuristic, not validated content comprehension."""
    return {1: 0.8, 2: 0.9, 3: 1.0, 4: 1.2, 5: 1.4}.get(level, 1.0)


def habit_snapshot(*, user: User, profile: StudyPlanProfile, today: date) -> dict[str, Any]:
    zone = ZoneInfo(profile.timezone)
    first_day = today - timedelta(days=27)
    first_instant = datetime.combine(first_day, time.min, tzinfo=zone)
    reading_days: dict[date, int] = defaultdict(int)
    focus_days: dict[date, int] = defaultdict(int)
    for row in StudyEvidence.objects.filter(
        user=user, occurred_on__gte=first_day, occurred_on__lte=today, minutes__gt=0
    ).values("occurred_on", "minutes")[:2000]:
        reading_days[row["occurred_on"]] += row["minutes"]
    # Finished solo sessions only; team time is credited to its own participant.
    sessions = FocusSession.objects.filter(
        user=user, lock_in_live=False, status=FocusSession.Status.COMPLETED,
        started_at__gte=first_instant,
    ).values("started_at", "active_duration_seconds")[:2000]
    block_samples: list[int] = []
    for row in sessions:
        minutes = min(240, row["active_duration_seconds"] // 60)
        if minutes < 1:
            continue
        focus_days[row["started_at"].astimezone(zone).date()] += minutes
        block_samples.append(minutes)
    participants = FocusSessionParticipant.objects.filter(
        user=user, session__lock_in_live=True,
        session__status=FocusSession.Status.COMPLETED,
        joined_at__gte=first_instant,
    ).values("joined_at", "active_microseconds")[:2000]
    for row in participants:
        minutes = min(240, row["active_microseconds"] // 60_000_000)
        if minutes < 1:
            continue
        focus_days[row["joined_at"].astimezone(zone).date()] += minutes
        block_samples.append(minutes)

    # Both sources can describe the same period. Use the larger daily total,
    # never their sum; these are planning proxies, not measured attention.
    days = [
        min(480, max(reading_days.get(day, 0), focus_days.get(day, 0)))
        for day in (first_day + timedelta(days=offset) for offset in range(28))
    ]
    observed = [minutes for minutes in days if minutes >= 5]
    recent_active_days = sum(value >= 5 for value in days[-14:])
    if len(observed) >= 3:
        baseline = round(median(observed))
        source = "recorded"
    elif profile.habit_baseline_minutes is not None:
        baseline = profile.habit_baseline_minutes
        source = "self_reported"
    else:
        baseline = None
        source = "unknown"
    block = profile.habit_block_minutes or (
        round(median(block_samples)) if len(block_samples) >= 3 else profile.session_minutes
    )
    if profile.study_rhythm == "fragmented":
        block = min(block, 20)
    elif profile.study_rhythm == "continuous":
        block = max(block, 30)
    return {
        "source": source,
        "baseline_minutes": baseline,
        "sample_days": len(observed),
        "recent_active_days": recent_active_days,
        "suggested_block_minutes": min(120, max(10, block)),
        "rhythm": profile.study_rhythm,
        "gradual_growth": profile.gradual_growth,
        "confidence": "medium" if len(observed) >= 7 else "low",
        "window_days": 28,
    }


def adaptive_capacity(
    profile: StudyPlanProfile, day: date, today: date, habit: dict[str, Any]
) -> int:
    """Grow carefully toward declared availability, not toward exam pressure.

    Missed recent study days never cause a punitive catch-up spike.
    A new assessment may suggest a first small increase, but further increases
    require activity evidence. Zero/rest-day overrides always win.
    """
    limit = available_minutes(profile, day)
    baseline = habit["baseline_minutes"]
    if limit == 0 or not profile.gradual_growth or baseline is None or day < today:
        return limit
    week = max(0, (day - today).days // 7)
    observed = habit["sample_days"]
    recent = habit["recent_active_days"]
    if observed >= 7 and recent < 3:
        suggested = floor(baseline * 0.95)
    elif observed >= 3 and recent >= 3:
        suggested = floor(baseline * 1.10 ** min(week + 1, 8))
    else:
        # Do not promise continued improvement without subsequent evidence.
        suggested = floor(baseline * 1.05)
    return min(limit, max(10, suggested))
