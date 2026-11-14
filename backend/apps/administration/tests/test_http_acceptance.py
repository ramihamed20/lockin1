from uuid import uuid4

import pytest
import requests
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.accounts.tests.helpers import PASSWORD, create_user
from apps.administration.tests.test_automation import page_document
from apps.administration.tests.test_references import text_pdf
from apps.audit.models import AuditRecord
from apps.content.models import LearningObject
from apps.content.tests.test_sheet_editions import _pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.questions.models import Question, QuestionImportBatch


def sign_in(host, account):
    session = requests.Session()
    session.trust_env = False
    csrf = session.get(host + "/api/v1/auth/csrf", timeout=10)
    csrf.raise_for_status()
    url = host + "/api/v1/auth/login"
    body = {"email": account.email, "password": PASSWORD}
    assert session.post(url, json=body, timeout=10).status_code == 403
    session.headers["X-CSRFToken"] = csrf.json()["csrf_token"]
    result = session.post(url, json=body, timeout=10)
    assert result.status_code == 200, result.text
    session.headers["X-CSRFToken"] = session.get(host + "/api/v1/auth/csrf", timeout=10).json()[
        "csrf_token"
    ]
    return session


def upload(session, url, pdf, **fields):
    return session.post(
        url, data=fields, files={"pdf": (pdf.name, pdf.read(), pdf.content_type)}, timeout=15
    )


@pytest.mark.django_db(transaction=True)
def test_admin_real_http_acceptance(live_server):
    actor = create_admin()
    _, subject, _ = published_path(admin=actor)
    host = live_server.url
    assert requests.get(host + "/api/v1/health/ready", timeout=10).status_code == 200
    admin = sign_in(host, actor)
    student = sign_in(host, create_user())
    base = host + "/api/v1/operations/admin"
    drafts = f"{base}/content/subjects/{subject.id}/automation-drafts"
    jobs = f"{base}/automation/jobs"
    refs = f"{base}/automation/subjects/{subject.id}/references"
    assert student.get(jobs, timeout=10).status_code == 403
    assert upload(student, drafts, _pdf(6, "denied.pdf"), title="Denied").status_code == 403

    sentence = "Inflammation involves changes in vascular permeability and immune activity."
    ref = upload(
        admin,
        refs,
        text_pdf(sentence),
        title="Inflammation exam",
        kind="past_exam",
        tags="inflammation",
        idempotency_key=str(uuid4()),
    )
    assert ref.status_code == 201, ref.text
    call_command("run_automation_worker", once=True)
    search = admin.get(refs, params={"q": "permeability"}, timeout=10)
    assert search.json()["matches"][0]["page"] == 1
    assert student.get(f"{refs}/{ref.json()['id']}/pdf", timeout=10).status_code == 403

    for count in (6, 8):
        result = upload(admin, drafts, _pdf(count, "lecture.pdf"), title="Vascular permeability")
        assert result.status_code == 201, result.text
        assert result.json()["workflow_status"] == "draft"
        assert result.json()["student_visible"] is False
        assert result.json()["subject_id"] == str(subject.id)
    sheet_id = result.json()["id"]
    duplicate = upload(admin, drafts, _pdf(6, "renamed.pdf"), title="Duplicate")
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "duplicate_sheet_pdf"
    bad_pdf = SimpleUploadedFile("invalid.pdf", b"%PDF-1.7\n", "application/pdf")
    malformed = upload(admin, drafts, bad_pdf, title="Invalid lecture")
    assert malformed.status_code == 400
    payload = {
        "job_type": "question_package",
        "sheet_id": sheet_id,
        "normal_count": 2,
        "idempotency_key": str(uuid4()),
    }
    queued = admin.post(jobs, json=payload, timeout=10)
    assert queued.status_code == 201, queued.text
    duplicate_job = admin.post(jobs, json=payload, timeout=10)
    assert duplicate_job.status_code == 200
    assert duplicate_job.json()["id"] == queued.json()["id"]
    call_command("run_automation_worker", once=True)
    job_url = f"{jobs}/{queued.json()['id']}"
    job = admin.get(job_url, timeout=10).json()
    assert job["status"] == "ready_for_ai", job
    assert job["output"]["reference_sections"][0]["reference_id"] == ref.json()["id"]
    assert job["output"]["visual_review_pages"] == list(range(1, 9))
    assert job["attempts"][0]["result"] == "succeeded"
    review = f"{job_url}/questions"
    started = admin.post(
        review, json={"action": "start", "expected_revision": job["revision"]}, timeout=10
    )
    revision = started.json()["revision"]
    document = page_document(job["output"]["plan"])
    document["sheet_questions"]["questions"][0]["source_page"] = 100
    result = admin.put(
        review, json={"payload": document, "expected_revision": revision}, timeout=10
    )
    assert result.status_code == 400, result.text
    document["sheet_questions"]["questions"][0]["source_page"] = 2
    result = admin.put(
        review, json={"payload": document, "expected_revision": revision}, timeout=10
    )
    assert result.status_code == 200, result.text
    active_revision = result.json()["job"]["revision"]
    assert result.json()["job"]["status"] == "needs_review"
    assert not QuestionImportBatch.objects.exists()
    stale = admin.post(
        review, json={"action": "approve", "expected_revision": revision}, timeout=10
    )
    assert stale.status_code == 409, stale.text
    approval = {"action": "approve", "expected_revision": active_revision}
    result = admin.post(review, json=approval, timeout=15)
    assert result.status_code == 200, result.text
    assert admin.post(review, json=approval, timeout=10).status_code == 409
    assert QuestionImportBatch.objects.count() == 1
    assert set(Question.objects.values_list("workflow_status", flat=True)) == {"draft"}
    assert AuditRecord.objects.filter(action="automation.candidate_approved", actor=actor).exists()
    publish = f"{base}/content/sheets/{sheet_id}/actions"
    sheet = LearningObject.objects.get(pk=sheet_id)
    assert sheet.published_version_id is None
    publish_body = {"action": "publish", "expected_revision": sheet.revision}
    assert student.post(publish, json=publish_body, timeout=10).status_code == 403
    result = admin.post(publish, json=publish_body, timeout=10)
    assert result.status_code == 200, result.text
    assert AuditRecord.objects.filter(action="content.sheet_published", actor=actor).exists()
    assert set(Question.objects.values_list("workflow_status", flat=True)) == {"draft"}

    result = admin.post(
        f"{base}/content/questions/bulk",
        json={
            "action": "publish",
            "question_ids": [str(key) for key in Question.objects.values_list("id", flat=True)],
        },
        timeout=10,
    )
    assert result.status_code == 200, result.text
    assert set(Question.objects.values_list("workflow_status", flat=True)) == {"published"}
    assert AuditRecord.objects.filter(action="questions.bulk_publish", actor=actor).exists()
