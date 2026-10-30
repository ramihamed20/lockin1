"""Account-owned, retry-safe reports and conservative time calibration."""

import hashlib
import json
from math import ceil
from statistics import median
from typing import Any
from uuid import UUID

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User

from .models import StudyEvidence, StudyPlanItem
from .services import PlanChanged, plan_today, profile_for


def reading_estimate(user: User, version_ids: list[str], edition: str) -> dict[str, Any]:
    samples = list(
        StudyEvidence.objects.filter(
            user=user,
            content_version_id__in=version_ids,
            activity="reading",
            edition=edition,
            minutes__gt=0,
            page_start__isnull=False,
        ).order_by("-created_at")[:50]
    )
    rates = [
        row.minutes / (row.page_end - row.page_start + 1)
        for row in samples
        if row.page_end is not None and row.page_start is not None
    ]
    rates = [rate for rate in rates if 0.5 <= rate <= 30]
    return {
        "minutes_per_page": round(median(rates), 2) if len(rates) >= 3 else 5,
        "source": "self_reported_samples" if len(rates) >= 3 else "bootstrap",
        "confidence": "medium" if len(rates) >= 5 else "low",
        "sample_count": len(rates),
    }


def evidence_pages(user: User, version_id: str, file_id: str, edition: str) -> set[int]:
    result: set[int] = set()
    for first, last in StudyEvidence.objects.filter(
        user=user,
        content_version_id=UUID(version_id),
        source_file_id=UUID(file_id),
        edition=edition,
        activity="reading",
        page_start__isnull=False,
    ).values_list("page_start", "page_end"):
        if first is not None and last is not None:
            result.update(range(first, last + 1))
    return result


@transaction.atomic
def report_progress(
    *, user: User, task: StudyPlanItem | None, data: dict[str, Any]
) -> dict[str, Any]:
    User.objects.select_for_update().get(pk=user.pk)
    body = {key: value for key, value in data.items() if key != "period"}
    body["period_id"] = str(data["period"].pk)
    request_id = body.pop("client_request_id")
    digest = hashlib.sha256(
        json.dumps(
            {"task": str(task.pk) if task else None, **body}, sort_keys=True, default=str
        ).encode()
    ).hexdigest()
    previous = StudyEvidence.objects.filter(user=user, client_request_id=request_id).first()
    if previous:
        if previous.request_digest != digest:
            raise PlanChanged()
        return dict(previous.result)
    today = plan_today(profile_for(user))
    if task:
        task.refresh_from_db()
        if task.user_id != user.pk or body.pop("expected_revision") != task.revision:
            raise PlanChanged()
        if task.status != "planned":
            raise PlanChanged()
        if task.scheduled_date > today:
            raise ValidationError({"task": "Choose a current, unfinished task."})
        if task.activity != "reading" or task.page_start is None or task.page_end is None:
            raise ValidationError({"task": "Partial progress requires a reading task."})
        first = max(task.page_start, (task.completed_page_end or 0) + 1)
        last = body["page_end"]
        if not first <= last <= task.page_end:
            raise ValidationError({"page_end": "Choose pages inside the remaining task."})
        version_id, file_id, edition = task.content_version_id, task.source_file_id, task.edition
    else:
        first, last = body["page_start"], body["page_end"]
        version_id, file_id, edition = body["version_id"], body["file_id"], body["edition"]
    # Bind reports to the currently authorized syllabus and exact PDF edition.
    from .learning_snapshot import student_learning_snapshot

    snapshot = student_learning_snapshot(user=user, period=data["period"])
    pdf = next(
        (
            pdf
            for subject in snapshot["subjects"]
            for sheet in subject["sheets"]
            if sheet["version_id"] == str(version_id)
            for pdf in sheet["editions"]
            if pdf["file_id"] == str(file_id) and pdf["edition"] == edition
        ),
        None,
    )
    if (
        not pdf
        or not pdf["deliverable"]
        or not pdf["page_count"]
        or not 1 <= first <= last <= pdf["page_count"]
    ):
        raise ValidationError({"pages": "Refresh the plan: this PDF or page range changed."})
    body.pop("period_id", None)
    minutes = body.get("minutes", 0)
    reserve = minutes
    if task and not minutes:
        reserve = max(
            1,
            ceil(
                task.duration_minutes
                * (last - first + 1)
                / ((task.page_end or last) - (task.page_start or first) + 1)
            ),
        )
    row = StudyEvidence.objects.create(
        user=user,
        task=task,
        content_version_id=version_id,
        source_file_id=file_id,
        edition=edition,
        page_start=first,
        page_end=last,
        minutes=minutes,
        reserved_minutes=reserve,
        occurred_on=today,
        client_request_id=request_id,
        request_digest=digest,
    )
    if task:
        task.completed_page_end = last
        if last == task.page_end:
            task.status = "completed"
            task.completed_at = timezone.now()
            task.status_changed_at = task.completed_at
        task.revision += 1
        task.save()
    row.result = {
        "saved": True,
        "evidence_id": str(row.pk),
        "task_id": str(task.pk) if task else None,
        "page_start": first,
        "page_end": last,
        "revision": task.revision if task else None,
    }
    row.save(update_fields=["result"])
    return dict(row.result)


def remaining_minutes(item: StudyPlanItem) -> int:
    if item.activity == "reading" and item.page_start and item.page_end and item.completed_page_end:
        left = max(0, item.page_end - item.completed_page_end)
        return (
            max(5, ceil(item.duration_minutes * left / (item.page_end - item.page_start + 1)))
            if left
            else 0
        )
    return item.duration_minutes
