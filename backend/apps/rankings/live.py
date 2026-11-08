"""Live, cohort-scoped standings from the existing ranking evidence projection."""

import hashlib
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.accounts.models import User

from .models import RankingFact, RankingProfile

RANKING_TIMEZONE = ZoneInfo("Africa/Tripoli")


def period_bounds(*, period: str, now: datetime) -> tuple[datetime | None, datetime | None]:
    local = now.astimezone(RANKING_TIMEZONE)
    if period == "all_time":
        return None, None
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "weekly":
        start -= timedelta(days=start.weekday())
        return start, start + timedelta(days=7)
    if period == "monthly":
        start = start.replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1)
        return start, end
    raise ValueError("Unsupported ranking period")


def live_ranking(*, viewer: User, period: str = "weekly") -> dict[str, object]:
    now = timezone.now()
    start, end = period_bounds(period=period, now=now)
    cohort = viewer.cohort
    payload: dict[str, object] = {
        "period": period,
        "period_start": start,
        "period_end": end,
        "timezone": "Africa/Tripoli",
        "generated_at": now,
        "scope": "cohort",
        "cohort_required": cohort is None,
        "cohort_name": (cohort.name_ar if viewer.preferred_language == "ar" else cohort.name_en)
        if cohort
        else "",
        "participant_count": 0,
        "entries": [],
        "own_entry": None,
        "points_to_next_rank": None,
    }
    # An unassigned student must never fall back to a global comparison.
    if cohort is None:
        return payload
    facts = RankingFact.objects.filter(
        is_valid=True,
        occurred_at__lte=now,
        cohort_id=cohort.id,
        user__cohort_id=cohort.id,
        user__is_active=True,
        user__status=User.Status.ACTIVE,
    ).filter(Q(user__ranking_profile__included=True) | Q(user__ranking_profile__isnull=True))
    if start is not None:
        facts = facts.filter(occurred_at__gte=start, occurred_at__lt=end)
    scores = (
        facts.values("user_id")
        .annotate(score=Sum("points"), evidence_count=Count("id", filter=Q(points__gt=0)))
        .filter(score__gt=0)
        .order_by("-score", "user_id")
    )
    top = list(scores[:100])
    own = next((row for row in top if row["user_id"] == viewer.id), None)
    if own is None:
        own = scores.filter(user_id=viewer.id).first()
    user_ids = {row["user_id"] for row in top}
    if own:
        user_ids.add(viewer.id)
    users = {
        user.id: user
        for user in User.objects.filter(id__in=user_ids).select_related("ranking_profile")
    }

    def serialize(row: dict[str, Any], position: int) -> dict[str, object]:
        user = users[row["user_id"]]
        profile = getattr(user, "ranking_profile", None)
        mode = profile.display_mode if profile else RankingProfile.DisplayMode.INITIALS
        key = hashlib.sha256(str(user.id).encode()).hexdigest()[:16]
        if user.id == viewer.id or mode == RankingProfile.DisplayMode.FULL_NAME:
            name = user.full_name or "Learner"
        elif mode == RankingProfile.DisplayMode.ANONYMOUS:
            name = f"Learner {key[:4].upper()}"
        else:
            name = " ".join(f"{word[0].upper()}." for word in user.full_name.split()[:3])
        return {
            "entry_key": key,
            "position": position,
            "score": row["score"],
            "evidence_count": row["evidence_count"],
            "display_name": name or "Learner",
            "is_me": user.id == viewer.id,
        }

    entries = []
    position = 0
    last_score = None
    for ordinal, row in enumerate(top, start=1):
        if row["score"] != last_score:
            position = ordinal
            last_score = row["score"]
        entries.append(serialize(row, position))
    own_entry = next((entry for entry in entries if entry["is_me"]), None)
    if own is not None and own_entry is None:
        own_entry = serialize(own, scores.filter(score__gt=own["score"]).count() + 1)
    if own is not None:
        next_score = scores.filter(score__gt=own["score"]).order_by("score", "user_id").first()
        if next_score:
            payload["points_to_next_rank"] = next_score["score"] - own["score"]
    payload.update(participant_count=scores.count(), entries=entries, own_entry=own_entry)
    return payload
