"""Reading-only preview using the student's authorized, published syllabus.

This is a bounded first integration of scheduling.py, not the full adaptive
planner. It does not persist tasks, schedule question reviews, or infer mastery.
"""

from datetime import date, timedelta
from typing import Any

from rest_framework.exceptions import ValidationError

from apps.accounts.models import User

from .exam_models import ExamPeriod
from .learning_snapshot import student_learning_snapshot
from .models import StudyPlanItem
from .scheduling import DayCapacity, FixedWork, WorkUnit, build_schedule_preview
from .services import plan_today, profile_for

MINUTES_PER_PAGE = 5  # Explicit bootstrap estimate; not a measured student speed.
MAX_UNITS = 10_000
MAX_HORIZON_DAYS = 366


def reading_plan_preview(*, user: User, period: ExamPeriod, edition: str) -> dict[str, Any]:
    snapshot = student_learning_snapshot(user=user, period=period)
    profile = profile_for(user)
    if profile._state.adding or profile.mode != "normal":
        raise ValidationError({"profile": "Save a Normal plan with your available time first."})
    today = plan_today(profile)
    deadlines = [period.starts_on]
    exam_dates: set[date] = set()
    for subject in snapshot["subjects"]:
        dates = {date.fromisoformat(exam["scheduled_on"]) for exam in subject["schedules"]}
        deadlines.extend(dates)
        exam_dates.update(dates or {period.starts_on})
    # Never allocate exam-day preparation by silently treating it as a free day.
    end = max(deadlines) - timedelta(days=1)
    if end < today:
        raise ValidationError({"exam": "No preparation days remain before this exam."})
    if (end - today).days >= MAX_HORIZON_DAYS:
        raise ValidationError({"exam": "The planning horizon cannot exceed 366 days."})
    capacities = tuple(
        DayCapacity(
            day,
            profile.daily_minutes
            if day.weekday() in profile.weekdays and day not in exam_dates
            else 0,
        )
        for offset in range((end - today).days + 1)
        for day in (today + timedelta(days=offset),)
    )
    existing = list(StudyPlanItem.objects.filter(user=user, scheduled_date__range=(today, end)))
    fixed = tuple(
        FixedWork(f"existing:{item.pk}", item.scheduled_date, item.duration_minutes)
        for item in existing
    )
    if len(fixed) > MAX_UNITS:
        raise ValidationError({"syllabus": "This plan exceeds the preview size limit."})
    units: list[WorkUnit] = []
    targets: dict[str, dict[str, Any]] = {}
    issues: list[dict[str, str]] = []
    completed_sheets = 0
    # Duration never exceeds the student's requested session length. Atomic units
    # retain exact page boundaries; the scheduler cannot invent partial pages.
    block_pages = max(1, profile.session_minutes // MINUTES_PER_PAGE)
    for subject in snapshot["subjects"]:
        exams = [date.fromisoformat(exam["scheduled_on"]) for exam in subject["schedules"]]
        deadline = min(exams, default=period.starts_on) - timedelta(days=1)
        for sheet in subject["sheets"]:
            base = {
                "subject_id": subject["subject_id"],
                "sheet_id": sheet["sheet_id"],
                "title": sheet["title"],
            }
            pdf = next((pdf for pdf in sheet["editions"] if pdf["edition"] == edition), None)
            if pdf is None or not pdf["deliverable"]:
                issues.append({**base, "reason": "edition_unavailable"})
                continue
            pages = pdf["page_count"]
            if type(pages) is not int or pages < 1:
                issues.append({**base, "reason": "page_count_unknown"})
                continue
            reading = sheet["reading"]
            if reading and reading["status"] == "completed":
                completed_sheets += 1
                continue
            # A percentage or last open page does not identify pages learned.
            # Ask for coverage rather than silently restarting or skipping them.
            if reading and reading["completion_percent"] > 0:
                issues.append({**base, "reason": "partial_reading_needs_confirmation"})
                continue
            previous: str | None = None
            for first in range(1, pages + 1, block_pages):
                last = min(pages, first + block_pages - 1)
                key = f"reading:{sheet['version_id']}:{edition}:{first}-{last}"
                if len(units) + len(fixed) >= MAX_UNITS:
                    raise ValidationError(
                        {"syllabus": "This syllabus exceeds the preview size limit."}
                    )
                # Overlapping subject scopes must not duplicate the same activity.
                if key in targets:
                    raise ValidationError(
                        {"syllabus": "A sheet belongs to overlapping exam scopes."}
                    )
                units.append(
                    WorkUnit(
                        key,
                        (last - first + 1) * MINUTES_PER_PAGE,
                        today,
                        deadline,
                        priority=-first,
                        requires=(previous,) if previous else (),
                    )
                )
                previous = key
                targets[key] = {
                    **base,
                    "version_id": sheet["version_id"],
                    "title": sheet["title"],
                    "edition": edition,
                    "page_start": first,
                    "page_end": last,
                    "activity": "reading",
                    "deadline": deadline.isoformat(),
                    "deadline_source": subject["deadline_source"],
                }
    # Past subject deadlines are represented as unplaced work, not shifted later.
    expired = [unit for unit in units if unit.deadline < today]
    pending = tuple(unit for unit in units if unit.deadline >= today)
    result = build_schedule_preview(pending, capacities, fixed)
    return {
        "schema_version": 1,
        "kind": "reading_only_preview",
        "planner_ready": False,
        "persisted": False,
        "exam": snapshot["exam"],
        "syllabus_fingerprint": snapshot["syllabus_fingerprint"],
        "computed_at": snapshot["computed_at"],
        "profile_revision": profile.revision,
        "estimate": {
            "minutes_per_page": MINUTES_PER_PAGE,
            "source": "bootstrap",
            "confidence": "low",
        },
        "completed_reading_sheets": completed_sheets,
        "coverage_complete": not issues,
        "issues": issues,
        "assignments": [
            {
                **targets[item.key],
                "key": item.key,
                "scheduled_date": item.day.isoformat(),
                "estimated_minutes": item.minutes,
            }
            for item in result.assignments
        ],
        "unscheduled": [
            {
                **targets[item.key],
                "key": item.key,
                "estimated_minutes": item.minutes,
                "reason": item.reason,
            }
            for item in result.unscheduled
        ]
        + [
            {
                **targets[item.key],
                "key": item.key,
                "estimated_minutes": item.minutes,
                "reason": "deadline_before_horizon",
            }
            for item in expired
        ],
        "days": [
            {
                "date": day.day.isoformat(),
                "available_minutes": day.available,
                "existing_minutes": day.fixed,
                "allocated_minutes": day.allocated,
                "remaining_minutes": day.remaining,
                "existing_overflow_minutes": day.overflow,
            }
            for day in result.days
        ],
        "required_reading_minutes": sum(unit.minutes for unit in units),
        "scheduled_reading_minutes": sum(item.minutes for item in result.assignments),
        "scope_notice": (
            "Reading only. Questions, review and incomplete metadata require additional time. "
            "This heuristic does not prove feasibility."
        ),
    }
