"""Server-owned Active Study planning for managed PDF sheets.

Question prompts and their import schema intentionally live elsewhere.  This
module only owns the stable, reusable planning contract that future prompt
templates can consume.
"""

from __future__ import annotations

from dataclasses import dataclass


class ActiveStudyPlanError(ValueError):
    pass


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


def eligible_study_pages(
    *,
    total_pdf_pages: int,
    excluded_start_pages: int,
    excluded_end_pages: int,
) -> int:
    if not all(
        isinstance(value, int) and not isinstance(value, bool)
        for value in (total_pdf_pages, excluded_start_pages, excluded_end_pages)
    ):
        raise ActiveStudyPlanError("Page counts must be whole numbers.")
    if total_pdf_pages < 1:
        raise ActiveStudyPlanError("A PDF must contain at least one page.")
    if excluded_start_pages < 0 or excluded_end_pages < 0:
        raise ActiveStudyPlanError("Excluded page counts cannot be negative.")
    eligible = total_pdf_pages - excluded_start_pages - excluded_end_pages
    if eligible < 1:
        raise ActiveStudyPlanError(
            "Excluded start and end pages must leave at least one study page."
        )
    return eligible


def part_sizes(*, eligible_pages: int, target_pages_per_part: int) -> tuple[int, ...]:
    if not all(
        isinstance(value, int) and not isinstance(value, bool)
        for value in (eligible_pages, target_pages_per_part)
    ):
        raise ActiveStudyPlanError("Part sizes must be whole numbers.")
    if eligible_pages < 1 or target_pages_per_part < 1:
        raise ActiveStudyPlanError(
            "Eligible pages and target pages must be positive."
        )
    if eligible_pages <= target_pages_per_part:
        return (eligible_pages,)
    full_parts, remainder = divmod(eligible_pages, target_pages_per_part)
    if remainder == 0:
        return (target_pages_per_part,) * full_parts
    # Keep every earlier part at the target; only the final part absorbs the remainder.
    return (target_pages_per_part,) * (full_parts - 1) + (target_pages_per_part + remainder,)


def page_ranges(
    *,
    total_pdf_pages: int,
    excluded_start_pages: int,
    excluded_end_pages: int,
    target_pages_per_part: int,
) -> tuple[tuple[int, int], ...]:
    eligible = eligible_study_pages(
        total_pdf_pages=total_pdf_pages,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
    )
    start = excluded_start_pages + 1
    ranges: list[tuple[int, int]] = []
    for size in part_sizes(
        eligible_pages=eligible,
        target_pages_per_part=target_pages_per_part,
    ):
        end = start + size - 1
        ranges.append((start, end))
        start = end + 1
    return tuple(ranges)


def plan_payload(
    *,
    total_pdf_pages: int | None,
    excluded_start_pages: int,
    excluded_end_pages: int,
) -> dict[str, object]:
    if total_pdf_pages is None:
        return {"total_pdf_pages": None, "eligible_study_pages": None, "difficulties": []}
    eligible = eligible_study_pages(
        total_pdf_pages=total_pdf_pages,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
    )
    difficulties: list[dict[str, object]] = []
    for difficulty in DIFFICULTIES:
        ranges = page_ranges(
            total_pdf_pages=total_pdf_pages,
            excluded_start_pages=excluded_start_pages,
            excluded_end_pages=excluded_end_pages,
            target_pages_per_part=difficulty.target_pages_per_part,
        )
        difficulties.append(
            {
                "difficulty": difficulty.key,
                "target_pages_per_part": difficulty.target_pages_per_part,
                "questions_per_checkpoint": difficulty.questions_per_checkpoint,
                "final_exam_questions": difficulty.final_exam_questions,
                "number_of_parts": len(ranges),
                "prompt_template_supported": len(ranges) <= 10,
                "page_ranges": [
                    {"part": index + 1, "start_page": start, "end_page": end}
                    for index, (start, end) in enumerate(ranges)
                ],
            }
        )
    return {
        "total_pdf_pages": total_pdf_pages,
        "eligible_study_pages": eligible,
        "difficulties": difficulties,
    }
