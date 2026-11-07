"""Read-only exam priorities for Review, using the planner's visibility rules."""

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from django.conf import settings

from apps.accounts.models import User
from apps.education.models import EducationNode

from .learning_snapshot import student_exam_periods, student_exam_schedules_for_periods
from .services import profile_for


def review_exam_dates(
    *, user: User, now: datetime, subject_keys: Iterable[str] = ()
) -> dict[str, date]:
    if not settings.STUDY_PLAN_V2_ENABLED or user.cohort_id is None:
        return {}
    allowed = getattr(settings, "STUDY_PLAN_V2_USER_IDS", [])
    if allowed and str(user.pk) not in allowed:
        return {}
    node_keys: dict[UUID, list[str]] = {}
    for key in subject_keys:
        prefix, _, raw_id = key.partition(":")
        if prefix not in ("node", "content"):
            continue
        try:
            node_keys.setdefault(UUID(raw_id), []).append(key)
        except ValueError:
            continue
    node_paths = EducationNode.objects.filter(pk__in=node_keys, is_discoverable=True).values_list(
        "id", "path"
    )
    descendant_keys = [(key, path) for node_id, path in node_paths for key in node_keys[node_id]]
    today = now.astimezone(ZoneInfo(profile_for(user).timezone)).date()
    schedules = sorted(
        (
            schedule
            for schedule in student_exam_schedules_for_periods(
                user=user, periods=list(student_exam_periods(user=user)[:50])
            )
            if today <= schedule.scheduled_on <= today + timedelta(days=14)
        ),
        key=lambda schedule: (schedule.scheduled_on, str(schedule.pk)),
    )
    dates: dict[str, date] = {}
    for schedule in schedules:
        subject = schedule.subject
        for key in (
            f"catalog:{subject.material_slug}",
            f"content:{subject.source_node_id}",
            f"node:{subject.source_node_id}",
        ):
            dates.setdefault(key, schedule.scheduled_on)
        for key, path in descendant_keys:
            if path.startswith(subject.source_node.path):
                dates.setdefault(key, schedule.scheduled_on)
    return dates
