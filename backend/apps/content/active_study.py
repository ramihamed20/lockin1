"""Server-owned Active Study planning for managed PDF sheets.

Question prompts and their import schema intentionally live elsewhere.  This
module only owns the stable, reusable planning contract that future prompt
templates can consume.  Every caller -- readiness, the Admin preview and the
Admin save -- plans through :func:`plan_payload`, so a previewed part count is
always the part count that gets stored.
"""

from __future__ import annotations

from dataclasses import dataclass

# Prompt templates are authored per part count.  A plan above this many parts
# has no matching template yet; a plan that could not be built at all says so
# separately, because "no plan" is not "no template".
MAX_PROMPT_TEMPLATE_PARTS = 10

FIELD_LABELS: dict[str, str] = {
    "total_pdf_pages": "Total PDF pages",
    "excluded_start_pages": "Exclude from beginning",
    "excluded_end_pages": "Exclude from end",
}


class ActiveStudyPlanError(ValueError):
    """A planning input is invalid.

    ``field`` names the Admin input to blame so the UI can point at it instead
    of showing a page-level error with no field.
    """

    def __init__(self, message: str, *, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


@dataclass(frozen=True)
class ActiveStudyDifficulty:
    key: str
    target_pages_per_part: int
    questions_per_checkpoint: int = 15
    final_exam_questions: int = 50


DIFFICULTIES: tuple[ActiveStudyDifficulty, ...] = (
    ActiveStudyDifficulty("easy", target_pages_per_part=6),
    ActiveStudyDifficulty("medium", target_pages_per_part=5),
    ActiveStudyDifficulty("hard", target_pages_per_part=4),
)


def difficulty_for_key(key: str) -> ActiveStudyDifficulty:
    for difficulty in DIFFICULTIES:
        if difficulty.key == key:
            return difficulty
    raise ActiveStudyPlanError(
        "Active Study difficulty must be easy, medium, or hard.", field="difficulty"
    )


def _whole_number(value: object, *, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ActiveStudyPlanError(
            f"{FIELD_LABELS.get(field, field)} must be a whole number.", field=field
        )
    return value


def eligible_study_pages(
    *,
    total_pdf_pages: int,
    excluded_start_pages: int,
    excluded_end_pages: int,
) -> int:
    total = _whole_number(total_pdf_pages, field="total_pdf_pages")
    start = _whole_number(excluded_start_pages, field="excluded_start_pages")
    end = _whole_number(excluded_end_pages, field="excluded_end_pages")
    if total < 1:
        raise ActiveStudyPlanError("Total PDF pages must be at least 1.", field="total_pdf_pages")
    if start < 0:
        raise ActiveStudyPlanError(
            "Exclude from beginning cannot be negative.", field="excluded_start_pages"
        )
    if end < 0:
        raise ActiveStudyPlanError(
            "Exclude from end cannot be negative.", field="excluded_end_pages"
        )
    eligible = total - start - end
    if eligible < 1:
        raise ActiveStudyPlanError(
            f"Excluding {start} page(s) from the beginning and {end} from the end leaves "
            f"no study pages in a {total}-page PDF. Reduce the excluded pages.",
            field="excluded_end_pages" if end >= start else "excluded_start_pages",
        )
    return eligible


def part_sizes(*, eligible_pages: int, target_pages_per_part: int) -> tuple[int, ...]:
    pages = _whole_number(eligible_pages, field="total_pdf_pages")
    target = _whole_number(target_pages_per_part, field="difficulty")
    if pages < 1:
        raise ActiveStudyPlanError(
            "Eligible study pages must be positive.", field="total_pdf_pages"
        )
    if target < 1:
        raise ActiveStudyPlanError("Target pages per part must be positive.", field="difficulty")
    if pages <= target:
        return (pages,)
    full_parts, remainder = divmod(pages, target)
    if remainder == 0:
        return (target,) * full_parts
    # Keep every earlier part at the target; only the final part absorbs the remainder.
    return (target,) * (full_parts - 1) + (target + remainder,)


def part_sizes_for_count(*, eligible_pages: int, number_of_parts: int) -> tuple[int, ...]:
    """Split pages into an exact number of parts.

    The Lock-in edition plans through this. A sheet has one question bank, so
    both editions must have the same number of parts; only the page boundaries
    differ, because only the PDFs differ. Earlier parts stay equal and the last
    absorbs the remainder, matching how :func:`part_sizes` shapes a plan.
    """

    pages = _whole_number(eligible_pages, field="total_pdf_pages")
    parts = _whole_number(number_of_parts, field="number_of_parts")
    if parts < 1:
        raise ActiveStudyPlanError("Number of parts must be at least 1.", field="number_of_parts")
    if pages < parts:
        raise ActiveStudyPlanError(
            f"This PDF has only {pages} study page(s) but the sheet's questions are written "
            f"for {parts} parts. Add pages or reduce the excluded pages.",
            field="total_pdf_pages",
        )
    size, remainder = divmod(pages, parts)
    return (size,) * (parts - 1) + (size + remainder,)


def page_ranges(
    *,
    total_pdf_pages: int,
    excluded_start_pages: int,
    excluded_end_pages: int,
    target_pages_per_part: int,
    number_of_parts: int | None = None,
) -> tuple[tuple[int, int], ...]:
    """Plan one edition's page boundaries.

    ``number_of_parts`` pins the plan to a part count decided elsewhere -- the
    sheet's university edition -- instead of deriving it from the difficulty's
    target. Everything downstream is identical either way.
    """

    eligible = eligible_study_pages(
        total_pdf_pages=total_pdf_pages,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
    )
    sizes = (
        part_sizes_for_count(eligible_pages=eligible, number_of_parts=number_of_parts)
        if number_of_parts is not None
        else part_sizes(eligible_pages=eligible, target_pages_per_part=target_pages_per_part)
    )
    start = excluded_start_pages + 1
    ranges: list[tuple[int, int]] = []
    for size in sizes:
        end = start + size - 1
        ranges.append((start, end))
        start = end + 1
    return tuple(ranges)


def difficulty_plan(
    *,
    difficulty: ActiveStudyDifficulty,
    total_pdf_pages: int,
    excluded_start_pages: int,
    excluded_end_pages: int,
    number_of_parts: int | None = None,
) -> dict[str, object]:
    """Plan one difficulty.  Always yields at least one part or raises."""

    ranges = page_ranges(
        total_pdf_pages=total_pdf_pages,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
        target_pages_per_part=difficulty.target_pages_per_part,
        number_of_parts=number_of_parts,
    )
    return {
        "difficulty": difficulty.key,
        "target_pages_per_part": difficulty.target_pages_per_part,
        "questions_per_checkpoint": difficulty.questions_per_checkpoint,
        "final_exam_questions": difficulty.final_exam_questions,
        "number_of_parts": len(ranges),
        "plan_available": True,
        "plan_error": None,
        "prompt_template_supported": len(ranges) <= MAX_PROMPT_TEMPLATE_PARTS,
        "page_ranges": [
            {"part": index + 1, "start_page": start, "end_page": end}
            for index, (start, end) in enumerate(ranges)
        ],
    }


def unplanned_difficulty(*, difficulty: ActiveStudyDifficulty, reason: str) -> dict[str, object]:
    """A placeholder row for a sheet that cannot be planned yet.

    ``prompt_template_supported`` stays true: a missing page count says nothing
    about template coverage, and claiming otherwise is what made Admin report a
    missing template whenever the part count failed to calculate.
    """

    return {
        "difficulty": difficulty.key,
        "target_pages_per_part": difficulty.target_pages_per_part,
        "questions_per_checkpoint": difficulty.questions_per_checkpoint,
        "final_exam_questions": difficulty.final_exam_questions,
        "number_of_parts": 0,
        "plan_available": False,
        "plan_error": reason,
        "prompt_template_supported": True,
        "page_ranges": [],
    }


def plan_payload(
    *,
    total_pdf_pages: int | None,
    excluded_start_pages: int,
    excluded_end_pages: int,
    parts_by_difficulty: dict[str, int] | None = None,
) -> dict[str, object]:
    """Plan every difficulty for one edition.

    ``parts_by_difficulty`` pins each difficulty's part count, which is how a
    sheet's Lock-in edition inherits the university edition's structure and
    therefore its question bank.
    """

    if total_pdf_pages is None:
        reason = "PDF page count is missing."
        return {
            "total_pdf_pages": None,
            "eligible_study_pages": None,
            "plan_error": reason,
            "difficulties": [
                unplanned_difficulty(difficulty=difficulty, reason=reason)
                for difficulty in DIFFICULTIES
            ],
        }
    eligible = eligible_study_pages(
        total_pdf_pages=total_pdf_pages,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
    )
    return {
        "total_pdf_pages": total_pdf_pages,
        "eligible_study_pages": eligible,
        "plan_error": None,
        "difficulties": [
            difficulty_plan(
                difficulty=difficulty,
                total_pdf_pages=total_pdf_pages,
                excluded_start_pages=excluded_start_pages,
                excluded_end_pages=excluded_end_pages,
                number_of_parts=(parts_by_difficulty or {}).get(difficulty.key),
            )
            for difficulty in DIFFICULTIES
        ],
    }
