"""One calendar policy shared by weekly generation and exam planning."""

from datetime import date

from .models import StudyPlanProfile


def available_minutes(profile: StudyPlanProfile, day: date) -> int:
    if str(day) in profile.date_minutes:
        return int(profile.date_minutes[str(day)])
    if str(day.weekday()) in profile.weekly_minutes:
        return int(profile.weekly_minutes[str(day.weekday())])
    return profile.daily_minutes if day.weekday() in profile.weekdays else 0


def preference_priority(profile: StudyPlanProfile, title: str) -> int:
    names = [name.strip().casefold() for name in profile.subjects]
    key = title.strip().casefold()
    return len(names) - names.index(key) if key in names else 0
