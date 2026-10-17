import pytest
from django.test import override_settings

from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogDocument, CatalogSubject, LearningObjectAsset
from apps.education.models import AcademicProgram, StudentCohort
from apps.education.tests.helpers import create_admin, published_path

from .helpers import published_pdf
from .test_catalog_workspace import client_for, grant_focus

pytestmark = pytest.mark.django_db

DOCUMENT_URL = "/api/v1/catalog/documents/dentistry-test-year-1-anatomy/cranial-nerves"


def dentistry_fixture() -> tuple[StudentCohort, StudentCohort]:
    admin = create_admin(email="added-subjects-admin@example.com")
    _, subject, lesson = published_path(admin=admin)
    version = published_pdf(actor=admin, node=lesson).published_version
    assert version is not None
    asset = LearningObjectAsset.objects.get(version=version, role=LearningObjectAsset.Role.PRIMARY)
    program = AcademicProgram.objects.create(
        code="dentistry-test", name_en="Dentistry", name_ar="Dentistry"
    )
    year_1 = StudentCohort.objects.create(
        program=program, code="year-1", name_en="First", name_ar="First", position=1
    )
    year_2 = StudentCohort.objects.create(
        program=program, code="year-2", name_en="Second", name_ar="Second", position=2
    )
    year_1.content_nodes.add(subject)
    CatalogSubject.objects.create(
        cohort=year_1,
        source_node=subject,
        title="Dental Anatomy",
        slug="anatomy",
        material_slug="dentistry-test-year-1-anatomy",
        position=1,
    )
    for position, slug in ((2, "physiology"), (3, "biochemistry")):
        CatalogSubject.objects.create(
            cohort=year_1,
            title=slug.title(),
            slug=slug,
            material_slug=f"dentistry-test-year-1-{slug}",
            position=position,
        )
    CatalogDocument.objects.create(
        material_slug="dentistry-test-year-1-anatomy",
        sheet_slug="cranial-nerves",
        version=version,
        managed_file=asset.managed_file,
    )
    return year_1, year_2


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_second_year_student_adds_up_to_two_first_year_subjects() -> None:
    year_1, year_2 = dentistry_fixture()
    student = create_user(email="added-subjects-student@example.com", cohort=year_2)
    grant_focus(student)
    client = client_for(student)

    assert client.get(DOCUMENT_URL).status_code == 403
    options = client.get("/api/v1/catalog/added-subjects").json()
    assert options["eligible"] is True
    assert options["limit"] == 2
    assert [item["slug"] for item in options["available"]] == [
        "dentistry-test-year-1-anatomy",
        "dentistry-test-year-1-physiology",
        "dentistry-test-year-1-biochemistry",
    ]

    added = client.post(
        "/api/v1/catalog/added-subjects",
        {"material_slug": "dentistry-test-year-1-anatomy"},
        format="json",
    )
    assert added.status_code == 201
    assert added.json()["added"] == ["dentistry-test-year-1-anatomy"]
    assert client.get(DOCUMENT_URL).status_code == 200
    materials = client.get("/api/v1/catalog/materials").json()["results"]
    anatomy = next(item for item in materials if item["slug"] == "dentistry-test-year-1-anatomy")
    assert anatomy["added"] is True
    assert len(anatomy["sheets"]) == 1

    assert (
        client.post(
            "/api/v1/catalog/added-subjects",
            {"material_slug": "dentistry-test-year-1-physiology"},
            format="json",
        ).status_code
        == 201
    )
    over_limit = client.post(
        "/api/v1/catalog/added-subjects",
        {"material_slug": "dentistry-test-year-1-biochemistry"},
        format="json",
    )
    assert over_limit.status_code == 400
    assert over_limit.json()["error"]["code"] == "added_subject_limit"

    # Added subjects are final: there is no self-service removal.
    assert client.delete(
        "/api/v1/catalog/added-subjects/dentistry-test-year-1-anatomy"
    ).status_code in {404, 405}


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_change_goes_through_an_approved_request() -> None:
    _, year_2 = dentistry_fixture()
    student = create_user(email="added-subjects-changer@example.com", cohort=year_2)
    grant_focus(student)
    client = client_for(student)
    for slug in ("anatomy", "physiology"):
        client.post(
            "/api/v1/catalog/added-subjects",
            {"material_slug": f"dentistry-test-year-1-{slug}"},
            format="json",
        )

    not_added = client.post(
        "/api/v1/catalog/added-subjects/change-requests",
        {"remove": "dentistry-test-year-1-biochemistry", "add": "dentistry-test-year-1-anatomy"},
        format="json",
    )
    assert not_added.json()["error"]["code"] == "subject_not_added"

    asked = client.post(
        "/api/v1/catalog/added-subjects/change-requests",
        {
            "remove": "dentistry-test-year-1-anatomy",
            "add": "dentistry-test-year-1-biochemistry",
            "note": "Wrong subject",
        },
        format="json",
    )
    assert asked.status_code == 201
    pending = asked.json()["pending_request"]
    assert pending["remove"]["slug"] == "dentistry-test-year-1-anatomy"
    # Nothing changes until an operator decides.
    assert asked.json()["added"] == [
        "dentistry-test-year-1-anatomy",
        "dentistry-test-year-1-physiology",
    ]
    second = client.post(
        "/api/v1/catalog/added-subjects/change-requests",
        {"remove": "dentistry-test-year-1-physiology", "add": "dentistry-test-year-1-biochemistry"},
        format="json",
    )
    assert second.json()["error"]["code"] == "subject_change_pending"

    assert client.get("/api/v1/operations/admin/subject-requests").status_code == 403
    admin = client_for(
        create_user(email="added-subjects-owner@example.com", is_superuser=True, is_staff=True)
    )
    listed = admin.get("/api/v1/operations/admin/subject-requests?status=pending").json()
    assert listed["results"][0]["user"]["email"] == student.email
    approved = admin.post(
        f"/api/v1/operations/admin/subject-requests/{pending['id']}",
        {"decision": "approve"},
        format="json",
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    after = client.get("/api/v1/catalog/added-subjects").json()
    assert after["added"] == [
        "dentistry-test-year-1-biochemistry",
        "dentistry-test-year-1-physiology",
    ]
    assert after["pending_request"] is None
    assert client.get(DOCUMENT_URL).status_code == 403
    again = admin.post(
        f"/api/v1/operations/admin/subject-requests/{pending['id']}",
        {"decision": "decline"},
        format="json",
    )
    assert again.json()["error"]["code"] == "already_decided"


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_only_second_year_dentistry_can_add_and_a_cohort_change_revokes() -> None:
    year_1, year_2 = dentistry_fixture()
    first_year = create_user(email="added-subjects-first@example.com", cohort=year_1)
    refused = client_for(first_year).post(
        "/api/v1/catalog/added-subjects",
        {"material_slug": "dentistry-test-year-1-anatomy"},
        format="json",
    )
    assert refused.status_code == 400
    assert client_for(first_year).get("/api/v1/catalog/added-subjects").json()["eligible"] is False

    student = create_user(email="added-subjects-mover@example.com", cohort=year_2)
    grant_focus(student)
    client_for(student).post(
        "/api/v1/catalog/added-subjects",
        {"material_slug": "dentistry-test-year-1-anatomy"},
        format="json",
    )
    year_3 = StudentCohort.objects.create(
        program=year_2.program, code="year-3", name_en="Third", name_ar="Third"
    )
    student.cohort = year_3
    student.save(update_fields=["cohort"])
    assert client_for(student).get(DOCUMENT_URL).status_code == 403
    slugs = [
        item["slug"]
        for item in client_for(student).get("/api/v1/catalog/materials").json()["results"]
    ]
    assert "dentistry-test-year-1-anatomy" not in slugs
