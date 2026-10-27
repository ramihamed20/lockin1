"""Authorized reading/review preview. No writes, automatic grading, or XP."""

import hashlib
import json
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from django.db.models import Q
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.content.models import CatalogDocument
from apps.review.planning import planning_review_targets

from .exam_models import ExamPeriod
from .learning_snapshot import student_learning_snapshot
from .models import StudyPlanItem
from .scheduling import DayCapacity, FixedWork, WorkUnit, build_schedule_preview
from .services import plan_today, profile_for

MINUTES_PER_PAGE = 5
MAX_UNITS = 10_000
MAX_HORIZON_DAYS = 366


def reading_plan_preview(
    *,
    user: User,
    period: ExamPeriod,
    edition: str,
    include_reviews: bool = False,
    report_id: UUID | None = None,
) -> dict[str, Any]:
    snapshot = student_learning_snapshot(user=user, period=period)
    if not snapshot["subjects"]:
        raise ValidationError({"syllabus": "No subjects have been assigned to this exam yet."})
    profile = profile_for(user)
    if profile._state.adding or profile.mode != "normal":
        raise ValidationError({"profile": "Save a Normal plan with your available time first."})
    today = plan_today(profile)
    exam_dates = {
        date.fromisoformat(exam["scheduled_on"])
        for subject in snapshot["subjects"]
        for exam in subject["schedules"]
    }
    exam_dates.update(
        period.starts_on for subject in snapshot["subjects"] if not subject["schedules"]
    )
    end = max(exam_dates) - timedelta(days=1)
    if end < today or (end - today).days >= MAX_HORIZON_DAYS:
        raise ValidationError({"exam": "Choose an exam with 1–366 preparation days remaining."})
    capacities = tuple(
        DayCapacity(
            today + timedelta(days=i),
            profile.daily_minutes
            if (today + timedelta(days=i)).weekday() in profile.weekdays
            and today + timedelta(days=i) not in exam_dates
            else 0,
        )
        for i in range((end - today).days + 1)
    )
    existing = list(
        StudyPlanItem.objects.filter(user=user)
        .filter(Q(scheduled_date__range=(today, end)) | Q(planning_key__isnull=False))
        .order_by("id")[: MAX_UNITS + 1]
    )
    if len(existing) > MAX_UNITS:
        raise ValidationError({"syllabus": "This plan exceeds the preview size limit."})
    fixed = tuple(
        FixedWork(f"existing:{item.pk}", item.scheduled_date, item.duration_minutes)
        for item in existing
        if today <= item.scheduled_date <= end
    )
    plan_fingerprint = hashlib.sha256(
        json.dumps([(str(item.pk), item.revision) for item in existing]).encode()
    ).hexdigest()
    anchored = [item for item in existing if item.planning_key]
    planned_reviews = {
        str(item.review_item_id)
        for item in anchored
        if item.status == "planned" and item.review_item_id
    }
    existing_keys = {item.planning_key for item in anchored}
    targets: dict[str, dict[str, Any]] = {}
    review_units: list[WorkUnit] = []
    truncated = False
    subjects = {s["subject_id"]: s for s in snapshot["subjects"]}
    if include_reviews:
        rows, truncated = planning_review_targets(
            user=user, subjects=snapshot["subjects"], report_id=report_id
        )
        for target in rows:
            if target["review_item_id"] in planned_reviews or target["key"] in existing_keys:
                continue
            subject = subjects[target["subject_id"]]
            deadline = min(
                (date.fromisoformat(exam["scheduled_on"]) for exam in subject["schedules"]),
                default=period.starts_on,
            ) - timedelta(days=1)
            review_units.append(
                WorkUnit(
                    target["key"],
                    5,
                    min(today, deadline),
                    deadline,
                    priority=target["mistake_count"],
                )
            )
            targets[target["key"]] = {**target, "deadline": str(deadline)}
    if len(review_units) + len(fixed) > MAX_UNITS:
        raise ValidationError({"syllabus": "This plan exceeds the preview size limit."})
    reviews = build_schedule_preview(tuple(review_units), capacities, fixed)
    review_fixed = tuple(
        FixedWork(item.key, item.day, item.minutes) for item in reviews.assignments
    )
    aliases = {
        (str(doc.version_id), str(doc.managed_file_id)): doc
        for doc in CatalogDocument.objects.filter(
            version_id__in=[
                sheet["version_id"] for s in snapshot["subjects"] for sheet in s["sheets"]
            ],
            edition=edition,
            is_active=True,
        )
    }
    units: list[WorkUnit] = []
    issues: list[dict[str, str]] = []
    completed = 0
    block_pages = max(1, profile.session_minutes // MINUTES_PER_PAGE)
    for subject in snapshot["subjects"]:
        deadline = min(
            (date.fromisoformat(exam["scheduled_on"]) for exam in subject["schedules"]),
            default=period.starts_on,
        ) - timedelta(days=1)
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
                completed += 1
                continue
            if reading and reading["completion_percent"] > 0:
                issues.append({**base, "reason": "partial_reading_needs_confirmation"})
                continue
            covered: set[int] = set()
            saved = [
                item
                for item in anchored
                if str(item.content_version_id) == sheet["version_id"]
                and item.activity == "reading"
                and item.edition == edition
                and str(item.source_file_id) == pdf["file_id"]
                and item.page_start
                and item.page_end
            ]
            for item in saved:
                covered.update(
                    range(max(1, item.page_start or 1), min(pages, item.page_end or 0) + 1)
                )
                if item.status == "planned" and not today <= item.scheduled_date <= deadline:
                    issues.append({**base, "reason": "existing_task_needs_rescheduling"})
            previous = None
            first = 1
            while first <= pages:
                if first in covered:
                    first += 1
                    continue
                last = first
                while last + 1 <= min(pages, first + block_pages - 1) and last + 1 not in covered:
                    last += 1
                key = f"reading:{sheet['version_id']}:{edition}:{first}-{last}"
                if key in targets:
                    raise ValidationError(
                        {"syllabus": "A sheet belongs to overlapping exam scopes."}
                    )
                earliest = max(
                    [today]
                    + [
                        item.scheduled_date
                        for item in saved
                        if item.status == "planned" and (item.page_end or 0) < first
                    ]
                )
                units.append(
                    WorkUnit(
                        key,
                        (last - first + 1) * MINUTES_PER_PAGE,
                        earliest,
                        deadline,
                        priority=-first,
                        requires=(previous,) if previous else (),
                    )
                )
                alias = aliases.get((sheet["version_id"], pdf["file_id"]))
                targets[key] = {
                    **base,
                    "version_id": sheet["version_id"],
                    "source_file_id": pdf["file_id"],
                    "catalog_document_id": str(alias.pk) if alias else None,
                    "edition": edition,
                    "page_start": first,
                    "page_end": last,
                    "activity": "reading",
                    "deadline": str(deadline),
                    "deadline_source": subject["deadline_source"],
                    "subject_title": subject["title"],
                    "start_url": (
                        f"/materials/catalog/{alias.material_slug}/sheets/{alias.sheet_slug}/workspace"
                        f"?studyPage={first}&studyVersion={sheet['version_id']}"
                        f"&studyFile={pdf['file_id']}"
                    )
                    if alias
                    else None,
                }
                previous = key
                first = last + 1
                if len(units) + len(fixed) + len(review_units) > MAX_UNITS:
                    raise ValidationError(
                        {"syllabus": "This syllabus exceeds the preview size limit."}
                    )
    expired = [unit for unit in units if unit.deadline < today or unit.earliest > unit.deadline]
    blocked = {unit.key for unit in expired}
    # A dependent block cannot bypass an unplaceable prefix.
    changed = True
    while changed:
        changed = False
        for unit in units:
            if unit.key not in blocked and any(key in blocked for key in unit.requires):
                blocked.add(unit.key)
                changed = True
    pending = tuple(unit for unit in units if unit.key not in blocked)
    result = build_schedule_preview(pending, capacities, fixed + review_fixed)
    review_load: dict[date, int] = {}
    for assignment in reviews.assignments:
        review_load[assignment.day] = review_load.get(assignment.day, 0) + assignment.minutes
    assignments = [
        {
            **targets[item.key],
            "key": item.key,
            "scheduled_date": str(item.day),
            "estimated_minutes": item.minutes,
        }
        for item in (*reviews.assignments, *result.assignments)
    ]
    assignments.sort(
        key=lambda item: (
            item["scheduled_date"],
            item["activity"] != "review",
            item.get("subject_id", ""),
            item.get("version_id", ""),
            item.get("page_start", 0),
            item["key"],
        )
    )
    payload = {
        "schema_version": 1,
        "kind": "reading_and_review_preview" if include_reviews else "reading_only_preview",
        "planner_ready": False,
        "persisted": False,
        "exam": snapshot["exam"],
        "syllabus_fingerprint": snapshot["syllabus_fingerprint"],
        "computed_at": snapshot["computed_at"],
        "today": str(today),
        "profile_revision": profile.revision,
        "existing_plan_fingerprint": plan_fingerprint,
        "existing_activity_count": len(anchored),
        "report_id": str(report_id) if report_id else None,
        "review_truncated": truncated,
        "estimate": {
            "minutes_per_page": MINUTES_PER_PAGE,
            "source": "bootstrap",
            "confidence": "low",
        },
        "completed_reading_sheets": completed,
        "coverage_complete": not issues and not truncated,
        "issues": issues,
        "assignments": assignments,
        "unscheduled": [
            {
                **targets[item.key],
                "key": item.key,
                "estimated_minutes": item.minutes,
                "reason": item.reason,
            }
            for item in (*reviews.unscheduled, *result.unscheduled)
        ]
        + [
            {
                **targets[item.key],
                "key": item.key,
                "estimated_minutes": item.minutes,
                "reason": "deadline_before_horizon" if item.deadline < today else "outside_horizon",
            }
            for item in units
            if item.key in blocked
        ],
        "days": [
            {
                "date": str(day.day),
                "available_minutes": day.available,
                "existing_minutes": day.fixed - review_load.get(day.day, 0),
                "allocated_minutes": day.allocated + review_load.get(day.day, 0),
                "remaining_minutes": day.remaining,
                "existing_overflow_minutes": day.overflow,
            }
            for day in result.days
        ],
        "required_reading_minutes": sum(item.minutes for item in units),
        "scheduled_reading_minutes": sum(item.minutes for item in result.assignments),
        "required_review_minutes": sum(item.minutes for item in review_units),
        "scheduled_review_minutes": sum(item.minutes for item in reviews.assignments),
        "scope_notice": (
            "Only reading and mapped current Review Bank questions. "
            "Estimates are uncalibrated; this heuristic does not prove feasibility."
        ),
    }
    signed = {
        "user": str(user.pk),
        "period": str(period.pk),
        "edition": edition,
        "include_reviews": include_reviews,
        "report_id": str(report_id) if report_id else None,
        "preview": {k: v for k, v in payload.items() if k != "computed_at"},
    }
    payload["apply_token"] = salted_hmac(
        "study-plan-v2-apply", json.dumps(signed, sort_keys=True, default=str), algorithm="sha256"
    ).hexdigest()
    return payload
