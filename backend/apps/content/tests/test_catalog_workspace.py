from datetime import timedelta
from uuid import uuid4

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.admin_services import create_sheet
from apps.content.models import (
    CatalogDocument,
    CatalogSubject,
    CatalogWorkspaceSnapshot,
    LearningObjectAsset,
)
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.education.services import create_node, set_node_status
from apps.education.tests.helpers import create_admin, pdf_upload, published_path
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.files.services import create_managed_file

from .helpers import published_pdf

pytestmark = pytest.mark.django_db


def grant_focus(user: User) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="focus.workspace"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def catalog_fixture() -> tuple[CatalogDocument, StudentCohort, StudentCohort]:
    admin = create_admin(email="catalog-admin@example.com")
    _, subject, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson)
    version = learning_object.published_version
    assert version is not None
    asset = LearningObjectAsset.objects.get(version=version, role=LearningObjectAsset.Role.PRIMARY)
    program = AcademicProgram.objects.create(
        code="catalog-program", name_en="Program", name_ar="Program"
    )
    own = StudentCohort.objects.create(program=program, code="own", name_en="Own", name_ar="Own")
    other = StudentCohort.objects.create(
        program=program, code="other", name_en="Other", name_ar="Other"
    )
    own.content_nodes.add(subject)
    document = CatalogDocument.objects.create(
        material_slug="anatomy",
        sheet_slug="cranial-nerves",
        version=version,
        managed_file=asset.managed_file,
    )
    return document, own, other


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_catalog_resolver_enforces_cohort_entitlement_and_publication() -> None:
    document, own, other = catalog_fixture()
    allowed = create_user(email="catalog-own@example.com", cohort=own)
    wrong = create_user(email="catalog-other@example.com", cohort=other)
    no_entitlement = create_user(
        email="catalog-no-entitlement@example.com", cohort=own, verified=False
    )
    grant_focus(allowed)
    grant_focus(wrong)

    resolved = client_for(allowed).get("/api/v1/catalog/documents/anatomy/cranial-nerves")
    denied_cohort = client_for(wrong).get("/api/v1/catalog/documents/anatomy/cranial-nerves")
    denied_entitlement = client_for(no_entitlement).get(
        "/api/v1/catalog/documents/anatomy/cranial-nerves"
    )

    assert resolved.status_code == 200
    assert resolved.json()["document"]["id"] == str(document.id)
    assert resolved.json()["document"]["document_version_id"] == str(document.version_id)
    assert denied_cohort.status_code == 403
    assert denied_entitlement.status_code == 403


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_catalog_materials_are_cohort_scoped_and_published_from_content_studio() -> None:
    admin = create_admin(email="catalog-materials-admin@example.com")
    institution, subject, _ = published_path(admin=admin)
    other_subject = create_node(
        actor=admin,
        parent=institution,
        kind=EducationNode.Kind.SUBJECT,
        title="Human Anatomy — Other cohort",
    )
    other_subject = set_node_status(
        actor=admin,
        node_id=other_subject.id,
        expected_revision=other_subject.revision,
        status=EducationNode.Status.PUBLISHED,
    )
    program = AcademicProgram.objects.create(
        code="catalog-materials", name_en="Catalog Materials", name_ar="Catalog Materials"
    )
    own = StudentCohort.objects.create(program=program, code="own", name_en="Own", name_ar="Own")
    other = StudentCohort.objects.create(
        program=program, code="other", name_en="Other", name_ar="Other"
    )
    own.content_nodes.add(subject)
    own_subject = CatalogSubject.objects.create(
        cohort=own,
        source_node=subject,
        title="Dental Anatomy",
        slug="dental-anatomy",
        material_slug="catalog-materials-own-dental-anatomy",
    )
    CatalogSubject.objects.create(
        cohort=other,
        source_node=other_subject,
        title="Dental Anatomy",
        slug="dental-anatomy",
        material_slug="catalog-materials-other-dental-anatomy",
    )
    sheet = create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf"),
        title="Head and neck",
        summary="",
        position=0,
        publish=True,
        notify_students=False,
        allow_download=False,
    )
    document = CatalogDocument.objects.get(version__learning_object=sheet)
    assert document.material_slug == own_subject.material_slug

    own_student = create_user(email="catalog-materials-own@example.com", cohort=own)
    other_student = create_user(email="catalog-materials-other@example.com", cohort=other)
    own_directory = client_for(own_student).get("/api/v1/catalog/materials")
    other_directory = client_for(other_student).get("/api/v1/catalog/materials")
    forbidden = client_for(other_student).get(
        f"/api/v1/catalog/documents/{document.material_slug}/{document.sheet_slug}"
    )
    founder_directory = client_for(admin).get("/api/v1/catalog/materials")

    assert own_directory.status_code == 200
    assert own_directory.json()["results"] == [
        {
            "slug": own_subject.material_slug,
            "title": "Dental Anatomy",
            "sheets": [
                {
                    "slug": document.sheet_slug,
                    "number": 1,
                    "title": "Head and neck",
                    "summary": "",
                    "pageCount": None,
                    "hasActiveStudy": False,
                    "deliverable": True,
                }
            ],
            "cohort": {"program_code": "catalog-materials", "cohort_code": "own", "name": "Own"},
        }
    ]
    assert other_directory.status_code == 200
    assert [item["slug"] for item in other_directory.json()["results"]] == [
        "catalog-materials-other-dental-anatomy"
    ]
    assert forbidden.status_code == 403
    assert {
        own_subject.material_slug,
        "catalog-materials-other-dental-anatomy",
    } <= {item["slug"] for item in founder_directory.json()["results"]}

    document.managed_file.scan_status = document.managed_file.ScanStatus.QUARANTINED
    document.managed_file.save(update_fields=("scan_status",))
    unavailable_directory = client_for(own_student).get("/api/v1/catalog/materials")
    unavailable_resolver = client_for(own_student).get(
        f"/api/v1/catalog/documents/{document.material_slug}/{document.sheet_slug}"
    )
    assert unavailable_directory.json()["results"][0]["sheets"][0]["deliverable"] is False
    assert unavailable_resolver.status_code == 409
    assert unavailable_resolver.json()["error"]["code"] == "file_unavailable"


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_generic_publish_projects_lesson_pdf_into_owning_catalog_subject() -> None:
    admin = create_admin(email="generic-catalog-publish@example.com")
    _, subject, lesson = published_path(admin=admin)
    program = AcademicProgram.objects.create(
        code="generic-catalog", name_en="Generic", name_ar="Generic"
    )
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Year 1", name_ar="Year 1"
    )
    cohort.content_nodes.add(subject)
    catalog_subject = CatalogSubject.objects.create(
        cohort=cohort,
        source_node=subject,
        title="Anatomy",
        slug="anatomy",
        material_slug="generic-catalog-anatomy",
    )
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    client = client_for(admin)
    created = client.post(
        "/api/v1/management/content",
        {
            "academic_node_id": str(lesson.id),
            "content_type": "pdf",
            "title": "Lesson-level atlas",
            "primary_file_id": str(managed_file.id),
        },
        format="json",
    ).json()
    submitted = client.post(
        f"/api/v1/management/content/{created['id']}/submit",
        {"expected_revision": created["revision"]},
        format="json",
    ).json()

    published = client.post(
        f"/api/v1/management/content/{created['id']}/publish",
        {"expected_revision": submitted["revision"]},
        format="json",
    )

    assert published.status_code == 200
    document = CatalogDocument.objects.get(version__learning_object_id=created["id"])
    assert document.material_slug == catalog_subject.material_slug
    student = create_user(email="generic-catalog-student@example.com", cohort=cohort)
    directory = client_for(student).get("/api/v1/catalog/materials")
    assert directory.json()["results"][0]["sheets"][0]["slug"] == document.sheet_slug


def test_catalog_sync_refreshes_material_slug_without_changing_sheet_slug() -> None:
    from apps.content.admin_services import _sync_catalog_document

    admin = create_admin(email="catalog-slug-refresh@example.com")
    _, subject, _ = published_path(admin=admin)
    program = AcademicProgram.objects.create(
        code="slug-refresh", name_en="Slug", name_ar="Slug"
    )
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Year 1", name_ar="Year 1"
    )
    cohort.content_nodes.add(subject)
    catalog_subject = CatalogSubject.objects.create(
        cohort=cohort,
        source_node=subject,
        title="Anatomy",
        slug="anatomy",
        material_slug="slug-refresh-old",
    )
    sheet = create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf"),
        title="Stable route sheet",
        summary="",
        position=0,
        publish=True,
        notify_students=False,
        allow_download=False,
    )
    document = CatalogDocument.objects.get(version__learning_object=sheet)
    sheet_slug = document.sheet_slug
    catalog_subject.material_slug = "slug-refresh-new"
    catalog_subject.save(update_fields=("material_slug", "updated_at"))

    assert _sync_catalog_document(sheet) is True
    document.refresh_from_db()
    assert document.material_slug == "slug-refresh-new"
    assert document.sheet_slug == sheet_slug


def test_founder_content_panel_exposes_every_configured_catalog_branch() -> None:
    founder = create_admin(email="configured-catalog-founder@example.com")
    client = client_for(founder)

    response = client.get("/api/v1/operations/admin/content/subjects")

    assert response.status_code == 200
    subjects = response.json()["results"]
    paths = {
        (item["college_title"], item["specialty_title"], item["academic_year_title"])
        for item in subjects
    }
    expected = {
        (college, "Dentistry", year)
        for college in ("Tripoli", "Benghazi", "Zawiya")
        for year in ("First Year", "Second Year")
    } | {
        ("Tripoli", "Human Medicine", "Batch 60"),
        ("Tripoli", "Human Medicine", "Batch 61"),
    }
    assert expected <= paths
    assert all(item["academic_year_title"] != "Third Year" for item in subjects)

    # Every branch enters the same sheet-management flow; a subject never
    # falls back to an unscoped/global sheet collection.
    for subject in subjects:
        sheets = client.get(f"/api/v1/operations/admin/content/subjects/{subject['id']}/sheets")
        assert sheets.status_code == 200
        assert sheets.json()["subject"]["id"] == subject["id"]


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_catalog_workspace_is_revisioned_idempotent_and_owner_isolated() -> None:
    document, own, _ = catalog_fixture()
    first = create_user(email="catalog-first@example.com", cohort=own)
    second = create_user(email="catalog-second@example.com", cohort=own)
    grant_focus(first)
    grant_focus(second)
    first_client = client_for(first)
    second_client = client_for(second)
    url = f"/api/v1/catalog/documents/{document.id}/workspace"
    key = str(uuid4())
    payload = {
        "expected_revision": 0,
        "idempotency_key": key,
        "state": {"page": 4, "notes": [{"id": "n1", "body": "private"}]},
    }

    saved = first_client.patch(url, payload, format="json")
    replayed = first_client.patch(url, payload, format="json")
    stale = first_client.patch(url, {**payload, "idempotency_key": str(uuid4())}, format="json")
    restored = first_client.get(url)
    restored_on_second_session = client_for(first).get(url)
    isolated = second_client.get(url)

    assert saved.status_code == 200 and saved.json()["revision"] == 1
    assert replayed.status_code == 200 and replayed.json()["replayed"] is True
    assert stale.status_code == 409
    assert restored.json()["state"]["notes"][0]["body"] == "private"
    assert restored_on_second_session.json() == restored.json()
    assert isolated.json() == {"revision": 0, "state": {}}
    assert CatalogWorkspaceSnapshot.objects.filter(document=document).count() == 2


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_catalog_annotations_are_bound_to_immutable_document_version() -> None:
    document, own, _ = catalog_fixture()
    student = create_user(email="catalog-annotations@example.com", cohort=own)
    grant_focus(student)
    client = client_for(student)
    annotation_id = str(uuid4())
    response = client.post(
        f"/api/v1/focus/documents/{document.version_id}/annotations",
        {
            "expected_collection_revision": 0,
            "idempotency_key": str(uuid4()),
            "annotations": [
                {
                    "id": annotation_id,
                    "page_number": 1,
                    "tool": "text",
                    "layer_key": "personal",
                    "bounds": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1},
                    "payload": {"kind": "text", "value": "server note"},
                    "color": "#112233",
                    "thickness": 2,
                    "opacity": 1,
                }
            ],
            "deleted_ids": [],
        },
        format="json",
    )
    loaded = client.get(f"/api/v1/focus/documents/{document.version_id}/annotations?pages=1")

    replacement_object = published_pdf(
        actor=document.version.created_by,
        node=document.version.academic_node,
        title="Replacement PDF version",
    )
    replacement_version = replacement_object.published_version
    assert replacement_version is not None
    replacement_asset = LearningObjectAsset.objects.get(
        version=replacement_version,
        role=LearningObjectAsset.Role.PRIMARY,
    )
    replacement = CatalogDocument.objects.create(
        material_slug="anatomy-v2",
        sheet_slug="cranial-nerves-v2",
        version=replacement_version,
        managed_file=replacement_asset.managed_file,
    )
    isolated = client.get(f"/api/v1/focus/documents/{replacement.version_id}/annotations?pages=1")

    assert response.status_code == 200
    assert loaded.status_code == 200
    assert loaded.json()["results"][0]["id"] == annotation_id
    assert isolated.status_code == 200
    assert isolated.json()["results"] == []
