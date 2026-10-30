"""Small account-owned projection for the existing daily notification producer."""

from datetime import date
from typing import Any

from django.conf import settings

from apps.accounts.models import User

from .models import StudyPlanItem


def daily_plan_briefing(*, user: User, today: date) -> dict[str, Any] | None:
    if not getattr(settings, "STUDY_PLAN_V2_ENABLED", False) or user.cohort_id is None:
        return None
    allowed = getattr(settings, "STUDY_PLAN_V2_USER_IDS", [])
    if allowed and str(user.pk) not in allowed:
        return None
    rows = list(
        StudyPlanItem.objects.filter(
            user=user,
            status="planned",
            scheduled_date=today,
            catalog_subject__cohort_id=user.cohort_id,
            planner_run__period__cohort_id=user.cohort_id,
        )
        .order_by("created_at", "id")
        .values("duration_minutes")[:48]
    )
    if not rows:
        return None
    return {"count": len(rows), "minutes": sum(row["duration_minutes"] for row in rows)}
