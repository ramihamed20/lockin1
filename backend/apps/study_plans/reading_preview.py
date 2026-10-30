"""Authorized reading/review preview. No writes, automatic grading, or XP."""

import hashlib
import json
from datetime import date, timedelta
from math import ceil
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.content.models import CatalogDocument
from apps.review.planning import planning_review_targets

from .adaptive_habits import adaptive_capacity, difficulty_multiplier, habit_snapshot
from .availability import preference_priority
from .evidence import reading_estimate, remaining_minutes
from .exam_models import ExamPeriod
from .learning_snapshot import student_learning_snapshot
from .models import StudyEvidence, StudyPlanItem
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
    include_active_study: bool = False,
    include_questions: bool = False,
    replan: bool = False,
    difficulty: str = "medium",
) -> dict[str, Any]:
    snapshot = student_learning_snapshot(user=user, period=period)
    if not snapshot["subjects"]:
        raise ValidationError({"syllabus": "No subjects have been assigned to this exam yet."})
    profile = profile_for(user)
    if profile._state.adding or profile.mode != "normal":
        raise ValidationError({"profile": "Save a Normal plan with your available time first."})
    today = plan_today(profile)
    habit = habit_snapshot(user=user, profile=profile, today=today)
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
            adaptive_capacity(profile, today + timedelta(days=i), today, habit)
            if today + timedelta(days=i) not in exam_dates
            else 0,
        )
        for i in range((end - today).days + 1)
    )
    existing = list(
        StudyPlanItem.objects.filter(user=user)
        .exclude(status="superseded")
        .select_related("planner_run")
        .filter(Q(scheduled_date__range=(today, end)) | Q(planning_key__isnull=False))
        .order_by("id")[: MAX_UNITS + 1]
    )
    if len(existing) > MAX_UNITS:
        raise ValidationError({"syllabus": "This plan exceeds the preview size limit."})
    replaceable = [
        item
        for item in existing
        if replan
        and item.planner_run is not None
        and item.planner_run.period_id == period.pk
        and item.edition == edition
        and item.status == "planned"
        and not item.pinned
        and item.planning_key
    ]
    replace_ids = {item.pk for item in replaceable}
    preserved = [item for item in existing if item.pk not in replace_ids]
    fixed = tuple(
        FixedWork(f"existing:{item.pk}", item.scheduled_date, remaining_minutes(item))
        for item in preserved
        if today <= item.scheduled_date <= end and remaining_minutes(item) > 0
    )
    spent = sum(
        StudyEvidence.objects.filter(user=user, occurred_on=today).values_list(
            "reserved_minutes", flat=True
        )
    )
    fixed += tuple(
        FixedWork(f"spent:{index}", today, min(480, spent - index * 480))
        for index in range(ceil(spent / 480))
    )
    plan_fingerprint = hashlib.sha256(
        json.dumps([(str(item.pk), item.revision) for item in existing]).encode()
    ).hexdigest()
    anchored = [item for item in preserved if item.planning_key]
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
            user=user,
            subjects=snapshot["subjects"],
            report_id=report_id,
            due_before=end,
            zone=ZoneInfo(profile.timezone),
        )
        for target in rows:
            if target["review_item_id"] in planned_reviews or target["key"] in existing_keys:
                continue
            subject = subjects[target["subject_id"]]
            deadline = min(
                (date.fromisoformat(exam["scheduled_on"]) for exam in subject["schedules"]),
                default=period.starts_on,
            ) - timedelta(days=1)
            due_on = date.fromisoformat(target["due_on"])
            if due_on > deadline and not report_id:
                continue
            review_units.append(
                WorkUnit(
                    target["key"],
                    profile.review_minutes,
                    min(deadline, max(today, due_on)) if not report_id else min(today, deadline),
                    deadline,
                    priority=target["mistake_count"],
                    category="review",
                    subject=target["subject_id"],
                )
            )
            targets[target["key"]] = {**target, "deadline": str(deadline)}
    if len(review_units) + len(fixed) > MAX_UNITS:
        raise ValidationError({"syllabus": "This plan exceeds the preview size limit."})
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
    issues: list[dict[str, Any]] = []
    confirmed_by_target: dict[tuple[str, str], set[int]] = {}
    version_ids = [
        sheet["version_id"] for subject in snapshot["subjects"] for sheet in subject["sheets"]
    ]
    for version_id, file_id, first_page, last_page in StudyEvidence.objects.filter(
        user=user,
        content_version_id__in=version_ids,
        edition=edition,
        activity="reading",
        page_start__isnull=False,
        page_end__isnull=False,
    ).values_list("content_version_id", "source_file_id", "page_start", "page_end"):
        if first_page is not None and last_page is not None:
            confirmed_by_target.setdefault((str(version_id), str(file_id)), set()).update(
                range(first_page, last_page + 1)
            )
    completed = 0
    subject_estimates = {
        subject["subject_id"]: {
            **reading_estimate(user, [sheet["version_id"] for sheet in subject["sheets"]], edition),
            "subject_title": subject["title"],
        }
        for subject in snapshot["subjects"]
    }
    active_units: list[WorkUnit] = []
    positive_capacity = [day.minutes for day in capacities if day.minutes > 0]
    block_limit = min(
        profile.session_minutes, habit["suggested_block_minutes"],
        max(positive_capacity, default=profile.session_minutes)
    )
    for subject in snapshot["subjects"]:
        deadline = min(
            (date.fromisoformat(exam["scheduled_on"]) for exam in subject["schedules"]),
            default=period.starts_on,
        ) - timedelta(days=1)
        estimate = subject_estimates[subject["subject_id"]]
        rate = estimate["minutes_per_page"]
        for sheet in subject["sheets"]:
            level = sheet.get("difficulty_level", 3)
            sheet_rate = round(rate * difficulty_multiplier(level), 2)
            block_pages = max(1, int(block_limit // sheet_rate))
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
            confirmed = confirmed_by_target.get((sheet["version_id"], pdf["file_id"]), set())
            if reading and reading["completion_percent"] > 0 and not confirmed:
                issues.append(
                    {
                        **base,
                        "reason": "partial_reading_needs_confirmation",
                        "version_id": sheet["version_id"],
                        "file_id": pdf["file_id"],
                        "edition": edition,
                        "page_count": pages,
                    }
                )
                continue
            covered: set[int] = set(confirmed)
            if len(covered.intersection(range(1, pages + 1))) == pages:
                completed += 1
                continue
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
                key = f"reading:{sheet['version_id']}:{pdf['file_id']}:{edition}:{first}-{last}"
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
                        max(5, ceil((last - first + 1) * sheet_rate)),
                        earliest,
                        deadline,
                        priority=preference_priority(profile, subject["title"]) * 100 - first,
                        category="reading",
                        subject=subject["subject_id"],
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
                    "estimate": estimate,
                    "difficulty_level": level,
                    "estimated_minutes_per_page": sheet_rate,
                    "priority_reasons": ["unread_pages", "exam_preparation"],
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
    if include_active_study:
        from .active_preview import add_active_units

        add_active_units(
            user=user,
            snapshot=snapshot,
            edition=edition,
            difficulty=difficulty,
            profile=profile,
            today=today,
            period=period,
            aliases=aliases,
            anchored=anchored,
            existing_keys=existing_keys,
            units=units,
            targets=targets,
            fixed_count=len(fixed) + len(review_units),
            issues=issues,
        )
    question_inventory = {"available": 0, "answered": 0, "remaining": 0, "by_source": {}}
    if include_questions:
        from .question_preview import add_question_units

        question_inventory = add_question_units(
            user=user, snapshot=snapshot, today=today, period=period,
            anchored=anchored, units=units, targets=targets,
            limit=MAX_UNITS - len(fixed) - len(review_units),
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
    result = build_schedule_preview(
        (*pending, *review_units, *active_units), capacities, fixed, balanced=True
    )
    assignments = [
        {
            **targets[item.key],
            "key": item.key,
            "scheduled_date": str(item.day),
            "estimated_minutes": item.minutes,
        }
        for item in result.assignments
    ]
    # The average is an estimate for the activities covered by this preview,
    # not a promise that all Normal/Final question banks have been included.
    preparation_days = sum(day.minutes > 0 for day in capacities)
    required_minutes = sum(unit.minutes for unit in units) + sum(
        unit.minutes for unit in review_units
    ) + sum(item.minutes for item in fixed)
    habit = {
        **habit,
        "target_today_minutes": capacities[0].minutes,
        "required_daily_minutes": ceil(required_minutes / preparation_days)
        if preparation_days else None,
        "preparation_days": preparation_days,
        "estimated_workload_minutes": required_minutes,
        "estimate_scope": (
            "reading_active_review_catalog_questions" if include_questions
            else "reading_active_review_only"
        ),
    }
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
        "replace_item_ids": [str(item.pk) for item in replaceable],
        "replan": replan,
        "include_active_study": include_active_study,
        "include_questions": include_questions,
        "question_inventory": question_inventory,
        "difficulty": difficulty,
        "subject_estimates": subject_estimates,
        "habit": habit,
        "review_minutes_per_question": profile.review_minutes,
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
            for item in result.unscheduled
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
                "existing_minutes": day.fixed,
                "allocated_minutes": day.allocated,
                "remaining_minutes": day.remaining,
                "existing_overflow_minutes": day.overflow,
            }
            for day in result.days
        ],
        "required_reading_minutes": sum(
            item.minutes for item in units if targets[item.key]["activity"] == "reading"
        ),
        "required_active_study_minutes": sum(
            item.minutes for item in units if targets[item.key]["activity"] == "active_study"
        ),
        "scheduled_active_study_minutes": sum(
            item.minutes
            for item in result.assignments
            if targets[item.key]["activity"] == "active_study"
        ),
        "scheduled_reading_minutes": sum(
            item.minutes
            for item in result.assignments
            if targets[item.key]["activity"] == "reading"
        ),
        "required_question_minutes": sum(
            item.minutes for item in units if targets[item.key]["activity"] == "questions"
        ),
        "scheduled_question_minutes": sum(
            item.minutes for item in result.assignments
            if targets[item.key]["activity"] == "questions"
        ),
        "required_review_minutes": sum(item.minutes for item in review_units),
        "scheduled_review_minutes": sum(
            item.minutes for item in result.assignments if targets[item.key]["activity"] == "review"
        ),
        "scope_notice": (
            "Reading, selected catalog sheet/past-exam questions, Active Study and Review. "
            "Other final banks remain out of scope. Estimates do not prove feasibility."
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
