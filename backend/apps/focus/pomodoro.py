"""Page boundaries fixed when a Pomodoro reading cycle ends."""

from typing import Any

from apps.content.page_question_bank import QUESTIONS_PER_PAGE

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
    capacity = min(
        MAX_POMODORO_QUESTIONS, (end_page - current["start_page"] + 1) * QUESTIONS_PER_PAGE
    )
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


MINUTE_MS = 60 * 1000
# (focus, break, long break) minutes; mirrored by POMODORO_PRESETS in the frontend.
PRESETS = {"classic": (25, 5, 15), "extended": (45, 10, 20), "deep": (50, 10, 30)}
CLOCK_PHASES = {"focus", "break", "waiting", "ready", "quiz"}


def _whole(value: Any, *, low: int, high: int) -> bool:
    return not isinstance(value, bool) and isinstance(value, int) and low <= value <= high


def validate_clock(clock: Any) -> dict[str, Any]:
    """Accept only a well-formed countdown; the server never trusts it for progress."""
    if not isinstance(clock, dict) or clock.get("version") != 1:
        raise ValueError("The Pomodoro timer could not be saved.")
    preset = clock.get("preset", "classic")
    if preset not in PRESETS:
        raise ValueError("Choose a Pomodoro timer length.")
    longest = max(minutes for durations in PRESETS.values() for minutes in durations) * MINUTE_MS
    deadline = clock.get("deadline")
    end_page = clock.get("endPage")
    valid = (
        _whole(clock.get("part"), low=1, high=10000)
        and clock.get("phase") in CLOCK_PHASES
        and (deadline is None or _whole(deadline, low=0, high=2**53))
        and _whole(clock.get("remainingMs"), low=0, high=longest)
        and (end_page is None or _whole(end_page, low=1, high=10000))
        and isinstance(clock.get("long", False), bool)
        and isinstance(clock.get("away", False), bool)
        and _whole(clock.get("longAt", 0), low=0, high=10000)
        and _whole(clock.get("updatedAt"), low=0, high=2**53)
    )
    if not valid:
        raise ValueError("The Pomodoro timer could not be saved.")
    keys = ("version", "part", "phase", "deadline", "remainingMs", "endPage", "updatedAt")
    return {
        **{key: clock.get(key) for key in keys},
        "preset": preset,
        "long": clock.get("long", False),
        "longAt": clock.get("longAt", 0),
        # Paused because the student left the page; coming back starts it again.
        **({"away": True} if clock.get("away") else {}),
    }
