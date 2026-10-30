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
    include_active_study: bool = False,
    include_questions: bool = False,
    replan: bool = False,
    difficulty: str = "medium",
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
                "active": include_active_study,
                "questions": include_questions,
                "replan": replan,
                "difficulty": difficulty,
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
        include_active_study=include_active_study,
        include_questions=include_questions,
        replan=replan,
        difficulty=difficulty,
    )
    if not constant_time_compare(preview_token, preview["apply_token"]):
        raise PlanChanged()
    tasks = preview["assignments"]
    replaced = list(
        StudyPlanItem.objects.filter(
            user=user,
            pk__in=preview.get("replace_item_ids", []),
            status="planned",
            pinned=False,
            planner_run__period=period,
        )
    )
    if (not tasks and not replaced) or len(tasks) > 3000:
        raise ValidationError({"preview": "Apply between 1 and 3000 activities at a time."})
    run = PlannerRun.objects.create(
        user=user, period=period, client_request_id=client_request_id, request_digest=digest
    )
    history = [
        {
            "id": str(item.pk),
            "title": item.title,
            "date": str(item.scheduled_date),
            "minutes": item.duration_minutes,
            "activity": item.activity,
            "key": item.planning_key,
            "revision": item.revision,
        }
        for item in replaced
    ]
    if replaced:
        StudyPlanItem.objects.filter(pk__in=[item.pk for item in replaced]).update(
            status="superseded",
            planning_key=None,
            generated_slot=None,
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
            difficulty=task.get("difficulty", difficulty),
            question_ids=task.get("question_ids", []),
            question_source=task.get("question_source", ""),
            priority_reasons=task.get("priority_reasons", []),
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
        "syllabus_fingerprint": preview["syllabus_fingerprint"],
        "question_fingerprint": preview["question_inventory"].get("fingerprint"),
        "includes_questions": include_questions,
        "issues_count": len(preview["issues"]),
        "first_date": tasks[0]["scheduled_date"] if tasks else preview["today"],
        "replaced_count": len(replaced),
        "previous_tasks": history,
    }
    run.save(update_fields=["result"])
    return dict(run.result)
