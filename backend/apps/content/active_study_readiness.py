"""Server-owned readiness decision for managed Active Study.

A sheet has one question bank and two editions of the PDF it is read from. The
university edition decides how many parts each difficulty has; the Lock-in
edition splits its own pages into that same number, so one set of questions
stays correct for both and is never imported twice.
"""

from __future__ import annotations

from typing import cast

from .active_study import DIFFICULTIES, ActiveStudyPlanError, plan_payload, unplanned_difficulty
from .active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)
from .editions import LOCKIN, UNIVERSITY, normalize_edition, primary_role
from .models import ActiveStudySettings, LearningObject, LearningObjectVersion

# Shown wherever the Lock-in edition cannot be planned because the edition it
# takes its structure from has not been configured.
UNIVERSITY_FIRST = (
    "Configure the University Sheet's Active Study pages first; the Lockin Sheet "
    "follows its part count."
)


def _signature(plan: dict[str, object]) -> dict[str, object]:
    return {"number_of_parts": plan["number_of_parts"], "page_ranges": plan["page_ranges"]}


def settings_for(*, sheet: LearningObject, edition: str) -> ActiveStudySettings | None:
    """The one edition's saved Active Study settings, if any.

    Reads through the related set so a caller that prefetched it keeps its
    single query.
    """

    wanted = normalize_edition(edition)
    for row in sheet.active_study_settings_set.all():
        if row.edition == wanted:
            return row
    return None


def edition_version_page_count(
    *, source_version: LearningObjectVersion | None, edition: str
) -> int | None:
    """The uploaded PDF's own page count for this edition.

    The university edition records it on the version; the Lock-in edition reads
    it from its own asset, so each edition derives from the file a student
    actually opens.
    """

    if source_version is None:
        return None
    if normalize_edition(edition) == UNIVERSITY:
        count = source_version.page_count
        return count if isinstance(count, int) and count > 0 else None
    asset = next(
        (item for item in source_version.assets.all() if item.role == primary_role(LOCKIN)),
        None,
    )
    count = asset.managed_file.pdf_page_count if asset is not None else None
    return count if isinstance(count, int) and count > 0 else None


def resolve_total_pdf_pages(
    *,
    settings: ActiveStudySettings | None,
    source_version: LearningObjectVersion | None,
    edition: str = UNIVERSITY,
) -> tuple[int | None, str | None]:
    """Return the page count to plan with, and where it came from.

    A configured count wins.  When Admin never entered one, the uploaded PDF's
    own page count is used instead, so a sheet with a readable PDF always plans
    a positive number of parts rather than falling back to zero.
    """

    configured = settings.total_pdf_pages if settings is not None else None
    if configured is not None:
        return configured, "configured"
    derived = edition_version_page_count(source_version=source_version, edition=edition)
    if derived is not None:
        return derived, "pdf"
    return None, None


def edition_plan(
    *,
    sheet: LearningObject,
    edition: str,
    source_version: LearningObjectVersion | None = None,
    parts_by_difficulty: dict[str, int] | None = None,
) -> tuple[dict[str, object] | None, str | None]:
    """Plan one edition, or say why it cannot be planned."""

    edition = normalize_edition(edition)
    if source_version is None:
        source_version = sheet.published_version or sheet.current_version
    settings = settings_for(sheet=sheet, edition=edition)
    total_pages, _ = resolve_total_pdf_pages(
        settings=settings, source_version=source_version, edition=edition
    )
    if total_pages is None:
        return None, "PDF page count is missing."
    try:
        return (
            plan_payload(
                total_pdf_pages=total_pages,
                excluded_start_pages=settings.excluded_start_pages if settings else 0,
                excluded_end_pages=settings.excluded_end_pages if settings else 0,
                parts_by_difficulty=parts_by_difficulty,
            ),
            None,
        )
    except ActiveStudyPlanError as error:
        return None, str(error)


def university_parts_by_difficulty(
    *, sheet: LearningObject, source_version: LearningObjectVersion | None = None
) -> tuple[dict[str, int] | None, str | None]:
    """How many parts each difficulty has for this sheet.

    This is the structure the question bank is written against, so the Lock-in
    edition inherits it rather than deriving one of its own.
    """

    plan, error = edition_plan(sheet=sheet, edition=UNIVERSITY, source_version=source_version)
    if plan is None:
        return None, error
    return {
        str(item["difficulty"]): cast(int, item["number_of_parts"])
        for item in cast(list[dict[str, object]], plan["difficulties"])
    }, None


def readiness_payload(*, sheet: LearningObject, edition: str = UNIVERSITY) -> dict[str, object]:
    """Return student-safe status and an actionable administrator reason.

    PDF.js rendering is deliberately not a readiness input. Active Study uses
    configured page metadata and approved question content, not browser state.
    """
    edition = normalize_edition(edition)
    settings = settings_for(sheet=sheet, edition=edition)
    enabled = settings.enabled if settings is not None else False
    excluded_start = settings.excluded_start_pages if settings is not None else 0
    excluded_end = settings.excluded_end_pages if settings is not None else 0
    content_by_difficulty = {
        content.difficulty: content for content in sheet.active_study_question_content.all()
    }
    source_version = sheet.published_version or sheet.current_version
    total_pages, total_pages_source = resolve_total_pdf_pages(
        settings=settings, source_version=source_version, edition=edition
    )
    derived_pages = edition_version_page_count(source_version=source_version, edition=edition)

    # The question bank belongs to the sheet, so its part count and the
    # signature it was imported against always come from the university edition.
    parts_by_difficulty, structure_error = university_parts_by_difficulty(
        sheet=sheet, source_version=source_version
    )
    if edition == UNIVERSITY:
        parts_by_difficulty = None
        structure_error = None
    signature_plan, _ = (
        (None, None)
        if edition == UNIVERSITY
        else edition_plan(sheet=sheet, edition=UNIVERSITY, source_version=source_version)
    )

    settings_stale = bool(
        settings is not None
        and settings.source_version_id is not None
        and (source_version is None or settings.source_version_id != source_version.id)
    )
    page_count_stale = bool(
        settings is not None
        and settings.total_pdf_pages is not None
        and derived_pages is not None
        and settings.total_pdf_pages != derived_pages
    )
    plan: dict[str, object] | None = None
    plan_error: str | None = None
    if edition == LOCKIN and parts_by_difficulty is None:
        plan_error = structure_error if structure_error else UNIVERSITY_FIRST
        if plan_error == "PDF page count is missing.":
            plan_error = UNIVERSITY_FIRST
    elif total_pages is None:
        plan_error = "PDF page count is missing."
    else:
        plan, plan_error = edition_plan(
            sheet=sheet,
            edition=edition,
            source_version=source_version,
            parts_by_difficulty=parts_by_difficulty,
        )
    plans = {
        str(item["difficulty"]): item
        for item in cast(list[dict[str, object]], plan["difficulties"] if plan else [])
    }
    signature_plans = {
        str(item["difficulty"]): item
        for item in cast(
            list[dict[str, object]], signature_plan["difficulties"] if signature_plan else []
        )
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
        # One bank, one signature: the Lock-in edition is judged against the
        # plan the questions were imported for, not against its own ranges.
        imported_plan = signature_plans.get(rule.key) if edition == LOCKIN else plan_item
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
                imported_plan is not None
                and bool(imported_plan["page_ranges"])
                and content is not None
                and content.plan_signature != _signature(imported_plan)
            ):
                status, reason = (
                    "needs_review",
                    "Page ranges changed; revalidate and reimport questions.",
                )
        elif plan_item is None or not plan_item["page_ranges"]:
            reason = "No study page ranges could be generated."
        elif content is None:
            reason = "Questions have not been imported for this difficulty."
        elif imported_plan is None or content.plan_signature != _signature(imported_plan):
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
        "edition": edition,
        "enabled": enabled,
        "source_version_id": str(settings.source_version_id) if settings else None,
        "current_version_id": str(source_version.id) if source_version else None,
        "total_pdf_pages": total_pages,
        "total_pdf_pages_source": total_pages_source,
        "configured_total_pdf_pages": settings.total_pdf_pages if settings else None,
        "pdf_total_pdf_pages": derived_pages,
        "excluded_start_pages": excluded_start,
        "excluded_end_pages": excluded_end,
        "eligible_study_pages": plan["eligible_study_pages"] if plan else None,
        "plan_error": plan_error,
        "parts_follow_university": edition == LOCKIN,
        "difficulties": rows,
    }
