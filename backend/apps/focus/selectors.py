from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db.models import Count, Max, Sum
from django.db.models.functions import Coalesce

from .models import FocusSession


@dataclass(frozen=True, slots=True)
class FocusSummary:
    completed_sessions: int
    active_seconds: int
    last_completed_at: datetime | None


def get_focus_summary(*, user_id: UUID) -> FocusSummary:
    values = FocusSession.objects.filter(
        user_id=user_id, status=FocusSession.Status.COMPLETED
    ).aggregate(
        completed_sessions=Count("id"),
        active_seconds=Coalesce(Sum("active_duration_seconds"), 0),
        last_completed_at=Max("ended_at"),
    )
    return FocusSummary(
        completed_sessions=int(values["completed_sessions"]),
        active_seconds=int(values["active_seconds"]),
        last_completed_at=values["last_completed_at"],
    )
