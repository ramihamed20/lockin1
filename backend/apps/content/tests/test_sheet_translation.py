import io
from uuid import uuid4

import pytest
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from pypdf import PdfWriter
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.administration.models import OperationalCapabilityAssignment
from apps.audit.models import AuditRecord
from apps.content.models import LearningObjectAsset, SheetPageTranslation
from apps.education.tests.helpers import create_admin
from apps.files.models import ManagedFile
from apps.files.services import create_managed_file

from .test_catalog_workspace import catalog_fixture, client_for, grant_focus

pytestmark = pytest.mark.django_db


@pytest.fixture
def sheet():
    document, own, other = catalog_fixture()
    writer = PdfWriter()
    for _ in range(3):
        writer.add_blank_page(width=595, height=842)
    data = io.BytesIO()
    writer.write(data)
    document.managed_file.blob.save("translation-test.pdf", ContentFile(data.getvalue()))
    document.managed_file.pdf_page_count = 3
    document.managed_file.save(update_fields=["pdf_page_count"])
    student = create_user(email="translation@example.test", cohort=own)
    grant_focus(student)
    return document, student, create_admin(email="translator@example.test"), other


def student_url(document, page=1):
    return f"/api/v1/catalog/documents/{document.id}/translation?page={page}"


def admin_url(document, edition="university"):
    path = f"/api/v1/operations/admin/content/sheets/{document.version.learning_object_id}"
    return f"{path}/translations?edition={edition}"


def read_admin(sheet, edition="university"):
    document, _, admin, _ = sheet
    response = client_for(admin).get(admin_url(document, edition))
    assert response.status_code == 200, response.content
    return response.json()


def upload(sheet, pages, *, source=None, edition="university"):
    document, _, admin, _ = sheet
    current = source or read_admin(sheet, edition)
    revisions = {row["page"]: row["revision"] for row in current["pages"]}
    return client_for(admin).put(
        admin_url(document, edition),
        {
            "file_id": current["file_id"],
            "checksum": current["checksum"],
            "pages": [
                {"page": page, "text": text, "expected_revision": revisions.get(page, 0)}
                for page, text in pages
            ],
        },
        format="json",
    )


def test_full_pages_follow_physical_numbering(sheet):
    document, student, _, _ = sheet
    pages = [(1, "ترجمة الأولى كاملة"), (2, "ترجمة الثانية كاملة"), (3, "ترجمة الثالثة كاملة")]
    response = upload(sheet, pages)
    assert response.status_code == 200, response.content
    assert response.json()["translated_pages"] == 3
    for page, text in pages:
        response = client_for(student).get(student_url(document, page))
        assert response.status_code == 200
        assert response.json()["translated_text"] == text
        assert response.json()["machine_translated"] is False
        assert response["Cache-Control"] == "private, no-store"
    assert AuditRecord.objects.filter(action="content.sheet_translations_saved").count() == 1


def test_partial_upload_and_clear_preserve_other_pages(sheet):
    document, student, _, _ = sheet
    assert upload(sheet, [(1, "الأولى"), (2, "الثانية")]).status_code == 200
    assert upload(sheet, [(1, "تعديل الأولى")]).status_code == 200
    assert client_for(student).get(student_url(document, 2)).json()["translated_text"] == "الثانية"
    assert upload(sheet, [(1, "")]).status_code == 200
    assert client_for(student).get(student_url(document)).json()["status"] == "unavailable"
    assert read_admin(sheet)["translated_pages"] == 1


def test_missing_page_does_not_generate_content_or_queue_work(sheet):
    document, student, _, _ = sheet
    response = client_for(student).get(student_url(document, 2))
    assert response.json()["status"] == "unavailable"
    assert response.json()["translated_text"] == ""
    assert not SheetPageTranslation.objects.exists()


@pytest.mark.parametrize("page", [0, -1, 4, "bad"])
def test_reader_rejects_invalid_pages(sheet, page):
    document, student, _, _ = sheet
    assert client_for(student).get(student_url(document, page)).status_code == 400


@pytest.mark.parametrize(
    "pages",
    [
        [(1, "أ"), (1, "ب")],
        [(1, "أ"), (4, "ب")],
        [(1, "أ"), (0, "ب")],
        [(1, "أ" * 60001)],
    ],
)
def test_invalid_import_is_atomic(sheet, pages):
    assert upload(sheet, pages).status_code == 400
    assert not SheetPageTranslation.objects.exists()
    assert not AuditRecord.objects.filter(action="content.sheet_translations_saved").exists()


def test_stale_revision_rejects_whole_batch(sheet):
    document, student, _, _ = sheet
    old = read_admin(sheet)
    assert upload(sheet, [(1, "جديدة")], source=old).status_code == 200
    assert upload(sheet, [(2, "لا تحفظ"), (1, "قديمة")], source=old).status_code == 409
    assert client_for(student).get(student_url(document)).json()["translated_text"] == "جديدة"
    assert not SheetPageTranslation.objects.filter(page=2).exists()


def test_wrong_checksum_or_file_id_is_rejected(sheet):
    source = read_admin(sheet)
    source["checksum"] = "a" * 64
    assert upload(sheet, [(1, "نص")], source=source).status_code == 409
    source = read_admin(sheet)
    source["file_id"] = str(uuid4())
    assert upload(sheet, [(1, "نص")], source=source).status_code == 409
    assert not SheetPageTranslation.objects.exists()


def test_old_file_translation_is_not_reused(sheet):
    document, student, _, _ = sheet
    assert upload(sheet, [(1, "قديم")]).status_code == 200
    document.managed_file.checksum_sha256 = "b" * 64
    document.managed_file.save(update_fields=["checksum_sha256"])
    assert client_for(student).get(student_url(document)).json()["status"] == "unavailable"
    assert read_admin(sheet)["pages"] == []


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_reader_still_enforces_cohort_and_subscription(sheet):
    document, _, _, other = sheet
    assert upload(sheet, [(1, "محمي")]).status_code == 200
    outsider = create_user(email="outsider@example.test", cohort=other)
    grant_focus(outsider)
    assert client_for(outsider).get(student_url(document)).status_code == 403
    unverified = create_user(email="no-access@example.test", verified=False)
    assert client_for(unverified).get(student_url(document)).status_code == 403
    assert APIClient().get(student_url(document)).status_code in (401, 403)


def test_student_and_view_only_operator_cannot_upload(sheet):
    document, student, _, _ = sheet
    assert client_for(student).get(admin_url(document)).status_code == 403
    assert client_for(student).put(admin_url(document), {}, format="json").status_code == 403
    viewer = create_user(email="viewer@example.test")
    OperationalCapabilityAssignment.objects.create(user=viewer, capability_id="content.view")
    assert client_for(viewer).get(admin_url(document)).status_code == 200
    assert client_for(viewer).put(admin_url(document), {}, format="json").status_code == 403


def test_edition_translations_do_not_mix(sheet):
    document, student, admin, _ = sheet
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    data = io.BytesIO()
    writer.write(data)
    file = create_managed_file(
        owner=admin,
        kind="pdf",
        upload=SimpleUploadedFile("lockin.pdf", data.getvalue(), content_type="application/pdf"),
    )
    LearningObjectAsset.objects.create(
        version=document.version, role=LearningObjectAsset.Role.LOCKIN_PRIMARY, managed_file=file
    )
    assert upload(sheet, [(1, "نسخة الجامعة")]).status_code == 200
    response = upload(sheet, [(1, "نسخة لوكن")], edition="lockin")
    assert response.status_code == 200, response.content
    assert read_admin(sheet, "lockin")["pages"][0]["text"] == "نسخة لوكن"
    assert (
        client_for(student).get(student_url(document)).json()["translated_text"] == "نسخة الجامعة"
    )
    assert upload(sheet, [(2, "خارج النسخة")], edition="lockin").status_code == 400


def test_missing_edition_and_quarantine_fail_closed(sheet):
    document, _, admin, _ = sheet
    assert client_for(admin).get(admin_url(document, "lockin")).status_code == 400
    assert client_for(admin).get(admin_url(document, "other")).status_code == 400
    document.managed_file.scan_status = ManagedFile.ScanStatus.QUARANTINED
    document.managed_file.save(update_fields=["scan_status"])
    assert client_for(admin).get(admin_url(document)).status_code == 400


@pytest.mark.parametrize("field,value", [("text", 42), ("source_text", {"unexpected": "object"})])
def test_non_text_values_are_rejected(sheet, field, value):
    document, _, admin, _ = sheet
    source = read_admin(sheet)
    response = client_for(admin).put(
        admin_url(document),
        {
            "file_id": source["file_id"],
            "checksum": source["checksum"],
            "pages": [{"page": 1, "text": "كاملة", "expected_revision": 0, field: value}],
        },
        format="json",
    )
    assert response.status_code == 400
    assert not SheetPageTranslation.objects.exists()


def test_session_upload_requires_csrf(sheet):
    document, _, admin, _ = sheet
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(admin)
    assert client.put(admin_url(document), {}, format="json").status_code == 403
    assert not SheetPageTranslation.objects.exists()
