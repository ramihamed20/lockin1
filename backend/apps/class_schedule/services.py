from dataclasses import dataclass

from django.db import transaction

from apps.accounts.models import User

from . import schedule_data as year2
from . import schedule_data_year1 as year1
from .models import MyGroupPracticalOverride, MyGroupPreference

YEAR_1 = MyGroupPreference.AcademicYear.YEAR_1.value
YEAR_2 = MyGroupPreference.AcademicYear.YEAR_2.value
# My Group timetables exist for this programme only; the cohort code is the year.
TIMETABLE_PROGRAM = "dentistry-tripoli"
TIMETABLE_YEARS = (YEAR_1, YEAR_2)


class MyGroupRuleError(ValueError):
    """The request does not fit the student's year or group model."""


@dataclass(frozen=True)
class PracticalChoice:
    schedule_set: str
    practical_group: str


@dataclass(frozen=True)
class Placement:
    """Which timetable a student sees, and how that was decided."""

    academic_year: str | None
    from_cohort: bool


def placement_for(user: User) -> Placement:
    """The student's timetable year, from their cohort.

    University of Tripoli Dentistry Year 1 and Year 2 each get their own
    timetable. An account with no cohort predates cohorts and keeps the Year 2
    timetable it has always had. Any other cohort has no timetable here: showing
    it Tripoli's would be showing another class's schedule.
    """

    cohort = user.cohort
    if cohort is None:
        return Placement(YEAR_2, from_cohort=False)
    if cohort.program.code == TIMETABLE_PROGRAM and cohort.code in TIMETABLE_YEARS:
        return Placement(cohort.code, from_cohort=True)
    return Placement(None, from_cohort=True)


def _frame(academic_year: str) -> dict[str, object]:
    data = year1 if academic_year == YEAR_1 else year2
    return {
        "days": list(data.DAYS),
        "slots": [{"start_time": start, "end_time": end} for start, end in data.TIME_SLOTS],
    }


def _options(academic_year: str) -> dict[str, object]:
    if academic_year == YEAR_1:
        return {
            "theory_groups": list(year1.THEORY_GROUPS),
            "practical_groups": list(year1.PRACTICAL_GROUPS),
            "subjects": list(year1.SUBJECTS),
            "per_subject_overrides": False,
        }
    return {
        "theory_groups": list(year2.THEORY_GROUPS),
        "practical_groups": list(year2.PRACTICAL_GROUPS),
        "subjects": list(year2.SUBJECTS),
        "per_subject_overrides": True,
    }


def _chronological(sessions: list[dict[str, str]], days: tuple[str, ...]) -> list[dict[str, str]]:
    day_order: dict[str, int] = {day: index for index, day in enumerate(days)}
    # Theory first within a shared slot, so a lecture never reads as the clash.
    return sorted(
        sessions,
        key=lambda item: (day_order[item["day"]], item["start_time"], item["kind"] != "theory"),
    )


def resolve_sessions(
    *,
    theory_group: str,
    default_practical_group: str,
    overrides: dict[str, PracticalChoice],
) -> list[dict[str, str]]:
    """Year 2: merge theory lectures with one practical session source per subject.

    A subject without an override follows the default practical group inside the
    student's own theory schedule set; an override replaces that subject only.
    """

    sessions: list[dict[str, str]] = [
        {
            "kind": "theory",
            "subject": session.subject,
            "day": session.day,
            "start_time": session.start_time,
            "end_time": session.end_time,
            "schedule_set": session.theory_group,
        }
        for session in year2.THEORY_SESSIONS
        if session.theory_group == theory_group
    ]
    default = PracticalChoice(theory_group, default_practical_group)
    for subject in year2.SUBJECTS:
        choice = overrides.get(subject, default)
        sessions.extend(
            {
                "kind": "practical",
                "subject": session.subject,
                "day": session.day,
                "start_time": session.start_time,
                "end_time": session.end_time,
                "schedule_set": session.schedule_set,
                "practical_group": session.practical_group,
            }
            for session in year2.PRACTICAL_SESSIONS
            if session.subject == subject
            and session.schedule_set == choice.schedule_set
            and session.practical_group == choice.practical_group
        )
    return _chronological(sessions, year2.DAYS)


def resolve_year1_sessions(*, theory_group: str, practical_group: str) -> list[dict[str, str]]:
    """Year 1: the theory group's lectures plus that theory group's own practical group."""

    sessions: list[dict[str, str]] = [
        {
            "kind": "theory",
            "subject": session.subject,
            "code": year1.COURSE_CODES[session.subject],
            "day": session.day,
            "start_time": session.start_time,
            "end_time": session.end_time,
            "schedule_set": session.theory_group,
        }
        for session in year1.THEORY_SESSIONS
        if session.theory_group == theory_group
    ]
    sessions.extend(
        {
            "kind": "practical",
            "subject": session.subject,
            "code": year1.COURSE_CODES[session.subject],
            "day": session.day,
            "start_time": session.start_time,
            "end_time": session.end_time,
            "schedule_set": session.theory_group,
            "practical_group": session.practical_group,
        }
        for session in year1.PRACTICAL_SESSIONS
        if session.theory_group == theory_group and session.practical_group == practical_group
    )
    return _chronological(sessions, year1.DAYS)


def my_group_payload(user: User) -> dict[str, object]:
    placement = placement_for(user)
    year = placement.academic_year
    base: dict[str, object] = {
        "available": year is not None,
        "academic_year": year,
        "from_cohort": placement.from_cohort,
    }
    if year is None:
        return {
            **base,
            "configured": False,
            "options": None,
            "preferences": None,
            "timetable": {"days": [], "slots": [], "sessions": []},
        }
    frame = _frame(year)
    preference = preference_for(user)
    # A choice saved for another year never resolves against this year's sessions.
    if preference is None or preference.academic_year != year:
        return {
            **base,
            "configured": False,
            "options": _options(year),
            "preferences": None,
            "timetable": {**frame, "sessions": []},
        }
    overrides = {
        item.subject: PracticalChoice(item.schedule_set, item.practical_group)
        for item in preference.practical_overrides.all()
    }
    sessions = (
        resolve_year1_sessions(
            theory_group=preference.theory_group,
            practical_group=preference.default_practical_group,
        )
        if year == YEAR_1
        else resolve_sessions(
            theory_group=preference.theory_group,
            default_practical_group=preference.default_practical_group,
            overrides=overrides,
        )
    )
    return {
        **base,
        "configured": True,
        "options": _options(year),
        "preferences": {
            "academic_year": preference.academic_year,
            "theory_group": preference.theory_group,
            "default_practical_group": preference.default_practical_group,
            "practical_overrides": {
                subject: {
                    "schedule_set": choice.schedule_set,
                    "practical_group": choice.practical_group,
                }
                for subject, choice in overrides.items()
            },
            "updated_at": preference.updated_at,
        },
        "timetable": {**frame, "sessions": sessions},
    }


def preference_for(user: User) -> MyGroupPreference | None:
    return (
        MyGroupPreference.objects.filter(user=user).prefetch_related("practical_overrides").first()
    )


@transaction.atomic
def save_preferences(
    *,
    user: User,
    theory_group: str,
    default_practical_group: str,
    overrides: dict[str, PracticalChoice],
) -> MyGroupPreference:
    """Replace the student's My Group choice in full, for their current year.

    Only this one row changes: the student's cohort, subscription and every kind
    of progress are owned elsewhere and are never touched here. An override that
    points at the default schedule is dropped, so a stored row always means
    "this subject differs from my default".
    """

    year = placement_for(user).academic_year
    if year is None:
        raise MyGroupRuleError("My Group is not available for your year yet.")
    model = year1 if year == YEAR_1 else year2
    if theory_group not in model.THEORY_GROUPS:
        raise MyGroupRuleError("Choose a valid theory group.")
    if default_practical_group not in model.PRACTICAL_GROUPS:
        raise MyGroupRuleError("Choose a valid practical group for your year.")
    if year == YEAR_1 and overrides:
        raise MyGroupRuleError("Year 1 has no per-subject practical choices.")
    for subject, choice in overrides.items():
        if (
            subject not in year2.SUBJECTS
            or choice.schedule_set not in year2.THEORY_GROUPS
            or choice.practical_group not in year2.PRACTICAL_GROUPS
        ):
            raise MyGroupRuleError("A per-subject practical choice is invalid.")

    preference, _ = MyGroupPreference.objects.select_for_update().get_or_create(
        user=user,
        defaults={
            "academic_year": year,
            "theory_group": theory_group,
            "default_practical_group": default_practical_group,
        },
    )
    preference.academic_year = year
    preference.theory_group = theory_group
    preference.default_practical_group = default_practical_group
    preference.save()
    default = PracticalChoice(theory_group, default_practical_group)
    preference.practical_overrides.all().delete()
    MyGroupPracticalOverride.objects.bulk_create(
        MyGroupPracticalOverride(
            preference=preference,
            subject=subject,
            schedule_set=choice.schedule_set,
            practical_group=choice.practical_group,
        )
        for subject, choice in sorted(overrides.items())
        if choice != default
    )
    return preference
