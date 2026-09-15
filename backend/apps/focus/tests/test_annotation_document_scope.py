"""Marks belong to the PDF they were drawn on, and follow the reader's account.

A sheet publishes two editions from one version, and each edition also has a
Sheet Summary. Page numbers only mean something inside one file, so each of
those documents owns its own annotations -- while any device signed into the
same account sees them.
"""

from __future__ import annotations

import io
import uuid
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from pypdf import PdfWriter
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.admin_services import (
    create_sheet,
    replace_lockin_pdf,
    replace_summary_pdf,
)
from apps.content.editions import (
    LOCKIN,
    STUDY,
    SUMMARY,
    UNIVERSITY,
    annotation_document_id,
)
from apps.content.models import LearningObject
from apps.education.models import AcademicProgram, StudentCohort
from apps.education.tests.helpers import create_admin, published_path
from apps.files.services import create_managed_file
from apps.focus.models import FocusAnnotationCollection

pytestmark = pytest.mark.django_db


def _pdf(pages: int, name: str) -> SimpleUploadedFile:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="application/pdf")


def _sample(x: float, timestamp: int) -> dict[str, Any]:
    return {
        "x": x,
        "y": x,
        "pointer": "pen",
        "pressure": 0.5,
        "tiltX": 0,
        "tiltY": 0,
        "timestamp": timestamp,
    }


def _mark(page: int) -> dict[str, Any]:
    """One pen stroke, identified by the id this returns."""

    return {
        "id": str(uuid.uuid4()),
        "page_number": page,
        "tool": "pen",
        "layer_key": "personal",
        # Bounds and samples are page-relative fractions.
        "bounds": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2},
        "payload": {"kind": "stroke", "samples": [_sample(0.1, 1), _sample(0.3, 2)]},
        "color": "#f2c94c",
        "thickness": 2.5,
        "opacity": 1,
    }


@pytest.fixture
def sheet_with_editions() -> tuple[LearningObject, Any]:
    admin = create_admin()
    institution, subject, _ = published_path(admin=admin)
    program = AcademicProgram.objects.create(code="ann", name_en="A", name_ar="A")
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Y1", name_ar="Y1"
    )
    cohort.content_nodes.set([institution])
    sheet = create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(
            owner=admin, upload=_pdf(22, "university.pdf"), kind="pdf"
        ),
        title="Patho",
        summary="",
        position=0,
        publish=True,
        notify_students=False,
        allow_download=False,
    )
    sheet = replace_summary_pdf(
        actor=admin,
        sheet_id=sheet.id,
        expected_revision=sheet.revision,
        managed_file=create_managed_file(owner=admin, upload=_pdf(4, "summary.pdf"), kind="pdf"),
    )
    sheet = replace_lockin_pdf(
        actor=admin,
        sheet_id=sheet.id,
        expected_revision=sheet.revision,
        managed_file=create_managed_file(owner=admin, upload=_pdf(18, "lockin.pdf"), kind="pdf"),
    )
    student = create_user(email="reader@example.test", cohort=cohort)
    return sheet, student


def _endpoint(sheet: LearningObject, *, edition: str = "", view: str = "", pages: str = "") -> str:
    """One document's annotation address: the version, plus which of its PDFs."""

    query = "&".join(
        part
        for part in (
            f"edition={edition}" if edition else "",
            f"view={view}" if view else "",
            f"pages={pages}" if pages else "",
        )
        if part
    )
    base = f"/api/v1/focus/documents/{sheet.published_version_id}/annotations"
    return f"{base}?{query}" if query else base


def _sync(client: APIClient, url: str, marks: list[dict[str, Any]], *, revision: int = 0):
    return client.post(
        url,
        {
            "expected_collection_revision": revision,
            "idempotency_key": str(uuid.uuid4()),
            "annotations": marks,
            "deleted_ids": [],
        },
        format="json",
    )


def test_summary_marks_reach_every_device_of_the_same_reader(
    sheet_with_editions: tuple[LearningObject, Any],
) -> None:
    sheet, student = sheet_with_editions
    phone = APIClient()
    phone.force_authenticate(student)
    laptop = APIClient()
    laptop.force_authenticate(student)

    url = _endpoint(sheet, view=SUMMARY)
    from_phone = _mark(2)
    written = _sync(phone, url, [from_phone])
    assert written.status_code == 200, written.json()

    # A second device, with nothing cached, reads the server's copy.
    read = laptop.get(_endpoint(sheet, view=SUMMARY, pages="2"))
    assert read.status_code == 200
    assert [item["id"] for item in read.json()["results"]] == [from_phone["id"]]

    # And what it adds comes back to the first device.
    from_laptop = _mark(3)
    added = _sync(laptop, url, [from_laptop], revision=read.json()["collection_revision"])
    assert added.status_code == 200
    back = phone.get(_endpoint(sheet, view=SUMMARY, pages="2,3"))
    assert sorted(item["id"] for item in back.json()["results"]) == sorted(
        [from_phone["id"], from_laptop["id"]]
    )


def test_study_and_summary_and_editions_never_share_marks(
    sheet_with_editions: tuple[LearningObject, Any],
) -> None:
    sheet, student = sheet_with_editions
    admin = sheet.owner
    # A Lock-in summary of its own, so all four documents are genuinely
    # different files rather than two of them being one shared summary.
    # Publishing it advances the version the reader addresses.
    sheet = replace_summary_pdf(
        actor=admin,
        sheet_id=sheet.id,
        expected_revision=sheet.revision,
        managed_file=create_managed_file(
            owner=admin, upload=_pdf(6, "lockin-summary.pdf"), kind="pdf"
        ),
        edition=LOCKIN,
    )
    client = APIClient()
    client.force_authenticate(student)

    documents = {
        "university-study": {},
        "university-summary": {"view": SUMMARY},
        "lockin-study": {"edition": LOCKIN},
        "lockin-summary": {"edition": LOCKIN, "view": SUMMARY},
    }
    written_ids = {}
    for name, scope in documents.items():
        mark = _mark(2)
        written = _sync(client, _endpoint(sheet, **scope), [mark])
        assert written.status_code == 200, (name, written.json())
        written_ids[name] = mark["id"]

    # Page 2 exists in all four files, which is exactly why the marks must not
    # be shared: it is a different page 2 in each one.
    for name, scope in documents.items():
        read = client.get(_endpoint(sheet, pages="2", **scope))
        assert read.status_code == 200, name
        assert [item["id"] for item in read.json()["results"]] == [written_ids[name]], name

    # Four documents, four collections, one reader.
    assert FocusAnnotationCollection.objects.filter(user=student).count() == 4


def test_the_university_study_document_keeps_the_identity_it_always_had(
    sheet_with_editions: tuple[LearningObject, Any],
) -> None:
    """Marks made before editions existed stay where they were stored."""

    sheet, student = sheet_with_editions
    client = APIClient()
    client.force_authenticate(student)
    assert _sync(client, _endpoint(sheet), [_mark(1)]).status_code == 200

    collection = FocusAnnotationCollection.objects.get(user=student)
    assert collection.document_id == sheet.id
    assert (
        annotation_document_id(learning_object_id=sheet.id, edition=UNIVERSITY, view=STUDY)
        == sheet.id
    )


def test_a_summary_page_beyond_its_own_length_is_rejected(
    sheet_with_editions: tuple[LearningObject, Any],
) -> None:
    """The summary is four pages, even though the sheet it belongs to is 22."""

    sheet, student = sheet_with_editions
    client = APIClient()
    client.force_authenticate(student)

    assert _sync(client, _endpoint(sheet), [_mark(20)]).status_code == 200
    rejected = _sync(client, _endpoint(sheet, view=SUMMARY), [_mark(20)])
    assert rejected.status_code == 400


def test_an_edition_without_its_own_summary_shares_the_one_it_shows(
    sheet_with_editions: tuple[LearningObject, Any],
) -> None:
    """One file, one set of marks, whichever edition opened it."""

    sheet, student = sheet_with_editions
    client = APIClient()
    client.force_authenticate(student)
    # This sheet's Lock-in edition has no summary of its own, so both editions
    # show the same file.
    assert annotation_document_id(
        learning_object_id=sheet.id, edition=LOCKIN, view=SUMMARY
    ) != annotation_document_id(learning_object_id=sheet.id, edition=UNIVERSITY, view=SUMMARY)

    mark = _mark(1)
    written = _sync(client, _endpoint(sheet, view=SUMMARY), [mark])
    assert written.status_code == 200
    through_lockin = client.get(_endpoint(sheet, edition=LOCKIN, view=SUMMARY, pages="1"))
    assert through_lockin.status_code == 200
    assert [item["id"] for item in through_lockin.json()["results"]] == [mark["id"]]
