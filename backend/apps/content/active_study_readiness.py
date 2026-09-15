"""Server-owned readiness decision for managed Active Study."""

from __future__ import annotations

from typing import cast

from .active_study import (
    DIFFICULTIES,
    ActiveStudyPlanError,
    plan_payload,
    unplanned_difficulty,
)
from .active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)
from .models import ActiveStudySettings, LearningObject


def _signature(plan: dict[str, object]) -> dict[str, object]:
    return {"number_of_parts": plan["number_of_parts"], "page_ranges": plan["page_ranges"]}


def resolve_total_pdf_pages(
    *, settings: ActiveStudySettings | None, source_version: object | None
) -> tuple[int | None, str | None]:
    """Return the page count to plan with, and where it came from.

    A configured count wins.  When Admin never entered one, the uploaded PDF's
    own page count is used instead, so a sheet with a readable PDF always plans
    a positive number of parts rather than falling back to zero.
    """

    configured = settings.total_pdf_pages if settings is not None else None
    if configured is not None:
        return configured, "configured"
    derived = getattr(source_version, "page_count", None) if source_version is not None else None
    if isinstance(derived, int) and derived > 0:
        return derived, "pdf"
    return None, None


def readiness_payload(*, sheet: LearningObject) -> dict[str, object]:
    """Return student-safe status and an actionable administrator reason.

    PDF.js rendering is deliberately not a readiness input. Active Study uses
    configured page metadata and approved question content, not browser state.
    """
    settings: ActiveStudySettings | None = getattr(sheet, "active_study_settings", None)
    if not isinstance(settings, ActiveStudySettings):
        settings = None
    enabled = settings.enabled if settings is not None else False
    excluded_start = settings.excluded_start_pages if settings is not None else 0
    excluded_end = settings.excluded_end_pages if settings is not None else 0
    content_by_difficulty = {
        content.difficulty: content for content in sheet.active_study_question_content.all()
    }
    source_version = sheet.published_version or sheet.current_version
    total_pages, total_pages_source = resolve_total_pdf_pages(
        settings=settings, source_version=source_version
    )
    settings_stale = bool(
        settings is not None
        and settings.source_version_id is not None
        and (source_version is None or settings.source_version_id != source_version.id)
    )
    page_count_stale = bool(
        settings is not None
        and settings.total_pdf_pages is not None
        and source_version is not None
        and source_version.page_count is not None
        and settings.total_pdf_pages != source_version.page_count
    )
    plan: dict[str, object] | None = None
    plan_error: str | None = None
    if total_pages is None:
        plan_error = "PDF page count is missing."
    else:
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
            else unplanned_difficulty(
                difficulty=rule, reason=plan_error or "No study page ranges could be generated."
            )
        )
        status, reason = "not_configured", "Active Study is disabled."
        content = content_by_difficulty.get(rule.key)
        content_stale = bool(
            content is not None
            and content.source_version_id is not None
            and (source_version is None or content.source_version_id != source_version.id)
        )
        if settings_stale or page_count_stale or content_stale:
            status, reason = (
                "needs_review",
                "The source PDF changed; verify pagination and reimport questions.",
            )
        elif plan_error and (enabled or settings is not None):
            # A broken plan is an administrator problem whether or not the sheet
            # is enabled, so a configured sheet reports it instead of the
            # generic disabled text.  A sheet nobody has configured stays plain.
            reason = plan_error
        elif not enabled:
            # Disabled sheets stay unavailable. Still surface a stale imported
            # plan when page boundaries changed, so later enabling is explicit.
            if (
                plan_item is not None
                and bool(plan_item["page_ranges"])
                and content is not None
                and content.plan_signature != _signature(plan_item)
            ):
                status, reason = (
                    "needs_review",
                    "Page ranges changed; revalidate and reimport questions.",
                )
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
        "source_version_id": str(settings.source_version_id) if settings else None,
        "current_version_id": str(source_version.id) if source_version else None,
        "total_pdf_pages": total_pages,
        "total_pdf_pages_source": total_pages_source,
        "configured_total_pdf_pages": settings.total_pdf_pages if settings else None,
        "pdf_total_pdf_pages": (source_version.page_count if source_version is not None else None),
        "excluded_start_pages": excluded_start,
        "excluded_end_pages": excluded_end,
        "eligible_study_pages": plan["eligible_study_pages"] if plan else None,
        "plan_error": plan_error,
        "difficulties": rows,
    }
