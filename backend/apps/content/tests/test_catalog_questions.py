"""Questions is a second view of the Materials catalog, not a catalog of its own.

A sheet an administrator creates under Material has to be the same sheet the
Questions admin lists and the same sheet a student answers -- under one title,
for one cohort. These tests hold that identity, and hold the boundary that keeps
one year's questions out of another year's Questions section.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogSubject, LearningObject
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.education.services import create_node, set_node_status
from apps.education.tests.helpers import create_admin
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.questions.admin_services import import_questions

from .helpers import published_pdf

pytestmark = pytest.mark.django_db


def _grant_premium(user: User) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="content.premium"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def _client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _published(admin: User, parent: EducationNode | None, kind: str, title: str) -> EducationNode:
    node = create_node(actor=admin, parent=parent, kind=kind, title=title)
    return set_node_status(
        actor=admin,
        node_id=node.id,
        expected_revision=node.revision,
        status=EducationNode.Status.PUBLISHED,
    )


def _payload(prompt: str) -> dict[str, object]:
    return {
        "version": "lockin_questions_v1",
        "questions": [
            {
                "type": "mcq",
                "question": prompt,
                "choices": ["Basal", "Spinous", "Granular", "Cornified"],
                "correct_answer": "Basal",
                "explanation": "Melanocytes reside in the basal layer.",
                "difficulty": "easy",
                "topic": "Epidermis",
                "source_page": 7,
            }
        ],
    }


def _year_fixture() -> dict[str, object]:
    """Two years of one specialty, each with its own cohort, subject and sheet."""

    admin = create_admin(email="catalog-questions-admin@example.com")
    institution = _published(admin, None, EducationNode.Kind.INSTITUTION, "Lock-in University")
    department = _published(admin, institution, EducationNode.Kind.DEPARTMENT, "Dentistry")
    program = AcademicProgram.objects.create(
        code="dentistry-testville", name_en="Dentistry — Testville", name_ar="Dentistry"
    )

    years: dict[str, dict[str, object]] = {}
    for code, title in (("year-1", "First Year"), ("year-2", "Second Year")):
        year_node = _published(admin, department, EducationNode.Kind.ACADEMIC_YEAR, title)
        subject_node = _published(
            admin, year_node, EducationNode.Kind.SUBJECT, f"Oral Histology {code}"
        )
        cohort = StudentCohort.objects.create(
            program=program, code=code, name_en=title, name_ar=title
        )
        cohort.content_nodes.add(year_node)
        subject = CatalogSubject.objects.create(
            cohort=cohort,
            source_node=subject_node,
            title=f"Oral Histology {code}",
            slug=f"oral-histology-{code}",
            material_slug=f"dentistry-testville-{code}-oral-histology",
        )
        sheet = published_pdf(actor=admin, node=subject_node, title=f"Sheet for {title}")
        import_questions(
            actor=admin,
            sheet=sheet,
            payload=_payload(f"Which layer is named in {title}?"),
            publish=True,
        )
        student = create_user(email=f"catalog-questions-{code}@example.com", cohort=cohort)
        _grant_premium(student)
        years[code] = {
            "subject": subject,
            "sheet": sheet,
            "student": student,
            "title": title,
        }
    return {"admin": admin, "years": years}


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_material_sheet_with_published_questions_reaches_its_own_students() -> None:
    fixture = _year_fixture()
    years = fixture["years"]
    assert isinstance(years, dict)
    first = years["year-1"]
    subject = first["subject"]
    sheet = first["sheet"]
    student = first["student"]
    assert isinstance(subject, CatalogSubject)
    assert isinstance(sheet, LearningObject)
    assert isinstance(student, User)

    directory = _client(student).get("/api/v1/catalog/questions")

    assert directory.status_code == 200
    results = directory.json()["results"]
    # One subject only: the reader's own. The sheet is listed under the title
    # the administrator gave it, not a title invented for Questions.
    assert [item["slug"] for item in results] == [subject.material_slug]
    listed = results[0]["sheets"]
    assert [item["title"] for item in listed] == ["Sheet for First Year"]
    assert [item["id"] for item in listed] == [str(sheet.id)]
    assert listed[0]["questionCount"] == 1
    assert results[0]["questionCount"] == 1

    answered = _client(student).get(f"/api/v1/catalog/sheets/{sheet.id}/questions")

    assert answered.status_code == 200
    body = answered.json()
    assert body["sheet"]["title"] == "Sheet for First Year"
    assert body["sheet"]["material_slug"] == subject.material_slug
    assert body["count"] == 1
    question = body["results"][0]
    assert question["prompt"] == "Which layer is named in First Year?"
    assert [choice["text"] for choice in question["choices"] if choice["is_correct"]] == ["Basal"]


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_questions_never_leak_between_years() -> None:
    fixture = _year_fixture()
    years = fixture["years"]
    assert isinstance(years, dict)
    first, second = years["year-1"], years["year-2"]
    first_student, second_student = first["student"], second["student"]
    first_sheet, second_sheet = first["sheet"], second["sheet"]
    assert isinstance(first_student, User)
    assert isinstance(second_student, User)
    assert isinstance(first_sheet, LearningObject)
    assert isinstance(second_sheet, LearningObject)

    second_directory = _client(second_student).get("/api/v1/catalog/questions").json()
    crossing = _client(second_student).get(f"/api/v1/catalog/sheets/{first_sheet.id}/questions")

    # Each year sees exactly one subject and one sheet, and it is its own.
    assert [item["sheets"][0]["id"] for item in second_directory["results"]] == [
        str(second_sheet.id)
    ]
    assert [item["sheets"][0]["title"] for item in second_directory["results"]] == [
        "Sheet for Second Year"
    ]
    # Reaching for the other year's sheet directly is refused rather than
    # answered with an empty list, which would read as "no questions yet".
    assert crossing.status_code == 403


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_sheet_without_published_questions_stays_out_of_the_questions_directory() -> None:
    fixture = _year_fixture()
    admin, years = fixture["admin"], fixture["years"]
    assert isinstance(admin, User)
    assert isinstance(years, dict)
    first = years["year-1"]
    subject, student = first["subject"], first["student"]
    assert isinstance(subject, CatalogSubject)
    assert isinstance(student, User)
    source_node = subject.source_node
    assert source_node is not None

    # A second Material sheet in the same subject, and a draft import into it.
    quiet = published_pdf(actor=admin, node=source_node, title="Sheet with no live questions")
    import_questions(actor=admin, sheet=quiet, payload=_payload("Draft only"), publish=False)

    directory = _client(student).get("/api/v1/catalog/questions").json()
    fetched = _client(student).get(f"/api/v1/catalog/sheets/{quiet.id}/questions")

    # Drafted questions are not student-visible, so the sheet is a Materials
    # entry and nothing more -- but the sheet itself is still reachable, and
    # answers with an honest empty list rather than a refusal.
    titles = [item["title"] for item in directory["results"][0]["sheets"]]
    assert titles == ["Sheet for First Year"]
    assert fetched.status_code == 200
    assert fetched.json()["count"] == 0
