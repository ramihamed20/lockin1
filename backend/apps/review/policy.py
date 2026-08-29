from collections.abc import Iterable
from datetime import datetime, timedelta

from .models import ReviewItem

MASTERY_INTERVAL_DAYS: dict[int, int] = {0: 0, 1: 7, 2: 14, 3: 30, 4: 90}
WEEKLY_RECALL_LIMIT = 12

PRIORITY_WEIGHTS = {
    "mistake": 4.0,
    "review_failure": 3.0,
    "relearning": 5.0,
    "low_mastery": 4.0,
    "week_unseen": 1.0,
}


def iso_week_key(value: datetime) -> str:
    iso_year, iso_week, _ = value.date().isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def iso_week_start(value: datetime) -> datetime:
    return value - timedelta(
        days=value.weekday(),
        hours=value.hour,
        minutes=value.minute,
        seconds=value.second,
        microseconds=value.microsecond,
    )


def next_review_at(*, reviewed_at: datetime, mastery_level: int) -> datetime:
    days = MASTERY_INTERVAL_DAYS[max(0, min(4, mastery_level))]
    return reviewed_at + timedelta(days=days)


def review_priority(item: ReviewItem, *, now: datetime) -> float:
    anchor = item.last_reviewed_at or item.last_mistake_at
    weeks_unseen = max(0.0, (now - anchor).total_seconds() / (7 * 24 * 60 * 60))
    return (
        item.mistake_count * PRIORITY_WEIGHTS["mistake"]
        + item.review_incorrect_count * PRIORITY_WEIGHTS["review_failure"]
        + item.relearning_count * PRIORITY_WEIGHTS["relearning"]
        + (4 - item.mastery_level) * PRIORITY_WEIGHTS["low_mastery"]
        + weeks_unseen * PRIORITY_WEIGHTS["week_unseen"]
    )


def select_diverse_weekly_items(
    items: Iterable[ReviewItem], *, now: datetime, limit: int = WEEKLY_RECALL_LIMIT
) -> list[ReviewItem]:
    groups: dict[str, list[ReviewItem]] = {}
    for item in items:
        groups.setdefault(item.subject_key, []).append(item)
    for group in groups.values():
        group.sort(key=lambda item: (-review_priority(item, now=now), item.canonical_key))

    selected: list[ReviewItem] = []
    group_order = sorted(
        groups,
        key=lambda key: (-review_priority(groups[key][0], now=now), key),
    )
    for key in group_order:
        if len(selected) >= limit:
            return selected
        selected.append(groups[key].pop(0))

    selected_per_subject = {item.subject_key: 1 for item in selected}
    while len(selected) < limit:
        choices: list[tuple[float, str, ReviewItem]] = []
        for key, group in groups.items():
            if not group:
                continue
            penalty = 1 + selected_per_subject.get(key, 0) * 0.65
            adjusted = review_priority(group[0], now=now) / penalty
            choices.append((-adjusted, key, group[0]))
        if not choices:
            break
        _, key, item = min(choices, key=lambda choice: (choice[0], choice[1]))
        groups[key].pop(0)
        selected.append(item)
        selected_per_subject[key] = selected_per_subject.get(key, 0) + 1
    return selected
