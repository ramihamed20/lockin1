"""Admin analytics scoped by University -> Specialty -> Year.

Built on the seeded education tree (Tripoli, Benghazi and Zawiya each teach
Dentistry) plus a Zawiya "Medicine" department, so every assertion is about a
real sibling that must be kept out.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogSubject, LearningObject
from apps.content.tests.helpers import published_pdf
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.education.services import create_node, set_node_status
from apps.education.tests.helpers import create_admin
from apps.questions.admin_services import import_questions
from apps.questions.answering import answer_question
from apps.questions.models import Question
from apps.subscriptions.models import Subscription

from .test_admin_control import _subscription

pytestmark = pytest.mark.django_db

URL = "/api/v1/operations/admin/analytics/scope"


def _client(user: User | None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user)
    return client


def _published(admin: User, parent: EducationNode, kind: str, title: str) -> EducationNode:
    node = create_node(actor=admin, parent=parent, kind=kind, title=title)
    return set_node_status(
        actor=admin,
        node_id=node.id,
        expected_revision=node.revision,
        status=EducationNode.Status.PUBLISHED,
    )


def _zawiya_medicine(admin: User) -> StudentCohort:
    zawiya = EducationNode.objects.get(kind=EducationNode.Kind.COLLEGE, slug="zawiya")
    department = _published(admin, zawiya, EducationNode.Kind.DEPARTMENT, "Medicine")
    year = _published(admin, department, EducationNode.Kind.ACADEMIC_YEAR, "First Year")
    subject = _published(admin, year, EducationNode.Kind.SUBJECT, "Anatomy")
    program = AcademicProgram.objects.create(
        code="medicine-zawiya", name_en="Medicine — Zawiya", name_ar="Medicine"
    )
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Medicine Year 1", name_ar="Medicine Year 1"
    )
    cohort.content_nodes.add(year)
    CatalogSubject.objects.get_or_create(
        source_node=subject,
        defaults={
            "cohort": cohort,
            "title": "Anatomy",
            "slug": "anatomy",
            "material_slug": "medicine-zawiya-year-1-anatomy",
        },
    )
    return cohort


def _cohort(program: str, code: str) -> StudentCohort:
    return StudentCohort.objects.get(program__code=program, code=code)


def _sheet(admin: User, cohort: StudentCohort, label: str) -> Question:
    subject = (
        CatalogSubject.objects.filter(cohort=cohort, is_active=True).order_by("position").first()
    )
    assert subject is not None and subject.source_node is not None
    sheet: LearningObject = published_pdf(actor=admin, node=subject.source_node, title=label)
    import_questions(
        actor=admin,
        sheet=sheet,
        payload={
            "version": "lockin_questions_v1",
            "questions": [
                {
                    "type": "mcq",
                    "question": f"{label}?",
                    "choices": ["Right", "Wrong"],
                    "correct_answer": "Right",
                    "difficulty": "easy",
                }
            ],
        },
        publish=True,
    )
    return Question.objects.get(current_version__prompt=f"{label}?")


def _answer(student: User, question: Question, *, right: bool) -> None:
    version = question.published_version
    assert version is not None
    choice = next(option for option in version.options.all() if option.is_correct is right)
    answer_question(user=student, question=question, choice_ids=[choice.id])


@pytest.fixture
def platform() -> dict[str, Any]:
    admin = create_admin(email="scope-analytics-admin@example.com")
    medicine = _zawiya_medicine(admin)
    cohorts = {
        "z-d-2": _cohort("dentistry-zawiya", "year-2"),
        "z-d-1": _cohort("dentistry-zawiya", "year-1"),
        "z-m-1": medicine,
        "t-d-2": _cohort("dentistry-tripoli", "year-2"),
        "b-d-2": _cohort("dentistry-benghazi", "year-2"),
    }
    questions = {key: _sheet(admin, cohort, f"Sheet {key}") for key, cohort in cohorts.items()}
    # (cohort, student, answers correctly?)
    plan = [
        ("z-d-2", "z-d-2-right", True),
        ("z-d-2", "z-d-2-wrong", False),
        ("z-d-1", "z-d-1-right", True),
        ("z-m-1", "z-m-1-right", True),
        ("t-d-2", "t-d-2-right", True),
        ("b-d-2", "b-d-2-wrong", False),
    ]
    students = {}
    for key, name, right in plan:
        student = create_user(email=f"{name}@example.com", cohort=cohorts[key])
        _answer(student, questions[key], right=right)
        students[name] = student
    _subscription(students["z-d-2-right"])
    trial = _subscription(students["z-d-1-right"])
    trial.status = Subscription.Status.TRIALING
    trial.save(update_fields=("status",))
    return {"admin": admin, "students": students}


def _nodes() -> dict[str, str]:
    def college(slug: str) -> EducationNode:
        return EducationNode.objects.get(kind=EducationNode.Kind.COLLEGE, slug=slug)

    def department(parent: EducationNode, title: str) -> EducationNode:
        return EducationNode.objects.get(
            kind=EducationNode.Kind.DEPARTMENT, parent=parent, title=title
        )

    zawiya, tripoli = college("zawiya"), college("tripoli")
    zawiya_dentistry = department(zawiya, "Dentistry")
    return {
        "zawiya": str(zawiya.id),
        "tripoli": str(tripoli.id),
        "zawiya_dentistry": str(zawiya_dentistry.id),
        "zawiya_medicine": str(department(zawiya, "Medicine").id),
        "tripoli_dentistry": str(department(tripoli, "Dentistry").id),
        "zawiya_dentistry_year_2": str(
            EducationNode.objects.get(parent=zawiya_dentistry, slug="year-2").id
        ),
    }


def _get(admin: User, **params: str) -> dict[str, Any]:
    response = _client(admin).get(URL, params)
    assert response.status_code == 200, response.content
    return response.json()


def test_overall_totals_cover_every_cohort(platform: dict[str, Any]) -> None:
    body = _get(platform["admin"])
    metrics = body["metrics"]

    assert body["scope"]["level"] == "overall"
    # Six students; the administrator is not counted as one.
    assert metrics["students"] == 6
    assert metrics["sheets"] == 5
    assert metrics["published_questions"] == 5
    assert metrics["question_answers"] == 6
    assert metrics["correct_answers"] == 4
    assert metrics["incorrect_answers"] == 2
    assert metrics["accuracy"] == 66.7
    # Correct-only XP: four right answers to easy questions.
    assert metrics["xp_awarded"] == 20
    assert metrics["active_subscriptions"] == 1
    assert metrics["trial_subscriptions"] == 1
    assert metrics["subjects"] == CatalogSubject.objects.filter(is_active=True).count()
    titles = [item["title"] for item in body["options"]["universities"]]
    assert {"Tripoli", "Benghazi", "Zawiya"} <= set(titles)
    assert metrics["universities"] == len(titles)
    assert body["breakdown"]["level"] == "university"
    assert {row["title"] for row in body["breakdown"]["rows"]} == set(titles)


def test_a_university_excludes_every_other_university(platform: dict[str, Any]) -> None:
    nodes = _nodes()
    body = _get(platform["admin"], university=nodes["zawiya"])
    metrics = body["metrics"]

    assert body["scope"]["level"] == "university"
    assert body["scope"]["university"]["title"] == "Zawiya"
    assert metrics["students"] == 4
    assert metrics["sheets"] == 3
    assert metrics["question_answers"] == 4
    assert metrics["correct_answers"] == 3
    assert metrics["xp_awarded"] == 15
    assert metrics["universities"] == 1
    assert metrics["specialties"] == 2
    rows = {row["title"]: row for row in body["breakdown"]["rows"]}
    assert body["breakdown"]["level"] == "specialty"
    assert set(rows) == {"Dentistry", "Medicine"}
    assert rows["Dentistry"]["students"] == 3
    assert rows["Dentistry"]["question_answers"] == 3
    assert rows["Dentistry"]["accuracy"] == 66.7
    assert rows["Medicine"]["students"] == 1
    assert rows["Medicine"]["accuracy"] == 100.0
    assert {item["title"] for item in body["options"]["specialties"]} == {"Dentistry", "Medicine"}


def test_a_specialty_excludes_its_university_siblings(platform: dict[str, Any]) -> None:
    nodes = _nodes()
    body = _get(platform["admin"], university=nodes["zawiya"], specialty=nodes["zawiya_dentistry"])
    metrics = body["metrics"]

    # Zawiya Dentistry only: no Zawiya Medicine, no Tripoli or Benghazi Dentistry.
    assert metrics["students"] == 3
    assert metrics["sheets"] == 2
    assert metrics["question_answers"] == 3
    assert metrics["correct_answers"] == 2
    assert metrics["xp_awarded"] == 10
    assert metrics["active_subscriptions"] == 1
    assert metrics["trial_subscriptions"] == 1
    assert body["breakdown"]["level"] == "year"
    rows = {row["title"]: row["students"] for row in body["breakdown"]["rows"]}
    assert rows == {"First Year": 1, "Second Year": 2}


def test_a_year_excludes_the_other_years(platform: dict[str, Any]) -> None:
    nodes = _nodes()
    body = _get(
        platform["admin"],
        university=nodes["zawiya"],
        specialty=nodes["zawiya_dentistry"],
        year=nodes["zawiya_dentistry_year_2"],
    )
    metrics = body["metrics"]

    assert body["scope"]["level"] == "year"
    assert body["scope"]["year"]["title"] == "Second Year"
    assert metrics["students"] == 2
    assert metrics["sheets"] == 1
    assert metrics["question_answers"] == 2
    assert metrics["correct_answers"] == 1
    assert metrics["incorrect_answers"] == 1
    assert metrics["accuracy"] == 50.0
    assert metrics["xp_awarded"] == 5
    assert metrics["active_subscriptions"] == 1
    assert metrics["trial_subscriptions"] == 0
    assert metrics["subjects"] == 7
    assert body["breakdown"] == {"level": None, "rows": []}


def test_one_specialty_name_in_two_universities_stays_two_scopes(
    platform: dict[str, Any],
) -> None:
    nodes = _nodes()
    tripoli = _get(
        platform["admin"], university=nodes["tripoli"], specialty=nodes["tripoli_dentistry"]
    )
    zawiya = _get(
        platform["admin"], university=nodes["zawiya"], specialty=nodes["zawiya_dentistry"]
    )

    assert tripoli["scope"]["specialty"]["title"] == zawiya["scope"]["specialty"]["title"]
    assert tripoli["metrics"]["students"] == 1
    assert tripoli["metrics"]["question_answers"] == 1
    assert zawiya["metrics"]["students"] == 3
    # A Specialty is resolved only inside its own University.
    crossed = _client(platform["admin"]).get(
        URL, {"university": nodes["tripoli"], "specialty": nodes["zawiya_dentistry"]}
    )
    assert crossed.status_code == 400
    orphan = _client(platform["admin"]).get(URL, {"specialty": nodes["zawiya_dentistry"]})
    assert orphan.status_code == 400


def test_query_count_does_not_grow_with_the_breakdown(platform: dict[str, Any]) -> None:
    client = _client(platform["admin"])
    zawiya = _nodes()["zawiya"]
    client.get(URL)  # warm the session and permission caches
    with CaptureQueriesContext(connection) as overall:
        client.get(URL)
    with CaptureQueriesContext(connection) as university:
        client.get(URL, {"university": zawiya})

    # One grouped query per metric, however many rows the breakdown has.
    assert len(overall) <= 20
    assert len(university) <= len(overall)


def test_only_analytics_operators_can_read_scoped_analytics(platform: dict[str, Any]) -> None:
    student = platform["students"]["z-d-2-right"]

    assert _client(student).get(URL).status_code == 403
    assert _client(None).get(URL).status_code in {401, 403}
