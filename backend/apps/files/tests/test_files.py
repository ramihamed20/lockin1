from collections.abc import Iterable
from typing import Any, cast

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import StreamingHttpResponse
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import audio_upload, create_admin, pdf_upload, published_path

from ..models import ManagedFile
from ..services import FileValidationError, create_managed_file, validate_upload

pytestmark = pytest.mark.django_db


def test_upload_validation_uses_extension_mime_and_signature(settings: Any) -> None:
    settings.CONTENT_MAX_PDF_BYTES = 16
    wrong_magic = SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf")
    disguised = SimpleUploadedFile("fake.txt", b"%PDF-1.7", content_type="application/pdf")
    oversized = SimpleUploadedFile(
        "large.pdf", b"%PDF-1.7-too-large", content_type="application/pdf"
    )

    with pytest.raises(FileValidationError):
        validate_upload(upload=wrong_magic, kind="pdf")
    with pytest.raises(FileValidationError):
        validate_upload(upload=disguised, kind="pdf")
    with pytest.raises(FileValidationError, match="size limit"):
        validate_upload(upload=oversized, kind="pdf")


def test_managed_file_uses_generated_storage_name_and_scan_state() -> None:
    admin = create_admin()
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")

    assert str(managed_file.id) in managed_file.blob.name
    assert "lesson.pdf" not in managed_file.blob.name
    assert managed_file.scan_status == ManagedFile.ScanStatus.NOT_CONFIGURED
    assert managed_file.checksum_sha256


def test_permission_mediated_view_supports_ranges_and_download_policy() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson, allow_download=False)
    assert learning_object.published_version is not None
    file_id = learning_object.published_version.assets.get(role="primary").managed_file_id
    client = APIClient()
    client.force_authenticate(student)

    ranged = client.get(f"/api/v1/files/{file_id}/view", HTTP_RANGE="bytes=0-7")
    denied_download = client.get(f"/api/v1/files/{file_id}/download")

    assert ranged.status_code == 206
    assert ranged["Content-Range"].startswith("bytes 0-7/")
    stream = cast(StreamingHttpResponse, ranged).streaming_content
    assert b"".join(cast(Iterable[bytes], stream)) == b"%PDF-1.7"
    assert ranged["Cache-Control"] == "private, no-store"
    assert denied_download.status_code == 404


def test_unpublished_owner_file_is_not_visible_to_another_student() -> None:
    admin = create_admin()
    student = create_user()
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    client = APIClient()
    client.force_authenticate(student)

    response = client.get(f"/api/v1/files/{managed_file.id}/view")

    assert response.status_code == 404


def test_management_upload_api_validates_files_and_roles() -> None:
    admin = create_admin()
    student = create_user()
    client = APIClient()
    client.force_authenticate(admin)

    uploaded = client.post(
        "/api/v1/management/files",
        {"kind": "pdf", "file": pdf_upload(name="secure.pdf")},
        format="multipart",
    )
    rejected = client.post(
        "/api/v1/management/files",
        {
            "kind": "pdf",
            "file": SimpleUploadedFile("fake.pdf", b"unsafe", content_type="application/pdf"),
        },
        format="multipart",
    )
    client.force_authenticate(student)
    forbidden = client.post(
        "/api/v1/management/files",
        {"kind": "audio", "file": audio_upload()},
        format="multipart",
    )

    assert uploaded.status_code == 201
    assert uploaded.json()["validation_status"] == "ready"
    assert rejected.status_code == 400
    assert forbidden.status_code == 403


def test_owner_delivery_covers_full_suffix_and_invalid_ranges() -> None:
    admin = create_admin()
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    client = APIClient()
    client.force_authenticate(admin)

    full = client.get(f"/api/v1/files/{managed_file.id}/view")
    suffix = client.get(f"/api/v1/files/{managed_file.id}/view", HTTP_RANGE="bytes=-4")
    invalid = client.get(f"/api/v1/files/{managed_file.id}/view", HTTP_RANGE="bytes=999-1000")
    invalid_disposition = client.get(f"/api/v1/files/{managed_file.id}/preview")

    assert full.status_code == 200
    assert full["Content-Disposition"].startswith("inline")
    assert suffix.status_code == 206
    assert suffix["Content-Length"] == "4"
    assert invalid.status_code == 416
    assert invalid["Content-Range"].startswith("bytes */")
    assert invalid_disposition.status_code == 404


def test_audio_validation_and_unknown_kind_rules() -> None:
    validated = validate_upload(upload=audio_upload(), kind="audio")
    assert validated.content_type == "audio/mpeg"
    with pytest.raises(FileValidationError, match="not supported"):
        validate_upload(upload=pdf_upload(), kind="video")
    with pytest.raises(FileValidationError, match="empty"):
        validate_upload(
            upload=SimpleUploadedFile("empty.pdf", b"", content_type="application/pdf"),
            kind="pdf",
        )


def test_clean_scan_gate_is_fail_closed_when_enabled(settings: Any) -> None:
    settings.CONTENT_REQUIRE_CLEAN_SCAN = True
    admin = create_admin()
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    client = APIClient()
    client.force_authenticate(admin)

    assert managed_file.scan_status == ManagedFile.ScanStatus.PENDING
    assert client.get(f"/api/v1/files/{managed_file.id}/view").status_code == 404

    managed_file.scan_status = ManagedFile.ScanStatus.CLEAN
    managed_file.save(update_fields=("scan_status",))
    response = client.get(f"/api/v1/files/{managed_file.id}/view")
    assert response.status_code == 200
    response.close()
