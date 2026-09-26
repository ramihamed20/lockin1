from dataclasses import dataclass

from django.db import transaction

from apps.accounts.models import User

from .models import MyGroupPracticalOverride, MyGroupPreference
from .schedule_data import (
    DAYS,
    PRACTICAL_SESSIONS,
    SUBJECTS,
    THEORY_SESSIONS,
    TIME_SLOTS,
)


@dataclass(frozen=True)
class PracticalChoice:
    schedule_set: str
    practical_group: str


def resolve_sessions(
    *,
    theory_group: str,
    default_practical_group: str,
    overrides: dict[str, PracticalChoice],
) -> list[dict[str, str]]:
    """Merge theory lectures with one practical session source per subject.

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
        for session in THEORY_SESSIONS
        if session.theory_group == theory_group
    ]
    default = PracticalChoice(theory_group, default_practical_group)
    for subject in SUBJECTS:
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
            for session in PRACTICAL_SESSIONS
            if session.subject == subject
            and session.schedule_set == choice.schedule_set
            and session.practical_group == choice.practical_group
        )
    day_order: dict[str, int] = {day: index for index, day in enumerate(DAYS)}
    # Theory first within a shared slot, so a lecture never reads as the clash.
    sessions.sort(
        key=lambda item: (day_order[item["day"]], item["start_time"], item["kind"] != "theory")
    )
    return sessions


def my_group_payload(preference: MyGroupPreference | None) -> dict[str, object]:
    timetable_frame = {
        "days": list(DAYS),
        "slots": [{"start_time": start, "end_time": end} for start, end in TIME_SLOTS],
    }
    if preference is None:
        return {
            "configured": False,
            "preferences": None,
            "timetable": {**timetable_frame, "sessions": []},
        }
    overrides = {
        item.subject: PracticalChoice(item.schedule_set, item.practical_group)
        for item in preference.practical_overrides.all()
    }
    return {
        "configured": True,
        "preferences": {
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
        "timetable": {
            **timetable_frame,
            "sessions": resolve_sessions(
                theory_group=preference.theory_group,
                default_practical_group=preference.default_practical_group,
                overrides=overrides,
            ),
        },
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
    """Replace the student's My Group choice in full.

    An override that points at the default schedule is dropped, so a stored row
    always means "this subject differs from my default".
    """

    preference, _ = MyGroupPreference.objects.select_for_update().get_or_create(
        user=user,
        defaults={"theory_group": theory_group, "default_practical_group": default_practical_group},
    )
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
