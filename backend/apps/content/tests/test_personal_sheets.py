import io
import uuid
from datetime import timedelta
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from pypdf import PdfWriter
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogSubject, PersonalSheet
from apps.education.models import AcademicProgram, StudentCohort
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.files.models import ManagedFile
from apps.focus.models import FocusAnnotation, FocusAnnotationCollection

pytestmark = pytest.mark.django_db


def pdf_file(name: str = "notes.pdf", pages: int = 2) -> SimpleUploadedFile:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    buffer = io.BytesIO()
    writer.write(buffer)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="application/pdf")


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def subjects() -> tuple[CatalogSubject, CatalogSubject]:
    program = AcademicProgram.objects.create(
        code="personal-program", name_en="Dentistry", name_ar="Dentistry"
    )
    own = StudentCohort.objects.create(
        program=program, code="personal-own", name_en="Year 2", name_ar="Year 2"
    )
    other = StudentCohort.objects.create(
        program=program, code="personal-other", name_en="Year 4", name_ar="Year 4"
    )
    anatomy = CatalogSubject.objects.create(
        cohort=own, title="Anatomy", slug="anatomy", material_slug="year-2-anatomy"
    )
    surgery = CatalogSubject.objects.create(
        cohort=other, title="Surgery", slug="surgery", material_slug="year-4-surgery"
    )
    return anatomy, surgery


def url(subject: CatalogSubject) -> str:
    return f"/api/v1/catalog/materials/{subject.material_slug}/personal-sheets"


def upload(client: APIClient, subject: CatalogSubject, title: str, **kwargs: object):
    return client.post(
        url(subject), {"title": title, "file": pdf_file(**kwargs)}, format="multipart"
    )


def test_student_adds_lists_and_reads_own_sheets_newest_first(subjects) -> None:
    anatomy, _ = subjects
    student = create_user(email="personal-owner@example.com", cohort=anatomy.cohort)
    client = client_for(student)

    first = upload(client, anatomy, "  Skull   notes ", pages=3)
    second = upload(client, anatomy, "Muscles")

    assert first.status_code == 201, first.content
    assert first.json()["sheet"]["title"] == "Skull notes"
    assert first.json()["sheet"]["page_count"] == 3
    assert first.json()["sheet"]["active_study"] == {"status": "unavailable"}
    assert second.json()["limits"]["used"] == 2
    listed = client.get(url(anatomy)).json()
    assert [sheet["title"] for sheet in listed["results"]] == ["Muscles", "Skull notes"]
    assert listed["subject"] == {"slug": anatomy.material_slug, "title": "Anatomy"}
    assert listed["limits"] == {
        "max_sheets": 20,
        "max_file_bytes": 20 * 1024 * 1024,
        "used": 2,
        "remaining": 18,
    }

    view_url = listed["results"][0]["view_url"]
    assert view_url.startswith("/api/v1/files/") and view_url.endswith("/view")
    assert client.get(view_url).status_code == 200


def test_sheets_are_private_to_their_owner(subjects) -> None:
    anatomy, _ = subjects
    owner = create_user(email="personal-private-owner@example.com", cohort=anatomy.cohort)
    classmate = create_user(email="personal-classmate@example.com", cohort=anatomy.cohort)
    created = upload(client_for(owner), anatomy, "Private").json()["sheet"]
    other = client_for(classmate)

    assert other.get(url(anatomy)).json()["results"] == []
    assert other.get(f"/api/v1/personal-sheets/{created['id']}").status_code == 404
    assert other.get(created["view_url"]).status_code == 404
    detail = client_for(owner).get(f"/api/v1/personal-sheets/{created['id']}")
    assert detail.status_code == 200
    assert detail.json()["subject"]["slug"] == anatomy.material_slug

    deleted = other.post("/api/v1/personal-sheets/delete", {"ids": [created["id"]]}, format="json")
    assert deleted.json()["deleted"] == 0
    assert PersonalSheet.objects.filter(id=created["id"]).exists()


def test_subject_outside_the_students_cohort_is_not_found(subjects) -> None:
    anatomy, surgery = subjects
    student = create_user(email="personal-cohort@example.com", cohort=anatomy.cohort)
    client = client_for(student)

    assert client.get(url(surgery)).status_code == 404
    assert upload(client, surgery, "Sneaky").status_code == 404
    assert not PersonalSheet.objects.exists()


def test_unverified_account_is_denied(subjects) -> None:
    anatomy, _ = subjects
    student = create_user(
        email="personal-unverified@example.com", cohort=anatomy.cohort, verified=False
    )
    assert client_for(student).get(url(anatomy)).status_code == 403


def test_names_must_be_present_and_distinct_within_a_subject(subjects) -> None:
    anatomy, _ = subjects
    student = create_user(email="personal-names@example.com", cohort=anatomy.cohort)
    client = client_for(student)
    upload(client, anatomy, "Skull")

    duplicate = upload(client, anatomy, "  SKULL ")
    blank = client.post(url(anatomy), {"title": "   ", "file": pdf_file()}, format="multipart")

    assert duplicate.status_code == 400
    assert duplicate.json()["error"]["code"] == "personal_sheet_title_taken"
    assert blank.status_code == 400
    assert PersonalSheet.objects.count() == 1
    assert ManagedFile.objects.count() == 1


def test_only_readable_pdfs_within_the_size_limit_are_accepted(subjects) -> None:
    anatomy, _ = subjects
    student = create_user(email="personal-files@example.com", cohort=anatomy.cohort)
    client = client_for(student)
    image = SimpleUploadedFile("photo.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, "image/png")
    broken = SimpleUploadedFile("broken.pdf", b"%PDF-1.7\nnot really", "application/pdf")

    not_pdf = client.post(url(anatomy), {"title": "Photo", "file": image}, format="multipart")
    unreadable = client.post(url(anatomy), {"title": "Broken", "file": broken}, format="multipart")
    with override_settings(PERSONAL_SHEET_MAX_BYTES=100):
        too_big = upload(client, anatomy, "Big")

    assert not_pdf.status_code == 400
    assert unreadable.status_code == 400
    assert too_big.status_code == 400
    assert too_big.json()["error"]["code"] == "personal_sheet_invalid"
    assert not PersonalSheet.objects.exists()
    assert not ManagedFile.objects.exists()


@override_settings(PERSONAL_SHEETS_MAX_PER_ACCOUNT=2)
def test_account_limit_counts_every_subject(subjects) -> None:
    anatomy, _ = subjects
    histology = CatalogSubject.objects.create(
        cohort=anatomy.cohort, title="Histology", slug="histology", material_slug="year-2-histo"
    )
    student = create_user(email="personal-limit@example.com", cohort=anatomy.cohort)
    client = client_for(student)
    upload(client, anatomy, "One")
    upload(client, histology, "Two")

    third = upload(client, anatomy, "Three")

    assert third.status_code == 400
    assert third.json()["error"]["code"] == "personal_sheet_limit_reached"
    assert client.get(url(anatomy)).json()["limits"]["remaining"] == 0


def test_bulk_delete_removes_sheets_and_stored_files(
    subjects, django_capture_on_commit_callbacks
) -> None:
    anatomy, _ = subjects
    student = create_user(email="personal-delete@example.com", cohort=anatomy.cohort)
    client = client_for(student)
    ids = [upload(client, anatomy, f"Sheet {index}").json()["sheet"]["id"] for index in range(3)]
    kept = PersonalSheet.objects.get(id=ids[2])
    removed_files = [PersonalSheet.objects.get(id=sheet_id).managed_file for sheet_id in ids[:2]]
    storage = removed_files[0].blob.storage

    with django_capture_on_commit_callbacks(execute=True):
        response = client.post("/api/v1/personal-sheets/delete", {"ids": ids[:2]}, format="json")

    assert response.status_code == 200
    assert response.json()["deleted"] == 2
    assert response.json()["limits"]["used"] == 1
    assert list(PersonalSheet.objects.values_list("id", flat=True)) == [kept.id]
    assert set(ManagedFile.objects.values_list("id", flat=True)) == {kept.managed_file_id}
    for managed_file in removed_files:
        assert not storage.exists(managed_file.blob.name)


def grant_focus(user: User) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="focus.workspace"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid.uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def stroke(page: int = 1) -> dict[str, Any]:
    sample = {"x": 0.1, "y": 0.1, "pointer": "pen", "pressure": 0.5, "tiltX": 0, "tiltY": 0}
    return {
        "id": str(uuid.uuid4()),
        "page_number": page,
        "tool": "pen",
        "layer_key": "personal",
        "bounds": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2},
        "payload": {
            "kind": "stroke",
            "samples": [{**sample, "timestamp": 1}, {**sample, "x": 0.3, "y": 0.3, "timestamp": 2}],
        },
        "color": "#f2c94c",
        "thickness": 2.5,
        "opacity": 1,
    }


def annotations_url(sheet_id: str, pages: str = "1") -> str:
    return f"/api/v1/focus/documents/{sheet_id}/annotations?pages={pages}"


def sync(client: APIClient, sheet_id: str, marks: list[dict[str, Any]], revision: int = 0):
    return client.post(
        f"/api/v1/focus/documents/{sheet_id}/annotations",
        {
            "expected_collection_revision": revision,
            "idempotency_key": str(uuid.uuid4()),
            "annotations": marks,
            "deleted_ids": [],
        },
        format="json",
    )


def test_marks_on_an_own_sheet_reach_the_owners_other_devices_only(subjects) -> None:
    anatomy, _ = subjects
    owner = create_user(email="personal-ink@example.com", cohort=anatomy.cohort)
    classmate = create_user(email="personal-ink-peer@example.com", cohort=anatomy.cohort)
    grant_focus(owner)
    grant_focus(classmate)
    sheet_id = upload(client_for(owner), anatomy, "Inked", pages=3).json()["sheet"]["id"]
    phone, tablet = client_for(owner), client_for(owner)
    mark = stroke(page=2)

    written = sync(phone, sheet_id, [mark])
    read = tablet.get(annotations_url(sheet_id, "1,2,3"))

    assert written.status_code == 200, written.content
    assert written.json()["collection_revision"] == 1
    assert read.status_code == 200
    assert read.json()["collection_revision"] == 1
    assert [item["id"] for item in read.json()["results"]] == [mark["id"]]
    assert client_for(classmate).get(annotations_url(sheet_id)).status_code == 404
    assert sync(client_for(classmate), sheet_id, [stroke()]).status_code == 404
    stale = sync(tablet, sheet_id, [stroke()], revision=0)
    assert stale.status_code == 409
    beyond = sync(tablet, sheet_id, [stroke(page=4)], revision=1)
    assert beyond.status_code == 400


def test_own_sheet_reader_state_is_revisioned_idempotent_and_private(subjects) -> None:
    anatomy, _ = subjects
    owner = create_user(email="personal-state@example.com", cohort=anatomy.cohort)
    classmate = create_user(email="personal-state-peer@example.com", cohort=anatomy.cohort)
    client = client_for(owner)
    sheet_id = upload(client, anatomy, "State").json()["sheet"]["id"]
    url = f"/api/v1/personal-sheets/{sheet_id}/workspace"
    key = str(uuid.uuid4())
    state = {"view": {"page": 2, "zoom": 1.25}, "notes": [{"id": "n1", "page": 1, "text": "hi"}]}

    first = client.get(url).json()
    saved = client.patch(
        url, {"expected_revision": 0, "idempotency_key": key, "state": state}, format="json"
    )
    replayed = client.patch(
        url, {"expected_revision": 0, "idempotency_key": key, "state": state}, format="json"
    )
    stale = client.patch(
        url,
        {"expected_revision": 0, "idempotency_key": str(uuid.uuid4()), "state": {}},
        format="json",
    )
    reused = client.patch(
        url, {"expected_revision": 5, "idempotency_key": key, "state": {}}, format="json"
    )
    probe = client.get(f"{url}?probe=1").json()

    assert first["revision"] == 0 and first["state"] == {}
    assert first["document_version_id"] == sheet_id
    assert saved.status_code == 200 and saved.json() == {
        "revision": 1,
        "state": state,
        "replayed": False,
    }
    assert replayed.json()["replayed"] is True and replayed.json()["revision"] == 1
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "catalog_workspace_conflict"
    assert reused.status_code == 400
    assert probe == {
        "revision": 1,
        "collection_revision": 0,
        "document_version_id": sheet_id,
        "checksum_sha256": probe["checksum_sha256"],
    }
    assert client.get(url).json()["state"] == state
    assert client_for(classmate).get(url).status_code == 404


def test_own_sheet_is_not_a_reading_document(subjects) -> None:
    anatomy, _ = subjects
    owner = create_user(email="personal-no-credit@example.com", cohort=anatomy.cohort)
    grant_focus(owner)
    client = client_for(owner)
    sheet_id = upload(client, anatomy, "No credit").json()["sheet"]["id"]

    assert client.get(f"/api/v1/focus/documents/{sheet_id}").status_code == 404


def test_deleting_a_sheet_removes_its_marks_and_reader_state(subjects) -> None:
    anatomy, _ = subjects
    owner = create_user(email="personal-ink-delete@example.com", cohort=anatomy.cohort)
    grant_focus(owner)
    client = client_for(owner)
    sheet_id = upload(client, anatomy, "Temporary").json()["sheet"]["id"]
    sync(client, sheet_id, [stroke()])
    client.patch(
        f"/api/v1/personal-sheets/{sheet_id}/workspace",
        {"expected_revision": 0, "idempotency_key": str(uuid.uuid4()), "state": {"notes": []}},
        format="json",
    )

    client.post("/api/v1/personal-sheets/delete", {"ids": [sheet_id]}, format="json")

    assert not FocusAnnotationCollection.objects.filter(document_id=sheet_id).exists()
    assert not FocusAnnotation.objects.exists()
    assert client.get(f"/api/v1/personal-sheets/{sheet_id}/workspace").status_code == 404
