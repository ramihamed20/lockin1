"""Server-owned readiness decision for managed Active Study.

A sheet has one question bank and two editions of the PDF it is read from. The
university edition decides how many parts each difficulty has; the Lock-in
edition splits its own *study pages* -- what is left after its own exclusions --
into that same number, so one set of questions stays correct for both and is
never imported twice. The two PDFs may have different raw page counts: only the
effective study range matters.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast
from uuid import UUID

from .active_study import DIFFICULTIES, ActiveStudyPlanError, plan_payload, unplanned_difficulty
from .active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)
from .editions import LOCKIN, UNIVERSITY, normalize_edition, primary_role
from .models import (
    ActiveStudySettings,
    LearningObject,
    LearningObjectAsset,
    LearningObjectVersion,
)

# Shown wherever the Lock-in edition cannot be planned because the edition it
# takes its structure from has not been configured.
UNIVERSITY_FIRST = (
    "Configure the University Sheet's Active Study pages first; the Lockin Sheet "
    "follows its part count."
)

SOURCE_CHANGED = "The source PDF changed; verify pagination and reimport questions."


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


def source_version_for(sheet: LearningObject) -> LearningObjectVersion | None:
    return sheet.published_version or sheet.current_version


def edition_file_id(*, version: LearningObjectVersion | None, edition: str) -> UUID | None:
    """The managed file an edition's reader opens in one version, if any."""

    if version is None:
        return None
    role = primary_role(edition)
    asset = next((item for item in version.assets.all() if item.role == role), None)
    return asset.managed_file_id if asset is not None else None


def edition_source_changed(
    *,
    recorded_version_id: UUID | None,
    current_version: LearningObjectVersion | None,
    edition: str,
    cache: dict[tuple[UUID, str], UUID | None] | None = None,
) -> bool:
    """Whether the PDF something was configured against has been replaced.

    Every sheet edit -- a Sheet Summary upload, the Lock-in PDF, a rename --
    creates a new version. Comparing version ids therefore marked valid
    questions and page settings as stale after any of them, and students saw
    "Not Ready" for a sheet Admin had just finished. Only the edition's own PDF
    decides pagination, so only that file is compared.

    ``cache`` lets one readiness decision look each recorded version up once,
    however many difficulties were saved against it.
    """

    if recorded_version_id is None:
        return False
    if current_version is None:
        return True
    if recorded_version_id == current_version.id:
        return False
    key = (recorded_version_id, normalize_edition(edition))
    if cache is not None and key in cache:
        recorded_file_id = cache[key]
    else:
        recorded_file_id = (
            LearningObjectAsset.objects.filter(
                version_id=recorded_version_id, role=primary_role(edition)
            )
            .values_list("managed_file_id", flat=True)
            .first()
        )
        if cache is not None:
            cache[key] = recorded_file_id
    return recorded_file_id != edition_file_id(version=current_version, edition=edition)


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


@dataclass(frozen=True, slots=True)
class EffectiveSettings:
    """What an edition actually runs with.

    The Lock-in edition shares the sheet's question bank, so until an
    administrator saves Lock-in settings of its own it follows the University
    Sheet's enabled state and studies every page of its own PDF. Adding
    questions on the University tab is then enough for both editions.
    """

    enabled: bool
    excluded_start_pages: int
    excluded_end_pages: int
    own: ActiveStudySettings | None
    inherited: bool

    @property
    def configured(self) -> bool:
        return self.own is not None or self.inherited


def effective_settings(*, sheet: LearningObject, edition: str) -> EffectiveSettings:
    edition = normalize_edition(edition)
    own = settings_for(sheet=sheet, edition=edition)
    if own is not None:
        return EffectiveSettings(
            enabled=own.enabled,
            excluded_start_pages=own.excluded_start_pages,
            excluded_end_pages=own.excluded_end_pages,
            own=own,
            inherited=False,
        )
    if edition == LOCKIN:
        university = settings_for(sheet=sheet, edition=UNIVERSITY)
        if university is not None and university.enabled:
            return EffectiveSettings(
                enabled=True, excluded_start_pages=0, excluded_end_pages=0, own=None, inherited=True
            )
    return EffectiveSettings(
        enabled=False, excluded_start_pages=0, excluded_end_pages=0, own=None, inherited=False
    )


def edition_plan(
    *,
    sheet: LearningObject,
    edition: str,
    source_version: LearningObjectVersion | None = None,
    parts_by_difficulty: dict[str, int] | None = None,
    sizes_by_difficulty: dict[str, tuple[int, ...]] | None = None,
) -> tuple[dict[str, object] | None, str | None]:
    """Plan one edition, or say why it cannot be planned."""

    edition = normalize_edition(edition)
    if source_version is None:
        source_version = source_version_for(sheet)
    effective = effective_settings(sheet=sheet, edition=edition)
    total_pages, _ = resolve_total_pdf_pages(
        settings=effective.own, source_version=source_version, edition=edition
    )
    if total_pages is None:
        return None, "PDF page count is missing."
    try:
        return (
            plan_payload(
                total_pdf_pages=total_pages,
                excluded_start_pages=effective.excluded_start_pages,
                excluded_end_pages=effective.excluded_end_pages,
                parts_by_difficulty=parts_by_difficulty,
                sizes_by_difficulty=sizes_by_difficulty,
            ),
            None,
        )
    except ActiveStudyPlanError as error:
        return None, str(error)


@dataclass(frozen=True, slots=True)
class UniversityStructure:
    """The part structure the sheet's question bank is written against."""

    parts_by_difficulty: dict[str, int]
    sizes_by_difficulty: dict[str, tuple[int, ...]]
    eligible_study_pages: int


def university_structure(
    *, sheet: LearningObject, source_version: LearningObjectVersion | None = None
) -> tuple[UniversityStructure | None, str | None]:
    plan, error = edition_plan(sheet=sheet, edition=UNIVERSITY, source_version=source_version)
    if plan is None:
        return None, error
    difficulties = cast(list[dict[str, object]], plan["difficulties"])
    return (
        UniversityStructure(
            parts_by_difficulty={
                str(item["difficulty"]): cast(int, item["number_of_parts"]) for item in difficulties
            },
            sizes_by_difficulty={
                str(item["difficulty"]): tuple(
                    row["end_page"] - row["start_page"] + 1
                    for row in cast(list[dict[str, int]], item["page_ranges"])
                )
                for item in difficulties
            },
            eligible_study_pages=cast(int, plan["eligible_study_pages"]),
        ),
        None,
    )


def university_parts_by_difficulty(
    *, sheet: LearningObject, source_version: LearningObjectVersion | None = None
) -> tuple[dict[str, int] | None, str | None]:
    """How many parts each difficulty has for this sheet.

    This is the structure the question bank is written against, so the Lock-in
    edition inherits it rather than deriving one of its own.
    """

    structure, error = university_structure(sheet=sheet, source_version=source_version)
    return (structure.parts_by_difficulty if structure else None), error


def lockin_plan_inputs(
    *, sheet: LearningObject, source_version: LearningObjectVersion | None = None
) -> tuple[dict[str, object] | None, str]:
    """The keyword arguments that pin a Lock-in plan to the University structure."""

    structure, error = university_structure(sheet=sheet, source_version=source_version)
    if structure is None:
        return None, (
            error if error and error != "PDF page count is missing." else UNIVERSITY_FIRST
        )
    return {
        "parts_by_difficulty": structure.parts_by_difficulty,
        "sizes_by_difficulty": structure.sizes_by_difficulty,
    }, ""


def readiness_payload(*, sheet: LearningObject, edition: str = UNIVERSITY) -> dict[str, object]:
    """Return student-safe status and an actionable administrator reason.

    PDF.js rendering is deliberately not a readiness input. Active Study uses
    configured page metadata and approved question content, not browser state.
    """
    edition = normalize_edition(edition)
    effective = effective_settings(sheet=sheet, edition=edition)
    settings = effective.own
    enabled = effective.enabled
    content_by_difficulty = {
        content.difficulty: content for content in sheet.active_study_question_content.all()
    }
    source_version = source_version_for(sheet)
    total_pages, total_pages_source = resolve_total_pdf_pages(
        settings=settings, source_version=source_version, edition=edition
    )
    derived_pages = edition_version_page_count(source_version=source_version, edition=edition)

    # The question bank belongs to the sheet, so its part count and the
    # signature it was imported against always come from the university edition.
    structure: UniversityStructure | None = None
    structure_error: str | None = None
    signature_plan: dict[str, object] | None = None
    if edition == LOCKIN:
        structure, structure_error = university_structure(
            sheet=sheet, source_version=source_version
        )
        signature_plan, _ = edition_plan(
            sheet=sheet, edition=UNIVERSITY, source_version=source_version
        )

    source_files: dict[tuple[UUID, str], UUID | None] = {}
    settings_stale = bool(
        settings is not None
        and edition_source_changed(
            recorded_version_id=settings.source_version_id,
            current_version=source_version,
            edition=edition,
            cache=source_files,
        )
    )
    page_count_stale = bool(
        settings is not None
        and settings.total_pdf_pages is not None
        and derived_pages is not None
        and settings.total_pdf_pages != derived_pages
    )
    # Questions describe the University Sheet's pages, so only replacing that
    # PDF can make them stale -- never a Lock-in or summary upload.
    stale_content = {
        key
        for key, content in content_by_difficulty.items()
        if edition_source_changed(
            recorded_version_id=content.source_version_id,
            current_version=source_version,
            edition=UNIVERSITY,
            cache=source_files,
        )
    }
    plan: dict[str, object] | None = None
    plan_error: str | None = None
    if edition == LOCKIN and structure is None:
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
            parts_by_difficulty=structure.parts_by_difficulty if structure else None,
            sizes_by_difficulty=structure.sizes_by_difficulty if structure else None,
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
        if settings_stale or page_count_stale or rule.key in stale_content:
            status, reason = "needs_review", SOURCE_CHANGED
        elif plan_error and (enabled or effective.configured):
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

    eligible = cast(int | None, plan["eligible_study_pages"]) if plan else None
    university_eligible = structure.eligible_study_pages if structure else None
    return {
        "edition": edition,
        "enabled": enabled,
        "settings_inherited": effective.inherited,
        "source_version_id": str(settings.source_version_id) if settings else None,
        "current_version_id": str(source_version.id) if source_version else None,
        "total_pdf_pages": total_pages,
        "total_pdf_pages_source": total_pages_source,
        "configured_total_pdf_pages": settings.total_pdf_pages if settings else None,
        "pdf_total_pdf_pages": derived_pages,
        "excluded_start_pages": effective.excluded_start_pages,
        "excluded_end_pages": effective.excluded_end_pages,
        "eligible_study_pages": eligible,
        "university_eligible_study_pages": university_eligible,
        "study_pages_match_university": (
            None
            if edition == UNIVERSITY or eligible is None or university_eligible is None
            else eligible == university_eligible
        ),
        "plan_error": plan_error,
        "parts_follow_university": edition == LOCKIN,
        "difficulties": rows,
    }
