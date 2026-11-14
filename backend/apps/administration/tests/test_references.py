from io import BytesIO
from uuid import uuid4

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.administration.models import AutomationJob, SubjectReference, SubjectReferencePage
from apps.administration.references import relevant_reference_sections
from apps.audit.models import AuditRecord
from apps.content.tests.test_sheet_editions import _pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.files.models import ManagedFile
from apps.files.tests.helpers import close_streamed

pytestmark = pytest.mark.django_db


def text_pdf(text):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 20 200 Td ({text}) Tj ET".encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    writer.add_blank_page(width=100, height=100)
    output = BytesIO()
    writer.write(output)
    return SimpleUploadedFile("reference.pdf", output.getvalue(), content_type="application/pdf")


def reference_url(subject):
    return f"/api/v1/operations/admin/automation/subjects/{subject.id}/references"


def upload(client, url, pdf, **overrides):
    return client.post(
        url,
        {
            "title": "Pathology exam",
            "kind": "past_exam",
            "pdf": pdf,
            "tags": "Inflammation, inflammation",
            "idempotency_key": str(uuid4()),
            **overrides,
        },
    )


def test_reference_workflow_scope_checksum_search_history_and_private_pdf():
    admin = create_admin()
    _, subject, other = published_path(admin=admin)
    client = APIClient()
    client.force_authenticate(admin)
    url = reference_url(subject)
    sentence = "Inflammation involves changes in vascular permeability and immune activity."
    result = upload(client, url, text_pdf(sentence))
    assert result.status_code == 201, result.json()
    data = result.json()
    assert data["tags"] == ["inflammation"]
    assert data["indexed_at"] is None
    assert upload(client, url, text_pdf(sentence)).status_code == 409
    assert ManagedFile.objects.filter(owner=admin).count() == 1
    call_command("run_automation_worker", once=True)
    job = AutomationJob.objects.get(pk=data["job_id"])
    assert job.status == AutomationJob.Status.COMPLETED, job.error_message
    assert job.output_manifest["pages_for_visual_review"] == [2]
    assert list(
        SubjectReferencePage.objects.filter(reference_id=data["id"]).values_list("page", flat=True)
    ) == [1, 2]
    result = client.get(f"{url}?q=permeability&kind=past_exam&tag=inflammation")
    assert result.status_code == 200, result.json()
    assert result.json()["matches"][0]["page"] == 1
    assert result.json()["count"] == 1
    sections = relevant_reference_sections(
        subject_id=subject.id,
        title="Inflammation",
        lecture=[{"page": 1, "text": sentence, "needs_visual_review": False}],
    )
    assert [(row["reference_id"], row["page"]) for row in sections] == [(data["id"], 1)]
    assert not relevant_reference_sections(subject_id=subject.id, title="Odontogenesis", lecture=[])
    assert client.get(f"{reference_url(other)}/{data['id']}/pdf").status_code == 404

    replacement = upload(
        client, url, _pdf(6, "revision.pdf"), previous_id=data["id"], expected_revision=1
    )
    assert replacement.status_code == 201, replacement.json()
    assert replacement.json()["revision"] == 2
    stale = upload(client, url, _pdf(7, "stale.pdf"), previous_id=data["id"], expected_revision=1)
    assert stale.status_code == 409
    history = client.get(f"{url}/{data['id']}/history").json()
    assert [row["revision"] for row in history["results"]] == [2, 1]
    assert SubjectReference.objects.count() == 2
    assert (
        AuditRecord.objects.filter(action="automation.reference_uploaded", actor=admin).count() == 2
    )
    download = client.get(f"{url}/{data['id']}/pdf")
    assert download.status_code == 200 and download["Cache-Control"] == "private, no-store"
    assert b"".join(download.streaming_content).startswith(b"%PDF")
    close_streamed(download)
    client.force_authenticate(create_user())
    assert client.get(url).status_code == 403
    assert client.get(f"{url}/{data['id']}/pdf").status_code == 403
    assert upload(client, url, _pdf(9, "denied.pdf")).status_code == 403


def test_indexing_rejects_modified_bytes():
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    client = APIClient()
    client.force_authenticate(admin)
    result = upload(client, reference_url(subject), _pdf(3, "original.pdf")).json()
    reference = SubjectReference.objects.get(id=result["id"])
    with reference.file.blob.open("wb") as target:
        target.write(b"modified")
    call_command("run_automation_worker", once=True)
    job = AutomationJob.objects.get(pk=result["job_id"])
    assert job.status == AutomationJob.Status.BLOCKED
    assert job.error_code == "reference_unreadable"
    assert not reference.pages.exists()


def test_indexed_excerpt_is_withheld_after_quarantine():
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    client = APIClient()
    client.force_authenticate(admin)
    url = reference_url(subject)
    sentence = "Vascular permeability increases during the inflammation response."
    result = upload(client, url, text_pdf(sentence))
    assert result.status_code == 201, result.json()
    reference_id = result.json()["id"]
    call_command("run_automation_worker", once=True)
    assert len(client.get(f"{url}?q=permeability").json()["matches"]) == 1

    draft = client.post(
        f"/api/v1/operations/admin/content/subjects/{subject.id}/automation-drafts",
        {"title": "Vascular permeability", "pdf": _pdf(6, "lecture.pdf")},
    )
    assert draft.status_code == 201, draft.json()
    jobs = "/api/v1/operations/admin/automation/jobs"
    queued = client.post(
        jobs,
        {
            "job_type": "question_package",
            "sheet_id": draft.json()["id"],
            "normal_count": 0,
            "idempotency_key": str(uuid4()),
        },
    )
    assert queued.status_code == 201, queued.json()
    call_command("run_automation_worker", once=True)
    job_url = f"{jobs}/{queued.json()['id']}"
    assert (
        client.get(job_url).json()["output"]["reference_sections"][0]["reference_id"]
        == reference_id
    )

    reference = SubjectReference.objects.get(id=reference_id)
    ManagedFile.objects.filter(id=reference.file_id).update(
        scan_status=ManagedFile.ScanStatus.QUARANTINED
    )
    search = client.get(f"{url}?q=permeability").json()
    assert search["count"] == 0
    assert search["matches"] == []
    assert client.get(job_url).json()["output"]["reference_sections"] == []
    assert client.get(f"{url}/{reference_id}/pdf").status_code == 404
    assert not relevant_reference_sections(subject_id=subject.id, title="Permeability", lecture=[])
