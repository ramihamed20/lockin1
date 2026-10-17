"""Page boundaries fixed when a Pomodoro reading cycle ends."""

from typing import Any

MAX_POMODORO_QUESTIONS = 40


def initial_ranges(ranges: list[dict[str, Any]]) -> list[dict[str, int]]:
    return [{"part": 1, "start_page": ranges[0]["start_page"], "end_page": ranges[-1]["end_page"]}]


def close_range(
    ranges: list[dict[str, Any]], *, part: int, end_page: int, question_count: int
) -> list[dict[str, Any]]:
    """Keep completed ranges immutable and leave the unread tail for the next cycle."""
    if isinstance(part, bool) or not isinstance(part, int) or not 1 <= part <= len(ranges):
        raise ValueError("This Pomodoro cycle is no longer current. Resume the saved session.")
    current = ranges[part - 1]
    if (
        isinstance(end_page, bool)
        or not isinstance(end_page, int)
        or not current["start_page"] <= end_page <= current["end_page"]
    ):
        raise ValueError("Choose a page in the current Pomodoro reading range.")
    capacity = min(MAX_POMODORO_QUESTIONS, (end_page - current["start_page"] + 1) * 20)
    if (
        isinstance(question_count, bool)
        or not isinstance(question_count, int)
        or not 1 <= question_count <= capacity
    ):
        raise ValueError(f"Choose between 1 and {capacity} questions for these pages.")
    if "question_count" in current:
        if end_page != current["end_page"] or question_count != current["question_count"]:
            raise ValueError("A retry keeps the same Pomodoro pages and questions.")
        return ranges
    closed = {**current, "end_page": end_page, "question_count": question_count}
    tail = (
        [{"part": part + 1, "start_page": end_page + 1, "end_page": current["end_page"]}]
        if end_page < current["end_page"]
        else []
    )
    return [*ranges[: part - 1], closed, *tail]
