"""Read-only adapter between the planner and authoritative learning domains."""

import hashlib
import json
from datetime import date
from typing import Any
from uuid import UUID

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.content.added_subjects import added_subjects, can_add_subjects
from apps.content.editions import PRIMARY_ROLE_BY_EDITION, UNIVERSITY
from apps.content.planning import planning_catalog_positions, published_planning_sheets
from apps.files.services import managed_file_delivery_ready
from apps.focus.selectors import planning_active_study_evidence, planning_reader_positions
from apps.progress.selectors import planning_reading_progress
from apps.review.selectors import planning_review_summary

from .exam_models import ExamPeriod, ExamSchedule, ExamSyllabusScope, valid_carryover_pair
from .models import StudySheetDifficulty
from .services import plan_today, profile_for


def student_exam_periods(*, user: User) -> QuerySet[ExamPeriod]:
    if user.cohort_id is None:
        return ExamPeriod.objects.none()
    today = plan_today(profile_for(user))
    return (
        ExamPeriod.objects.filter(
            cohort_id=user.cohort_id,
            cohort__is_active=True,
            cohort__program__is_active=True,
            institution__kind="institution",
            institution__is_discoverable=True,
            status__in=(ExamPeriod.Status.TENTATIVE, ExamPeriod.Status.CONFIRMED),
        )
        .filter(
            Q(starts_on__gte=today)
            | Q(ends_on__gte=today)
            | Q(
                schedules__scheduled_on__gte=today, schedules__status__in=("tentative", "confirmed")
            )
        )
        .distinct()
        .select_related(
            "institution",
            "cohort__program",
            "carryover_period__cohort__program",
            "carryover_period__institution",
        )
    )


def carryover_exam_period(*, user: User, period: ExamPeriod) -> ExamPeriod | None:
    source = period.carryover_period
    if (
        source is None
        or period.cohort_id != user.cohort_id
        or not can_add_subjects(user)
        or not valid_carryover_pair(period, source)
        or not source.cohort.is_active
        or not source.cohort.program.is_active
        or source.status not in ("tentative", "confirmed")
        or not source.institution.is_discoverable
    ):
        return None
    return source


def exam_scopes(*, user: User, period: ExamPeriod) -> list[ExamSyllabusScope]:
    condition = Q(period=period, subject__cohort_id=user.cohort_id)
    source = carryover_exam_period(user=user, period=period)
    if source is not None:
        condition |= Q(period=source, subject__in=added_subjects(user))
    return list(
        ExamSyllabusScope.objects.filter(
            condition,
            subject__is_active=True,
            subject__source_node__is_discoverable=True,
            subject__source_node__path__startswith=period.institution.path,
        )
        .select_related("subject__source_node", "period")
        .prefetch_related("sheets")
        .order_by("subject__cohort__position", "subject__position", "subject_id", "id")
    )


def student_exam_schedules(*, user: User, period: ExamPeriod) -> list[ExamSchedule]:
    return student_exam_schedules_for_periods(user=user, periods=[period])


def student_exam_schedules_for_periods(
    *, user: User, periods: list[ExamPeriod]
) -> list[ExamSchedule]:
    own_ids = [period.pk for period in periods if period.cohort_id == user.cohort_id]
    source_ids = [
        source.pk
        for period in periods
        if (source := carryover_exam_period(user=user, period=period)) is not None
    ]
    condition = Q(period_id__in=own_ids, subject__cohort_id=user.cohort_id)
    if source_ids:
        condition |= Q(period_id__in=source_ids, subject__in=added_subjects(user))
    schedules = (
        ExamSchedule.objects.filter(condition)
        .select_related("subject__source_node", "period__institution")
        .order_by("scheduled_on", "starts_at", "id")
    )
    return [schedule for schedule in schedules if _valid_schedule(schedule, schedule.period)]


def exam_payload(
    period: ExamPeriod, *, user: User, schedules: list[ExamSchedule] | None = None
) -> dict[str, Any]:
    if schedules is None:
        schedules = student_exam_schedules(user=user, period=period)
    source = carryover_exam_period(user=user, period=period)
    carried = (
        list(
            added_subjects(user).filter(
                exam_syllabus_scopes__period=source,
                source_node__is_discoverable=True,
                source_node__path__startswith=period.institution.path,
            )
        )
        if source
        else []
    )
    return {
        "id": str(period.id),
        "title": period.title,
        "kind": period.kind,
        "institution_id": str(period.institution_id),
        "cohort_id": str(period.cohort_id),
        "starts_on": period.starts_on.isoformat(),
        "ends_on": period.ends_on.isoformat() if period.ends_on else None,
        "status": period.status,
        "carryover_enabled": source is not None,
        "carried_subjects": [
            {"id": str(subject.id), "title": subject.title} for subject in carried
        ],
        "first_exam_on": min([period.starts_on, *[s.scheduled_on for s in schedules]]).isoformat(),
        "schedules": [
            {
                **schedule_payload(schedule),
                "subject_id": str(schedule.subject_id),
                "subject_title": schedule.subject.title,
                "is_carryover": schedule.period_id != period.pk,
            }
            for schedule in schedules
        ],
    }


def schedule_payload(schedule: ExamSchedule) -> dict[str, Any]:
    return {
        "id": str(schedule.id),
        "exam_type": schedule.exam_type,
        "scheduled_on": schedule.scheduled_on.isoformat(),
        "starts_at": schedule.starts_at.isoformat() if schedule.starts_at else None,
        "ends_at": schedule.ends_at.isoformat() if schedule.ends_at else None,
        "timezone": schedule.timezone,
        "status": schedule.status,
    }


def subject_exam_date(subject: dict[str, Any], period: ExamPeriod) -> date:
    return min(
        (date.fromisoformat(row["scheduled_on"]) for row in subject["schedules"]),
        default=date.fromisoformat(subject.get("exam_period_starts_on", str(period.starts_on))),
    )


def _valid_schedule(schedule: ExamSchedule, period: ExamPeriod) -> bool:
    node = schedule.subject.source_node
    return bool(
        schedule.subject.cohort_id == period.cohort_id
        and node is not None
        and node.path.startswith(period.institution.path)
        and schedule.subject.is_active
        and node.is_discoverable
        and schedule.status in (ExamPeriod.Status.TENTATIVE, ExamPeriod.Status.CONFIRMED)
        and schedule.scheduled_on >= period.starts_on
        and (period.ends_on is None or schedule.scheduled_on <= period.ends_on)
    )


def student_learning_snapshot(*, user: User, period: ExamPeriod) -> dict[str, Any]:
    """The caller resolves the period through student_exam_periods first.

    This computes an inventory and evidence only. It never generates tasks,
    completes sessions, awards XP or infers understanding from reading time.
    """
    if not student_exam_periods(user=user).filter(pk=period.pk).exists():
        raise ExamPeriod.DoesNotExist
    now = timezone.now()
    today = plan_today(profile_for(user))
    scopes = exam_scopes(user=user, period=period)
    subjects = [scope.subject for scope in scopes]
    grouped = published_planning_sheets(user=user, subjects=subjects)
    explicit_ids = {scope.id: {sheet.pk for sheet in scope.sheets.all()} for scope in scopes}
    selected = {
        scope.subject_id: [
            sheet
            for sheet in grouped[scope.subject_id]
            if scope.include_future_sheets or sheet.pk in explicit_ids[scope.id]
        ]
        for scope in scopes
    }
    sheets = {sheet.pk: sheet for values in selected.values() for sheet in values}
    difficulty_levels = dict(
        StudySheetDifficulty.objects.filter(sheet_id__in=sheets).values_list("sheet_id", "level")
    )
    version_ids = [
        sheet.published_version_id
        for sheet in sheets.values()
        if sheet.published_version_id is not None
    ]
    reading = planning_reading_progress(user=user, version_ids=version_ids)
    positions = planning_reader_positions(user_id=user.pk, version_ids=version_ids)
    legacy_positions = planning_catalog_positions(user=user, version_ids=version_ids)
    for version_id, rows in legacy_positions.items():
        positions.setdefault(version_id, []).extend(rows)
    active = planning_active_study_evidence(user_id=user.pk, sheet_ids=list(sheets))
    schedules = student_exam_schedules(user=user, period=period)
    period_payload = exam_payload(period, user=user, schedules=schedules)
    result: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    for scope in scopes:
        subject = scope.subject
        subject_sheets = selected[subject.id]
        entries: list[dict[str, Any]] = []
        node_ids: set[UUID] = {subject.source_node_id} if subject.source_node_id else set()
        for sheet in subject_sheets:
            version = sheet.published_version
            if version is None:
                continue
            node_ids.add(version.academic_node_id)
            editions = []
            for edition, role in PRIMARY_ROLE_BY_EDITION.items():
                asset = next((asset for asset in version.assets.all() if asset.role == role), None)
                if asset is None:
                    continue
                # Page counts belong to an edition, never to both PDFs together.
                pages = asset.managed_file.pdf_page_count
                if pages is None and edition == UNIVERSITY:
                    pages = version.page_count
                editions.append(
                    {
                        "edition": edition,
                        "file_id": str(asset.managed_file_id),
                        "page_count": pages,
                        "deliverable": managed_file_delivery_ready(asset.managed_file),
                    }
                )
            anchor = {
                "sheet_id": str(sheet.id),
                "version_id": str(version.id),
                "title": version.title,
                "difficulty_level": difficulty_levels.get(sheet.pk, 3),
                "editions": editions,
            }
            entries.append(
                {
                    **anchor,
                    "reading": reading.get(version.id),
                    "reader_positions": [
                        position
                        for position in positions.get(version.id, [])
                        if position["file_id"] in {edition["file_id"] for edition in editions}
                    ],
                    "active_study": active.get(sheet.id, []),
                }
            )
            inventory.append({"subject_id": str(subject.id), **anchor})
        subject_exams = [s for s in schedules if s.subject_id == subject.id]
        result.append(
            {
                "subject_id": str(subject.id),
                "title": subject.title,
                "material_slug": subject.material_slug,
                "is_carryover": scope.period_id != period.pk,
                "exam_period_id": str(scope.period_id),
                "exam_period_starts_on": scope.period.starts_on.isoformat(),
                "include_future_sheets": scope.include_future_sheets,
                "schedules": [schedule_payload(s) for s in subject_exams],
                "deadline_source": "subject_schedule" if subject_exams else "period_start",
                "sheets": entries,
                "review": planning_review_summary(
                    user=user,
                    node_ids=list(node_ids),
                    material_slug=subject.material_slug,
                    sheet_ids=[sheet.pk for sheet in subject_sheets],
                    now=now,
                ),
            }
        )
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "exam": period_payload,
                "inventory": inventory,
                "scopes": [
                    {
                        "subject_id": str(scope.subject_id),
                        "future": scope.include_future_sheets,
                        "period_id": str(scope.period_id),
                        "starts_on": scope.period.starts_on.isoformat(),
                    }
                    for scope in scopes
                ],
                "schedules": [
                    {**schedule_payload(s), "subject_id": str(s.subject_id)} for s in schedules
                ],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "schema_version": 1,
        "computed_at": now,
        "today": today,
        "exam": period_payload,
        "days_until_period_start": (period.starts_on - today).days,
        "syllabus_fingerprint": fingerprint,
        "sheet_count": len(sheets),
        "subjects": result,
        "mastery": None,
        "planner_ready": False,
    }
