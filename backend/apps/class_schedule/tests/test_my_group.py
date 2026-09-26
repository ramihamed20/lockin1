from collections import Counter

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user

from ..models import MyGroupPracticalOverride, MyGroupPreference
from ..schedule_data import PRACTICAL_GROUPS, PRACTICAL_SESSIONS, SUBJECTS, THEORY_SESSIONS

URL = "/api/v1/my-group"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def practical_cells(schedule_set, group):
    return {
        (session.day, session.start_time, session.end_time): session.subject
        for session in PRACTICAL_SESSIONS
        if session.schedule_set == schedule_set and session.practical_group == group
    }


def practical_by_subject(payload):
    return {
        session["subject"]: session
        for session in payload["timetable"]["sessions"]
        if session["kind"] == "practical"
    }


@pytest.mark.parametrize("schedule_set", ["A", "B"])
@pytest.mark.parametrize("group", PRACTICAL_GROUPS)
def test_every_group_has_each_practical_subject_exactly_once(schedule_set, group) -> None:
    subjects = Counter(
        session.subject
        for session in PRACTICAL_SESSIONS
        if session.schedule_set == schedule_set and session.practical_group == group
    )
    assert subjects == Counter(SUBJECTS)


def test_practical_sets_match_the_published_sheets() -> None:
    assert practical_cells("A", "C1") == {
        ("sunday", "12:00", "14:00"): "pharmacology",
        ("monday", "12:00", "14:00"): "removable_prosthodontics_1",
        ("tuesday", "12:00", "14:00"): "conservative_endodontics_1",
        ("wednesday", "10:00", "12:00"): "oral_histology",
        ("wednesday", "12:00", "14:00"): "fixed_prosthodontics_1",
        ("thursday", "10:00", "12:00"): "general_pathology",
        ("thursday", "12:00", "14:00"): "microbiology",
    }
    assert practical_cells("B", "C1") == {
        ("sunday", "08:00", "10:00"): "pharmacology",
        ("sunday", "10:00", "12:00"): "general_pathology",
        ("monday", "08:00", "10:00"): "removable_prosthodontics_1",
        ("monday", "10:00", "12:00"): "microbiology",
        ("tuesday", "08:00", "10:00"): "conservative_endodontics_1",
        ("wednesday", "08:00", "10:00"): "oral_histology",
        ("thursday", "08:00", "10:00"): "fixed_prosthodontics_1",
    }
    assert practical_cells("A", "D2")[("tuesday", "14:00", "16:00")] == (
        "conservative_endodontics_1"
    )
    # Rows the sheets publish as empty stay empty.
    slots_a = {(s.day, s.start_time) for s in PRACTICAL_SESSIONS if s.schedule_set == "A"}
    slots_b = {(s.day, s.start_time) for s in PRACTICAL_SESSIONS if s.schedule_set == "B"}
    assert ("tuesday", "10:00") not in slots_a
    assert {("sunday", "12:00"), ("wednesday", "10:00"), ("thursday", "10:00")}.isdisjoint(slots_b)


def test_theory_schedules_match_the_published_sheets() -> None:
    def theory(group):
        return {
            (s.day, s.start_time, s.end_time): s.subject
            for s in THEORY_SESSIONS
            if s.theory_group == group
        }

    assert theory("A") == {
        ("sunday", "08:00", "10:00"): "general_pathology",
        ("sunday", "10:00", "12:00"): "fixed_prosthodontics_1",
        ("monday", "08:00", "10:00"): "microbiology",
        ("monday", "10:00", "12:00"): "oral_histology",
        ("tuesday", "08:00", "10:00"): "pharmacology",
        ("wednesday", "08:00", "10:00"): "conservative_endodontics_1",
        ("thursday", "08:00", "10:00"): "removable_prosthodontics_1",
    }
    assert theory("B") == {
        ("sunday", "12:00", "14:00"): "pharmacology",
        ("monday", "12:00", "14:00"): "conservative_endodontics_1",
        ("tuesday", "12:00", "14:00"): "removable_prosthodontics_1",
        ("wednesday", "10:00", "12:00"): "general_pathology",
        ("wednesday", "12:00", "14:00"): "fixed_prosthodontics_1",
        ("thursday", "10:00", "12:00"): "microbiology",
        ("thursday", "12:00", "14:00"): "oral_histology",
    }


@pytest.mark.django_db
def test_student_without_preferences_gets_the_setup_state() -> None:
    response = client_for(create_user()).get(URL)

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is False
    assert body["preferences"] is None
    assert body["timetable"]["sessions"] == []
    assert body["timetable"]["days"] == ["sunday", "monday", "tuesday", "wednesday", "thursday"]
    assert len(body["timetable"]["slots"]) == 4


@pytest.mark.django_db
def test_default_selection_merges_theory_with_the_same_set_practicals() -> None:
    user = create_user()
    client = client_for(user)

    response = client.put(
        URL, {"theory_group": "A", "default_practical_group": "C1"}, format="json"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["preferences"]["practical_overrides"] == {}
    sessions = body["timetable"]["sessions"]
    assert sum(1 for s in sessions if s["kind"] == "theory") == 7
    practical = practical_by_subject(body)
    assert set(practical) == set(SUBJECTS)
    assert {(s["schedule_set"], s["practical_group"]) for s in practical.values()} == {("A", "C1")}
    assert client.get(URL).json() == body


@pytest.mark.django_db
def test_same_practical_name_resolves_differently_per_theory_set() -> None:
    client = client_for(create_user())

    a = client.put(URL, {"theory_group": "A", "default_practical_group": "C1"}, format="json")
    b = client.put(URL, {"theory_group": "B", "default_practical_group": "C1"}, format="json")

    assert practical_by_subject(a.json())["pharmacology"]["day"] == "sunday"
    assert practical_by_subject(a.json())["pharmacology"]["start_time"] == "12:00"
    assert practical_by_subject(b.json())["pharmacology"]["start_time"] == "08:00"
    assert {s["schedule_set"] for s in practical_by_subject(b.json()).values()} == {"B"}


@pytest.mark.django_db
def test_subject_override_replaces_only_that_subject_and_reset_clears_it() -> None:
    user = create_user()
    client = client_for(user)

    response = client.put(
        URL,
        {
            "theory_group": "A",
            "default_practical_group": "C1",
            "practical_overrides": {
                "pharmacology": {"schedule_set": "B", "practical_group": "C1"},
                "oral_histology": {"schedule_set": "A", "practical_group": "B2"},
                # Identical to the default, so it is not stored.
                "microbiology": {"schedule_set": "A", "practical_group": "C1"},
            },
        },
        format="json",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["preferences"]["practical_overrides"] == {
        "oral_histology": {"schedule_set": "A", "practical_group": "B2"},
        "pharmacology": {"schedule_set": "B", "practical_group": "C1"},
    }
    practical = practical_by_subject(body)
    assert practical["pharmacology"] == {
        "kind": "practical",
        "subject": "pharmacology",
        "day": "sunday",
        "start_time": "08:00",
        "end_time": "10:00",
        "schedule_set": "B",
        "practical_group": "C1",
    }
    assert practical["oral_histology"]["day"] == "wednesday"
    assert practical["oral_histology"]["start_time"] == "12:00"
    untouched = {k: v for k, v in practical.items() if k not in {"pharmacology", "oral_histology"}}
    assert {(s["schedule_set"], s["practical_group"]) for s in untouched.values()} == {("A", "C1")}

    reset = client.put(
        URL,
        {"theory_group": "A", "default_practical_group": "C1", "practical_overrides": {}},
        format="json",
    )
    assert reset.json()["preferences"]["practical_overrides"] == {}
    assert not MyGroupPracticalOverride.objects.filter(preference__user=user).exists()
    assert MyGroupPreference.objects.filter(user=user).count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload",
    [
        {"theory_group": "C", "default_practical_group": "C1"},
        {"theory_group": "A", "default_practical_group": "E1"},
        {"theory_group": "A"},
        {"theory_group": "A", "default_practical_group": "C1", "group": "A"},
        {
            "theory_group": "A",
            "default_practical_group": "C1",
            "practical_overrides": {"anatomy": {"schedule_set": "A", "practical_group": "A1"}},
        },
        {
            "theory_group": "A",
            "default_practical_group": "C1",
            "practical_overrides": {"pharmacology": {"schedule_set": "C", "practical_group": "A1"}},
        },
    ],
)
def test_invalid_selections_are_rejected(payload) -> None:
    user = create_user()

    response = client_for(user).put(URL, payload, format="json")

    assert response.status_code == 400
    assert not MyGroupPreference.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_preferences_are_private_to_each_student() -> None:
    owner = create_user(email="group-owner@example.com")
    other = create_user(email="group-other@example.com")
    client_for(owner).put(
        URL, {"theory_group": "B", "default_practical_group": "D2"}, format="json"
    )

    assert client_for(other).get(URL).json()["configured"] is False
    assert APIClient().get(URL).status_code in {401, 403}
    assert APIClient().put(
        URL, {"theory_group": "A", "default_practical_group": "A1"}, format="json"
    ).status_code in {401, 403}
