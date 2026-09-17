"""The College -> Specialty -> Year an operator navigates by, in Admin -> Questions.

The Year had been read from the tail of the cohort's display name, and the
specialty hard-coded to "Dentistry" for every program that was not Human
Medicine. Both are guesses, and both were wrong for a real program: "Preparatory
Medical Sciences - Tripoli" was offered as specialty "Dentistry", Year
"Tripoli". These tests pin each level to the record that actually owns it.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.content.catalog_subjects import study_paths_for
from apps.content.models import CatalogSubject
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.education.services import create_node, set_node_status
from apps.education.tests.helpers import create_admin

from .helpers import published_pdf

pytestmark = pytest.mark.django_db


def _published(admin: User, parent: EducationNode | None, kind: str, title: str) -> EducationNode:
    node = create_node(actor=admin, parent=parent, kind=kind, title=title)
    return set_node_status(
        actor=admin,
        node_id=node.id,
        expected_revision=node.revision,
        status=EducationNode.Status.PUBLISHED,
    )


def _branch(
    *,
    admin: User,
    parent: EducationNode,
    program: AcademicProgram,
    cohort_code: str,
    subject_title: str,
) -> CatalogSubject:
    subject_node = _published(admin, parent, EducationNode.Kind.SUBJECT, subject_title)
    cohort = StudentCohort.objects.create(
        program=program,
        code=cohort_code,
        # Deliberately misleading: the old derivation read this name's tail as
        # the Year, so a name ending in a campus produced a campus as a Year.
        name_en=f"{subject_title} — Tripoli",
        name_ar=subject_title,
    )
    cohort.content_nodes.add(parent)
    return CatalogSubject.objects.create(
        cohort=cohort,
        source_node=subject_node,
        title=subject_title,
        slug=subject_title.lower().replace(" ", "-"),
        material_slug=f"{program.code}-{cohort_code}-{subject_title.lower().replace(' ', '-')}",
    )


def test_the_year_is_the_academic_year_node_and_the_specialty_is_the_program() -> None:
    admin = create_admin(email="study-path-admin@example.com")
    institution = _published(admin, None, EducationNode.Kind.INSTITUTION, "Lock-in University")
    department = _published(admin, institution, EducationNode.Kind.DEPARTMENT, "Dentistry")
    year_node = _published(admin, department, EducationNode.Kind.ACADEMIC_YEAR, "Second Year")
    program = AcademicProgram.objects.create(
        code="dentistry-zawiyah", name_en="Dentistry — Zawiyah", name_ar="Dentistry"
    )
    subject = _branch(
        admin=admin,
        parent=year_node,
        program=program,
        cohort_code="year-2",
        subject_title="Oral Histology",
    )

    path = study_paths_for([subject])[subject.id]

    assert path.college_title == "Zawiyah"
    assert path.specialty_title == "Dentistry"
    # The curriculum's own name for the year, not a label reconstructed from a
    # code and not the tail of the cohort's display name.
    assert path.academic_year_title == "Second Year"
    assert path.academic_year_key == "second-year"


def test_a_program_without_an_academic_year_node_is_still_filed_correctly() -> None:
    admin = create_admin(email="study-path-prep-admin@example.com")
    institution = _published(admin, None, EducationNode.Kind.INSTITUTION, "Lock-in University")
    department = _published(admin, institution, EducationNode.Kind.DEPARTMENT, "Medical Sciences")
    program = AcademicProgram.objects.create(
        # A code of its own; the seeded deployment already owns the real one.
        code="medical-sciences-tripoli-prep",
        name_en="Medical Sciences — Tripoli",
        name_ar="Medical Sciences",
    )
    subject = _branch(
        admin=admin,
        parent=department,
        program=program,
        cohort_code="preparatory",
        subject_title="Foundation Biology",
    )

    path = study_paths_for([subject])[subject.id]

    # This is the branch the old derivation filed as specialty "Dentistry",
    # Year "Tripoli".
    assert path.specialty_title == "Medical Sciences"
    assert path.college_title == "Tripoli"
    assert path.academic_year_title == "Preparatory"
    assert path.academic_year_key == "preparatory"


def test_two_colleges_share_one_year_choice_while_keeping_separate_subjects() -> None:
    admin = create_admin(email="study-path-shared-admin@example.com")
    institution = _published(admin, None, EducationNode.Kind.INSTITUTION, "Lock-in University")
    subjects = []
    for campus in ("Tripoli", "Benghazi"):
        department = _published(admin, institution, EducationNode.Kind.DEPARTMENT, campus)
        year_node = _published(admin, department, EducationNode.Kind.ACADEMIC_YEAR, "First Year")
        program = AcademicProgram.objects.create(
            code=f"dentistry-{campus.lower()}-shared",
            name_en=f"Dentistry — {campus}",
            name_ar="Dentistry",
        )
        subjects.append(
            _branch(
                admin=admin,
                parent=year_node,
                program=program,
                cohort_code="year-1",
                subject_title=f"Dental Anatomy {campus}",
            )
        )

    paths = study_paths_for(subjects)

    # One Year choice in the filter, two colleges, and the subjects stay apart:
    # this is what stops one year's questions surfacing under another's.
    assert {paths[subject.id].academic_year_key for subject in subjects} == {"first-year"}
    assert {paths[subject.id].college_key for subject in subjects} == {"tripoli", "benghazi"}


def test_the_admin_subject_list_publishes_a_key_for_every_study_path_level() -> None:
    admin = create_admin(email="study-path-api-admin@example.com")
    institution = _published(admin, None, EducationNode.Kind.INSTITUTION, "Lock-in University")
    department = _published(admin, institution, EducationNode.Kind.DEPARTMENT, "Dentistry")
    year_node = _published(admin, department, EducationNode.Kind.ACADEMIC_YEAR, "Third Year")
    program = AcademicProgram.objects.create(
        code="dentistry-misrata", name_en="Dentistry — Misrata", name_ar="Dentistry"
    )
    subject = _branch(
        admin=admin,
        parent=year_node,
        program=program,
        cohort_code="year-3",
        subject_title="Endodontics",
    )
    source_node = subject.source_node
    assert source_node is not None
    # A Third Year branch is only offered once it holds real work.
    published_pdf(actor=admin, node=source_node, title="Endodontics sheet 1")

    client = APIClient()
    client.force_authenticate(admin)
    response = client.get("/api/v1/operations/admin/content/subjects")

    assert response.status_code == 200
    row = next(item for item in response.json()["results"] if item["id"] == str(subject.id))
    assert row["college_title"] == "Misrata"
    assert row["college_key"] == "misrata"
    assert row["specialty_title"] == "Dentistry"
    assert row["specialty_key"] == "dentistry"
    assert row["academic_year_title"] == "Third Year"
    assert row["academic_year_key"] == "third-year"
    assert row["cohort_code"] == "year-3"
