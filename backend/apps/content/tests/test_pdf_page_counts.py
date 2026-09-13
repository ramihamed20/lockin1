import json
from io import BytesIO, StringIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from pypdf import PdfWriter

from apps.content.models import LearningObjectVersion
from apps.content.services import LearningObjectInput, create_learning_object
from apps.education.tests.helpers import create_admin, published_path
from apps.files.services import create_managed_file

pytestmark = pytest.mark.django_db


def _pdf_upload(*, pages: int, name: str = "real.pdf") -> SimpleUploadedFile:
    payload = BytesIO()
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    writer.write(payload)
    return SimpleUploadedFile(name, payload.getvalue(), content_type="application/pdf")


def test_real_pdf_page_count_is_persisted_on_file_and_new_version() -> None:
    admin = create_admin(email="page-count-upload@example.com")
    _, subject, _ = published_path(admin=admin)
    managed_file = create_managed_file(
        owner=admin, upload=_pdf_upload(pages=3), kind="pdf"
    )

    sheet = create_learning_object(
        actor=admin,
        data=LearningObjectInput(
            academic_node=subject,
            content_type=LearningObjectVersion.ContentType.PDF,
            title="Three pages",
            primary_file=managed_file,
        ),
    )

    assert managed_file.pdf_page_count == 3
    assert sheet.current_version.page_count == 3


def test_page_count_backfill_is_dry_run_idempotent_and_reports_size_mismatch() -> None:
    admin = create_admin(email="page-count-backfill@example.com")
    _, subject, _ = published_path(admin=admin)
    managed_file = create_managed_file(
        owner=admin, upload=_pdf_upload(pages=4), kind="pdf"
    )
    managed_file.pdf_page_count = None
    managed_file.size_bytes += 9
    managed_file.save(update_fields=("pdf_page_count", "size_bytes"))
    sheet = create_learning_object(
        actor=admin,
        data=LearningObjectInput(
            academic_node=subject,
            content_type=LearningObjectVersion.ContentType.PDF,
            title="Backfill four pages",
            primary_file=managed_file,
        ),
    )
    assert sheet.current_version.page_count is None

    output = StringIO()
    call_command("backfill_pdf_page_counts", stdout=output)
    report = json.loads(output.getvalue())
    assert report["mode"] == "dry-run"
    assert report["size_mismatches"] == 1
    assert report["files"][0]["derived_page_count"] == 4
    managed_file.refresh_from_db()
    assert managed_file.pdf_page_count is None

    output = StringIO()
    call_command("backfill_pdf_page_counts", apply=True, stdout=output)
    assert json.loads(output.getvalue())["repaired"] == 1
    managed_file.refresh_from_db()
    sheet.current_version.refresh_from_db()
    assert managed_file.pdf_page_count == 4
    assert sheet.current_version.page_count == 4

    output = StringIO()
    call_command("backfill_pdf_page_counts", apply=True, stdout=output)
    assert json.loads(output.getvalue())["repaired"] == 0
