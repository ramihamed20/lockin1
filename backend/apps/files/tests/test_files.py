from collections.abc import Iterable
from datetime import timedelta
from io import StringIO
from typing import Any, cast
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.content.admin_services import replace_pdf, unpublish_sheet
from apps.content.models import LearningObjectVersion
from apps.content.services import (
    LearningObjectInput,
    create_learning_object,
    publish_learning_object,
    revise_learning_object,
    submit_for_review,
)
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import (
    audio_upload,
    create_admin,
    create_creator,
    pdf_upload,
    published_path,
)

from ..models import ManagedFile
from ..scanning import (
    ScannerUnavailable,
    ScanResult,
    claim_next_scan,
    process_one_scan,
    recover_stale_scans,
)
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


def test_file_scanner_command_processes_a_bounded_batch_once(settings: Any) -> None:
    settings.FILE_SCAN_WORKER_INTERVAL_SECONDS = 0
    settings.FILE_SCAN_BATCH_SIZE = 2
    output = StringIO()

    with (
        patch(
            "apps.files.management.commands.run_file_scanner.recover_stale_scans",
            return_value=1,
        ) as recover,
        patch(
            "apps.files.management.commands.run_file_scanner.process_one_scan",
            side_effect=[True, True],
        ) as process,
    ):
        call_command("run_file_scanner", once=True, stdout=output)

    recover.assert_called_once_with()
    assert process.call_count == 2
    assert "batch size 2 every 1 seconds" in output.getvalue()
    assert "Recovered 1; processed 2 file(s)" in output.getvalue()


def test_permission_mediated_view_supports_ranges_and_download_policy() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
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


def test_published_file_remains_available_while_replacement_version_is_draft() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson, allow_download=True)
    assert learning_object.published_version is not None
    published_file_id = learning_object.published_version.assets.get(role="primary").managed_file_id
    replacement = create_managed_file(
        owner=admin,
        upload=pdf_upload(name="replacement-draft.pdf"),
        kind="pdf",
    )

    revised = revise_learning_object(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
        data=LearningObjectInput(
            academic_node=lesson,
            content_type=LearningObjectVersion.ContentType.PDF,
            title="Replacement draft",
            allow_download=True,
            primary_file=replacement,
        ),
    )
    assert revised.workflow_status == "draft"
    assert revised.published_version_id == learning_object.published_version_id

    client = APIClient()
    client.force_authenticate(student)
    published_response = client.get(f"/api/v1/files/{published_file_id}/view")
    draft_response = client.get(f"/api/v1/files/{replacement.id}/view")

    assert published_response.status_code == 200
    published_response.close()
    assert draft_response.status_code == 404


def test_unpublished_owner_file_is_not_visible_to_another_student() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    client = APIClient()
    client.force_authenticate(student)

    response = client.get(f"/api/v1/files/{managed_file.id}/view")

    assert response.status_code == 404


def test_management_upload_api_validates_files_and_roles() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
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


class _CleanScanner:
    def scan(self, file_object: Any) -> ScanResult:
        assert file_object.read(5) == b"%PDF-"
        return ScanResult(verdict="clean", engine="clamav-test")


class _QuarantineScanner:
    def scan(self, file_object: Any) -> ScanResult:
        return ScanResult(
            verdict="quarantined",
            engine="clamav-test",
            signature="Eicar-Test-Signature",
        )


class _UnavailableScanner:
    def scan(self, file_object: Any) -> ScanResult:
        raise ScannerUnavailable("scanner_unavailable")


def test_automated_scan_persists_clean_and_quarantine_with_audit(settings: Any) -> None:
    settings.CONTENT_REQUIRE_CLEAN_SCAN = True
    admin = create_admin()
    clean_file = create_managed_file(
        owner=admin,
        upload=pdf_upload(name="clean.pdf"),
        kind="pdf",
    )

    assert process_one_scan(scanner=_CleanScanner()) is True
    clean_file.refresh_from_db()
    assert clean_file.scan_status == ManagedFile.ScanStatus.CLEAN
    assert clean_file.scan_attempts == 1
    assert clean_file.scan_completed_at is not None
    assert AuditRecord.objects.filter(
        action="file.scan.clean", target_id=str(clean_file.id)
    ).exists()

    rejected_file = create_managed_file(
        owner=admin,
        upload=pdf_upload(name="rejected.pdf"),
        kind="pdf",
    )
    assert process_one_scan(scanner=_QuarantineScanner()) is True
    rejected_file.refresh_from_db()
    assert rejected_file.scan_status == ManagedFile.ScanStatus.QUARANTINED
    assert rejected_file.scan_signature == "Eicar-Test-Signature"
    client = APIClient()
    client.force_authenticate(admin)
    assert client.get(f"/api/v1/files/{rejected_file.id}/view").status_code == 404
    assert AuditRecord.objects.filter(
        action="file.scan.quarantined", target_id=str(rejected_file.id)
    ).exists()


def test_fresh_pdf_scans_publishes_and_delivers_without_database_override(
    settings: Any,
) -> None:
    settings.CONTENT_REQUIRE_CLEAN_SCAN = True
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    managed_file = create_managed_file(
        owner=admin,
        upload=pdf_upload(name="production.pdf"),
        kind="pdf",
    )
    assert process_one_scan(scanner=_CleanScanner()) is True
    managed_file.refresh_from_db()
    learning_object = create_learning_object(
        actor=admin,
        data=LearningObjectInput(
            academic_node=lesson,
            content_type=LearningObjectVersion.ContentType.PDF,
            title="Production study guide",
            primary_file=managed_file,
        ),
    )
    learning_object = submit_for_review(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )
    learning_object = publish_learning_object(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )
    assert learning_object.workflow_status == "published"

    client = APIClient()
    client.force_authenticate(student)
    response = client.get(f"/api/v1/files/{managed_file.id}/view")
    assert response.status_code == 200
    response.close()


def test_scan_failures_retry_then_fail_closed_and_stale_claims_recover(settings: Any) -> None:
    settings.CONTENT_REQUIRE_CLEAN_SCAN = True
    settings.FILE_SCAN_MAX_ATTEMPTS = 2
    settings.FILE_SCAN_RETRY_BASE_SECONDS = 1
    admin = create_admin()
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")

    assert process_one_scan(scanner=_UnavailableScanner()) is True
    managed_file.refresh_from_db()
    assert managed_file.scan_status == ManagedFile.ScanStatus.PENDING
    assert managed_file.scan_attempts == 1
    ManagedFile.objects.filter(id=managed_file.id).update(scan_next_attempt_at=timezone.now())
    assert process_one_scan(scanner=_UnavailableScanner()) is True
    managed_file.refresh_from_db()
    assert managed_file.scan_status == ManagedFile.ScanStatus.FAILED
    assert managed_file.scan_attempts == 2
    assert managed_file.scan_next_attempt_at is None

    stale = create_managed_file(
        owner=admin,
        upload=pdf_upload(name="stale.pdf"),
        kind="pdf",
    )
    claimed = claim_next_scan()
    assert claimed is not None and claimed.id == stale.id
    ManagedFile.objects.filter(id=stale.id).update(
        scan_started_at=timezone.now() - timedelta(minutes=10),
        scan_attempts=2,
    )
    assert recover_stale_scans() == 1
    stale.refresh_from_db()
    assert stale.scan_status == ManagedFile.ScanStatus.FAILED
    assert stale.scan_error_code == "scan_timeout"


def test_scan_override_is_capability_gated_audited_and_requires_separation(
    settings: Any,
) -> None:
    settings.CONTENT_REQUIRE_CLEAN_SCAN = True
    owner = create_admin()
    reviewer = create_admin(email="reviewer@example.com")
    creator = create_creator()
    managed_file = create_managed_file(owner=owner, upload=pdf_upload(), kind="pdf")
    creator_file = create_managed_file(
        owner=creator,
        upload=pdf_upload(name="creator.pdf"),
        kind="pdf",
    )
    client = APIClient()

    client.force_authenticate(creator)
    unauthorized = client.post(
        f"/api/v1/operations/admin/files/{creator_file.id}/scan-decision",
        {"decision": "clean", "reason": "I reviewed this upload."},
        format="json",
    )
    assert unauthorized.status_code == 403

    client.force_authenticate(owner)
    self_approval = client.post(
        f"/api/v1/operations/admin/files/{managed_file.id}/scan-decision",
        {"decision": "clean", "reason": "I reviewed this upload."},
        format="json",
    )
    assert self_approval.status_code == 400

    client.force_authenticate(reviewer)
    approved = client.post(
        f"/api/v1/operations/admin/files/{managed_file.id}/scan-decision",
        {"decision": "clean", "reason": "Independent malware review completed."},
        format="json",
    )
    assert approved.status_code == 200
    assert approved.json()["scan_status"] == "clean"
    assert AuditRecord.objects.filter(
        actor=reviewer,
        action="file.scan.clean",
        target_id=str(managed_file.id),
    ).exists()


def test_superseded_unpublished_and_archived_files_are_revoked() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson, allow_download=True)
    assert learning_object.published_version is not None
    old_file_id = learning_object.published_version.assets.get(role="primary").managed_file_id
    replacement = create_managed_file(
        owner=admin,
        upload=pdf_upload(name="replacement.pdf"),
        kind="pdf",
    )
    client = APIClient()
    client.force_authenticate(student)
    before = client.get(f"/api/v1/files/{old_file_id}/view")
    assert before.status_code == 200
    before.close()

    learning_object = replace_pdf(
        actor=admin,
        sheet_id=learning_object.id,
        expected_revision=learning_object.revision,
        managed_file=replacement,
        notify_students=False,
    )
    assert learning_object.published_version is not None
    current_file_id = learning_object.published_version.assets.get(role="primary").managed_file_id
    assert client.get(f"/api/v1/files/{old_file_id}/view").status_code == 404
    current = client.get(f"/api/v1/files/{current_file_id}/view")
    assert current.status_code == 200
    current.close()

    learning_object = unpublish_sheet(
        actor=admin,
        sheet_id=learning_object.id,
        expected_revision=learning_object.revision,
    )
    assert client.get(f"/api/v1/files/{current_file_id}/view").status_code == 404
