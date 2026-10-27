"""Atomic preview application. Every writer shares the account lock."""

import hashlib
import json
from typing import Any
from uuid import UUID

from django.db import transaction
from django.utils.crypto import constant_time_compare
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User

from .exam_models import ExamPeriod
from .models import PlannerRun, StudyPlanItem
from .reading_preview import reading_plan_preview
from .services import PlanChanged


@transaction.atomic
def apply_preview(
    *,
    user: User,
    period: ExamPeriod,
    client_request_id: UUID,
    preview_token: str,
    edition: str,
    include_reviews: bool = False,
    report_id: UUID | None = None,
) -> dict[str, Any]:
    User.objects.select_for_update().get(pk=user.pk)
    digest = hashlib.sha256(
        json.dumps(
            {
                "period": str(period.pk),
                "token": preview_token,
                "edition": edition,
                "reviews": include_reviews,
                "report": str(report_id) if report_id else None,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    previous = PlannerRun.objects.filter(user=user, client_request_id=client_request_id).first()
    if previous:
        if not constant_time_compare(previous.request_digest, digest):
            raise PlanChanged()
        return dict(previous.result)
    from .task_progress import reconcile_review_tasks

    reconcile_review_tasks(user)
    preview = reading_plan_preview(
        user=user,
        period=period,
        edition=edition,
        include_reviews=include_reviews,
        report_id=report_id,
    )
    if not constant_time_compare(preview_token, preview["apply_token"]):
        raise PlanChanged()
    tasks = preview["assignments"]
    if not tasks or len(tasks) > 3000:
        raise ValidationError({"preview": "Apply between 1 and 3000 activities at a time."})
    run = PlannerRun.objects.create(
        user=user, period=period, client_request_id=client_request_id, request_digest=digest
    )
    items = [
        StudyPlanItem(
            user=user,
            planner_run=run,
            planning_key=task["key"],
            catalog_subject_id=task["subject_id"],
            content_version_id=task.get("version_id"),
            catalog_document_id=task.get("catalog_document_id"),
            source_file_id=task.get("source_file_id"),
            review_item_id=task.get("review_item_id"),
            title=task["title"][:180],
            subject=task.get("subject_title", "")[:120],
            activity=task["activity"],
            edition=edition,
            page_start=task.get("page_start"),
            page_end=task.get("page_end"),
            scheduled_date=task["scheduled_date"],
            duration_minutes=task["estimated_minutes"],
            plan_mode="normal",
        )
        for task in tasks
    ]
    StudyPlanItem.objects.bulk_create(items, batch_size=200)
    run.result = {
        "persisted": True,
        "run_id": str(run.pk),
        "created_count": len(items),
        "item_ids": [str(item.pk) for item in items],
        "unscheduled_count": len(preview["unscheduled"]),
        "issues_count": len(preview["issues"]),
        "first_date": tasks[0]["scheduled_date"],
    }
    run.save(update_fields=["result"])
    return dict(run.result)
