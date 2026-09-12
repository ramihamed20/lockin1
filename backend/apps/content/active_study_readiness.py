"""Server-owned readiness decision for managed Active Study."""

from __future__ import annotations

from typing import cast

from .active_study import DIFFICULTIES, ActiveStudyPlanError, plan_payload
from .active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)
from .models import ActiveStudyQuestionContent, ActiveStudySettings, LearningObject


def _signature(plan: dict[str, object]) -> dict[str, object]:
    return {"number_of_parts": plan["number_of_parts"], "page_ranges": plan["page_ranges"]}


def readiness_payload(*, sheet: LearningObject) -> dict[str, object]:
    """Return student-safe status and an actionable administrator reason.

    PDF.js rendering is deliberately not a readiness input. Active Study uses
    configured page metadata and approved question content, not browser state.
    """
    settings: ActiveStudySettings | None = getattr(sheet, "active_study_settings", None)
    if not isinstance(settings, ActiveStudySettings):
        settings = None
    enabled = settings.enabled if settings is not None else False
    total_pages = settings.total_pdf_pages if settings is not None else None
    excluded_start = settings.excluded_start_pages if settings is not None else 0
    excluded_end = settings.excluded_end_pages if settings is not None else 0
    content_by_difficulty = {
        content.difficulty: content
        for content in ActiveStudyQuestionContent.objects.filter(sheet=sheet)
    }
    plan: dict[str, object] | None = None
    plan_error: str | None = None
    if total_pages is not None:
        try:
            plan = plan_payload(
                total_pdf_pages=total_pages,
                excluded_start_pages=excluded_start,
                excluded_end_pages=excluded_end,
            )
        except ActiveStudyPlanError as error:
            plan_error = str(error)
    plans = {
        str(item["difficulty"]): item
        for item in cast(list[dict[str, object]], plan["difficulties"] if plan else [])
    }

    rows: list[dict[str, object]] = []
    for rule in DIFFICULTIES:
        plan_item = plans.get(rule.key)
        row = (
            dict(plan_item)
            if plan_item
            else {
                "difficulty": rule.key,
                "target_pages_per_part": rule.target_pages_per_part,
                "questions_per_checkpoint": rule.questions_per_checkpoint,
                "final_exam_questions": rule.final_exam_questions,
                "number_of_parts": 0,
                "page_ranges": [],
            }
        )
        status, reason = "not_configured", "Active Study is disabled."
        content = content_by_difficulty.get(rule.key)
        if not enabled:
            # Disabled sheets stay unavailable. Still surface a stale imported
            # plan when page boundaries changed, so later enabling is explicit.
            if (
                total_pages is not None
                and plan_error is None
                and plan_item is not None
                and bool(plan_item["page_ranges"])
                and content is not None
                and content.plan_signature != _signature(plan_item)
            ):
                status, reason = (
                    "needs_review",
                    "Page ranges changed; revalidate and reimport questions.",
                )
        elif total_pages is None:
            reason = "PDF page count is missing."
        elif plan_error:
            reason = plan_error
        elif plan_item is None or not plan_item["page_ranges"]:
            reason = "No study page ranges could be generated."
        elif content is None:
            reason = "Questions have not been imported for this difficulty."
        elif content.plan_signature != _signature(plan_item):
            status, reason = (
                "needs_review",
                "Page ranges changed; revalidate and reimport questions.",
            )
        else:
            try:
                validate_active_study_questions(
                    content.payload,
                    difficulty=rule,
                    number_of_parts=cast(int, plan_item["number_of_parts"]),
                )
                status, reason = "ready", "Ready."
            except ActiveStudyQuestionValidationError as error:
                detail = error.errors[0]["message"] if error.errors else "Questions are incomplete."
                reason = f"Questions are incomplete: {detail}"
        row["readiness"] = {"ready": status == "ready", "status": status, "reason": reason}
        rows.append(row)

    return {
        "enabled": enabled,
        "total_pdf_pages": total_pages,
        "excluded_start_pages": excluded_start,
        "excluded_end_pages": excluded_end,
        "eligible_study_pages": plan["eligible_study_pages"] if plan else None,
        "difficulties": rows,
    }
