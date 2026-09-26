"""University of Tripoli Dentistry Year 1 "My Group", and its separation from Year 2.

The expected timetables are written out here from the faculty's published
Year 1 sheets rather than read from ``schedule_data_year1``, so these tests
check the transcription instead of repeating it.
"""

from uuid import uuid4

import pytest
from django.apps import apps
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort

from .. import schedule_data as year2
from ..models import MyGroupPreference

pytestmark = pytest.mark.django_db

URL = "/api/v1/my-group"
CODE = {
    "general_anatomy": "MS110",
    "histology": "MS120",
    "physiology": "MS130",
    "biochemistry": "MS140",
    "dental_materials": "DS110",
    "dental_anatomy": "DS120",
}

THEORY = {
    "A": {
        ("sunday", "10:00", "12:00", "MS120"),
        ("monday", "08:00", "10:00", "DS120"),
        ("monday", "10:00", "12:00", "MS140"),
        ("monday", "14:00", "16:00", "DS110"),
        ("tuesday", "09:00", "12:00", "MS110"),
        ("wednesday", "08:00", "10:00", "MS130"),
        ("thursday", "08:00", "10:00", "DS110"),
        ("thursday", "10:00", "12:00", "DS120"),
    },
    "B": {
        ("sunday", "12:00", "14:00", "MS110"),
        ("sunday", "14:00", "16:00", "DS110"),
        ("monday", "12:00", "14:00", "DS120"),
        ("tuesday", "12:00", "14:00", "MS130"),
        ("tuesday", "14:00", "16:00", "MS120"),
        ("wednesday", "10:00", "12:00", "MS110"),
        ("wednesday", "12:00", "14:00", "DS110"),
        ("thursday", "12:00", "14:00", "MS140"),
        ("thursday", "14:00", "16:00", "DS120"),
    },
}

# Practical sheets: (day, start hour) -> code. Every Year 1 practical lasts two hours.
_PRACTICAL_SHEETS = {
    ("A", "A"): {
        ("sunday", 12): "MS120",
        ("sunday", 14): "DS120",
        ("monday", 12): "DS120",
        ("tuesday", 12): "MS140",
        ("tuesday", 14): "MS110",
        ("wednesday", 10): "DS110",
        ("wednesday", 12): "MS130",
        ("thursday", 12): "DS110",
    },  # noqa: E501
    ("A", "B"): {
        ("sunday", 12): "MS110",
        ("sunday", 14): "MS140",
        ("monday", 12): "DS110",
        ("tuesday", 12): "MS130",
        ("tuesday", 14): "DS120",
        ("wednesday", 10): "DS120",
        ("wednesday", 12): "DS110",
        ("thursday", 12): "MS120",
    },  # noqa: E501
    ("A", "C"): {
        ("sunday", 12): "DS120",
        ("sunday", 14): "DS110",
        ("monday", 12): "MS110",
        ("tuesday", 12): "DS110",
        ("tuesday", 14): "MS130",
        ("wednesday", 10): "MS120",
        ("wednesday", 12): "MS140",
        ("thursday", 12): "DS120",
    },  # noqa: E501
    ("A", "D"): {
        ("sunday", 12): "DS110",
        ("sunday", 14): "MS130",
        ("monday", 12): "MS120",
        ("tuesday", 12): "DS120",
        ("tuesday", 14): "DS110",
        ("wednesday", 10): "MS140",
        ("wednesday", 12): "DS120",
        ("thursday", 12): "MS110",
    },  # noqa: E501
    ("B", "A"): {
        ("sunday", 8): "MS120",
        ("sunday", 10): "DS120",
        ("monday", 8): "DS120",
        ("tuesday", 8): "MS140",
        ("tuesday", 10): "MS110",
        ("wednesday", 8): "DS110",
        ("thursday", 8): "MS130",
        ("thursday", 10): "DS110",
    },  # noqa: E501
    ("B", "B"): {
        ("sunday", 8): "MS110",
        ("sunday", 10): "MS140",
        ("monday", 8): "DS110",
        ("tuesday", 8): "MS130",
        ("tuesday", 10): "DS120",
        ("wednesday", 8): "DS120",
        ("thursday", 8): "DS110",
        ("thursday", 10): "MS120",
    },  # noqa: E501
    ("B", "C"): {
        ("sunday", 8): "DS120",
        ("sunday", 10): "DS110",
        ("monday", 8): "MS110",
        ("tuesday", 8): "DS110",
        ("tuesday", 10): "MS130",
        ("wednesday", 8): "MS120",
        ("thursday", 8): "MS140",
        ("thursday", 10): "DS120",
    },  # noqa: E501
    ("B", "D"): {
        ("sunday", 8): "DS110",
        ("sunday", 10): "MS130",
        ("monday", 8): "MS120",
        ("tuesday", 8): "DS120",
        ("tuesday", 10): "DS110",
        ("wednesday", 8): "MS140",
        ("thursday", 8): "DS120",
        ("thursday", 10): "MS110",
    },  # noqa: E501
}
PRACTICAL = {
    key: {
        (day, f"{hour:02d}:00", f"{hour + 2:02d}:00", code) for (day, hour), code in sheet.items()
    }
    for key, sheet in _PRACTICAL_SHEETS.items()
}
COMBINATIONS = sorted(PRACTICAL)
DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday"]


def _cohort(code: str, program: str = "dentistry-tripoli") -> StudentCohort:
    return StudentCohort.objects.get(program__code=program, code=code)


def _student(year: str = "year-1", program: str = "dentistry-tripoli") -> User:
    return create_user(email=f"{uuid4().hex[:10]}@example.com", cohort=_cohort(year, program))


def _client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _save(client: APIClient, theory: str, practical: str):  # type: ignore[no-untyped-def]
    return client.put(
        URL, {"theory_group": theory, "default_practical_group": practical}, format="json"
    )


def _cells(body: dict, kind: str) -> set[tuple[str, str, str, str]]:  # type: ignore[type-arg]
    return {
        (item["day"], item["start_time"], item["end_time"], item["code"])
        for item in body["timetable"]["sessions"]
        if item["kind"] == kind
    }


@pytest.mark.parametrize(("theory", "practical"), COMBINATIONS)
def test_every_year1_combination_shows_its_theory_and_only_its_own_practical(
    theory: str, practical: str
) -> None:
    response = _save(_client(_student()), theory, practical)

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["academic_year"] == "year-1"
    assert body["configured"] is True
    assert body["preferences"]["theory_group"] == theory
    assert body["preferences"]["default_practical_group"] == practical
    assert _cells(body, "theory") == THEORY[theory]
    assert _cells(body, "practical") == PRACTICAL[(theory, practical)]
    for item in body["timetable"]["sessions"]:
        assert CODE[item["subject"]] == item["code"]
        # Never the other theory group's practicals, never another practical group.
        assert item["schedule_set"] == theory
        if item["kind"] == "practical":
            assert item["practical_group"] == practical


def test_the_corrected_theory_b_schedule() -> None:
    body = _save(_client(_student()), "B", "A").json()
    theory = sorted(
        (DAY_ORDER.index(item["day"]), item["start_time"], item["end_time"], item["code"])
        for item in body["timetable"]["sessions"]
        if item["kind"] == "theory"
    )
    assert theory == [
        (0, "12:00", "14:00", "MS110"),
        (0, "14:00", "16:00", "DS110"),
        (1, "12:00", "14:00", "DS120"),
        (2, "12:00", "14:00", "MS130"),
        (2, "14:00", "16:00", "MS120"),
        (3, "10:00", "12:00", "MS110"),
        (3, "12:00", "14:00", "DS110"),
        (4, "12:00", "14:00", "MS140"),
        (4, "14:00", "16:00", "DS120"),
    ]


def test_theory_a_general_anatomy_is_one_continuous_lecture() -> None:
    body = _save(_client(_student()), "A", "C").json()
    tuesday = [item for item in body["timetable"]["sessions"] if item["day"] == "tuesday"]
    anatomy = [item for item in tuesday if item["kind"] == "theory"]
    assert [(item["start_time"], item["end_time"], item["code"]) for item in anatomy] == [
        ("09:00", "12:00", "MS110")
    ]


def test_sessions_are_merged_into_one_chronological_week() -> None:
    sessions = _save(_client(_student()), "A", "C").json()["timetable"]["sessions"]
    keys = [(DAY_ORDER.index(item["day"]), item["start_time"]) for item in sessions]
    assert keys == sorted(keys)
    monday = [(item["start_time"], item["kind"]) for item in sessions if item["day"] == "monday"]
    assert monday == [
        ("08:00", "theory"),
        ("10:00", "theory"),
        ("12:00", "practical"),
        ("14:00", "theory"),
    ]


def test_a_year1_student_starts_unconfigured_with_year1_choices() -> None:
    body = _client(_student()).get(URL).json()
    assert body["available"] is True
    assert body["academic_year"] == "year-1"
    assert body["from_cohort"] is True
    assert body["configured"] is False
    assert body["preferences"] is None
    assert body["timetable"]["sessions"] == []
    assert body["options"] == {
        "theory_groups": ["A", "B"],
        "practical_groups": ["A", "B", "C", "D"],
        "subjects": list(CODE),
        "per_subject_overrides": False,
    }


def test_a_year2_student_keeps_the_year2_model() -> None:
    client = _client(_student("year-2"))
    before = client.get(URL).json()
    assert before["academic_year"] == "year-2"
    assert before["configured"] is False
    assert before["options"]["practical_groups"] == list(year2.PRACTICAL_GROUPS)
    assert before["options"]["per_subject_overrides"] is True

    body = _save(client, "A", "C1").json()
    assert body["configured"] is True
    subjects = {item["subject"] for item in body["timetable"]["sessions"]}
    assert subjects == set(year2.SUBJECTS)
    assert all("code" not in item for item in body["timetable"]["sessions"])


def test_groups_from_the_other_year_are_refused() -> None:
    year1_client = _client(_student("year-1"))
    year2_client = _client(_student("year-2"))

    refused = _save(year1_client, "A", "C1")
    assert refused.status_code == 400
    assert refused.json()["error"]["code"] == "my_group_rejected"
    assert _save(year2_client, "A", "C").status_code == 400
    overrides = year1_client.put(
        URL,
        {
            "theory_group": "A",
            "default_practical_group": "C",
            "practical_overrides": {"pharmacology": {"schedule_set": "A", "practical_group": "C1"}},
        },
        format="json",
    )
    assert overrides.status_code == 400
    assert MyGroupPreference.objects.count() == 0


def test_no_timetable_leaks_between_years_when_a_cohort_changes() -> None:
    user = _student("year-2")
    client = _client(user)
    assert _save(client, "B", "D2").status_code == 200

    user.cohort = _cohort("year-1")
    user.save(update_fields=["cohort"])
    moved = client.get(URL).json()
    # The Year 2 choice is not applied to Year 1, and nothing from Year 2 shows.
    assert moved["academic_year"] == "year-1"
    assert moved["configured"] is False
    assert moved["timetable"]["sessions"] == []

    year1_body = _save(client, "A", "B").json()
    assert {item["subject"] for item in year1_body["timetable"]["sessions"]} <= set(CODE)
    assert not {item["subject"] for item in year1_body["timetable"]["sessions"]} & set(
        year2.SUBJECTS
    )
    assert MyGroupPreference.objects.get(user=user).practical_overrides.count() == 0


def test_other_cohorts_have_no_timetable() -> None:
    client = _client(_student("year-1", program="dentistry-benghazi"))
    body = client.get(URL).json()
    assert body["available"] is False
    assert body["academic_year"] is None
    assert body["timetable"]["sessions"] == []
    assert _save(client, "A", "C").status_code == 400


def test_accounts_without_a_cohort_keep_the_year2_timetable() -> None:
    body = _client(create_user(email="legacy@example.com")).get(URL).json()
    assert body["available"] is True
    assert body["academic_year"] == "year-2"
    assert body["from_cohort"] is False


def test_the_choice_is_saved_to_the_account_and_seen_from_any_device() -> None:
    user = _student()
    saved = _save(_client(user), "B", "C").json()

    # Another device or browser: a separate authenticated client, nothing shared.
    elsewhere = _client(User.objects.get(pk=user.pk)).get(URL).json()
    assert elsewhere == saved
    row = MyGroupPreference.objects.get(user=user)
    assert (row.academic_year, row.theory_group, row.default_practical_group) == (
        "year-1",
        "B",
        "C",
    )


def _snapshot(user: User) -> tuple[dict[str, int], dict[str, object]]:
    counts = {
        model._meta.label: model.objects.count()
        for model in apps.get_models()
        if model._meta.managed
        and not model._meta.proxy
        and model._meta.app_label != "class_schedule"
    }
    user.refresh_from_db()
    fields = {
        field.attname: getattr(user, field.attname)
        for field in User._meta.concrete_fields
        if field.attname not in {"last_login", "updated_at"}
    }
    return counts, fields


def test_changing_group_touches_nothing_but_the_group() -> None:
    user = _student()
    client = _client(user)
    assert _save(client, "A", "A").status_code == 200
    before = _snapshot(user)

    changed = _save(client, "B", "D").json()

    assert changed["preferences"]["theory_group"] == "B"
    assert changed["preferences"]["default_practical_group"] == "D"
    # Same cohort (university, specialty, year), and not one row anywhere else
    # created or removed: progress, XP, streaks and subscriptions are untouched.
    assert _snapshot(user) == before
    assert MyGroupPreference.objects.filter(user=user).count() == 1
