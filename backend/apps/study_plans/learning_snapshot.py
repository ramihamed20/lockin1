"""Read-only adapter between the planner and authoritative learning domains."""

import hashlib
import json
from typing import Any
from uuid import UUID

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.content.editions import PRIMARY_ROLE_BY_EDITION, UNIVERSITY
from apps.content.planning import planning_catalog_positions, published_planning_sheets
from apps.files.services import managed_file_delivery_ready
from apps.focus.selectors import planning_active_study_evidence, planning_reader_positions
from apps.progress.selectors import planning_reading_progress
from apps.review.selectors import planning_review_summary

from .exam_models import ExamPeriod, ExamSchedule
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
    )


def exam_payload(period: ExamPeriod) -> dict[str, Any]:
    return {
        "id": str(period.id),
        "title": period.title,
        "kind": period.kind,
        "institution_id": str(period.institution_id),
        "cohort_id": str(period.cohort_id),
        "starts_on": period.starts_on.isoformat(),
        "ends_on": period.ends_on.isoformat() if period.ends_on else None,
        "status": period.status,
    }


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
    scopes = list(
        period.syllabus_scopes.filter(
            subject__cohort_id=user.cohort_id,
            subject__is_active=True,
            subject__source_node__is_discoverable=True,
            subject__source_node__path__startswith=period.institution.path,
        )
        .select_related("subject__source_node")
        .prefetch_related("sheets")
        .order_by("subject__position", "subject_id", "id")
    )
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
    schedules = [
        schedule
        for schedule in period.schedules.select_related("subject__source_node")
        if _valid_schedule(schedule, period)
    ]
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
                "include_future_sheets": scope.include_future_sheets,
                "schedules": [
                    {
                        "id": str(s.id),
                        "exam_type": s.exam_type,
                        "scheduled_on": s.scheduled_on.isoformat(),
                        "status": s.status,
                    }
                    for s in subject_exams
                ],
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
                "exam": exam_payload(period),
                "inventory": inventory,
                "scopes": [
                    {
                        "subject_id": str(scope.subject_id),
                        "future": scope.include_future_sheets,
                    }
                    for scope in scopes
                ],
                "schedules": [
                    {
                        "id": str(s.id),
                        "date": str(s.scheduled_on),
                        "status": s.status,
                        "type": s.exam_type,
                        "subject_id": str(s.subject_id),
                    }
                    for s in schedules
                ],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "schema_version": 1,
        "computed_at": now,
        "today": today,
        "exam": exam_payload(period),
        "days_until_period_start": (period.starts_on - today).days,
        "syllabus_fingerprint": fingerprint,
        "sheet_count": len(sheets),
        "subjects": result,
        "mastery": None,
        "planner_ready": False,
    }
