from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.administration.automation import (
    MAX_ATTEMPTS,
    AutomationConflict,
    claim_job,
    control_job,
    finish_job,
    transition,
)
from apps.administration.models import (
    AutomationAttempt,
    AutomationJob,
    OperationalCapabilityAssignment,
)
from apps.audit.models import AuditRecord
from apps.content.tests.test_sheet_editions import _pdf
from apps.education.tests.helpers import create_admin, published_path

JOBS = "/api/v1/operations/admin/automation/jobs"
Status = AutomationJob.Status
pytestmark = pytest.mark.django_db


def setup_draft():
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    client = APIClient()
    client.force_authenticate(admin)
    response = client.post(
        f"/api/v1/operations/admin/content/subjects/{subject.id}/automation-drafts",
        {"title": "Test lecture", "pdf": _pdf(6, "test.pdf")},
    )
    assert response.status_code == 201, response.json()
    return admin, client, subject, response.json()["id"]


def enqueue(client, sheet_id, **overrides):
    body = {
        "job_type": "question_package",
        "sheet_id": sheet_id,
        "normal_count": 2,
        "idempotency_key": str(uuid4()),
        **overrides,
    }
    return client.post(JOBS, body, format="json")


def test_job_package_is_persistent_and_idempotent():
    admin, client, subject, sheet_id = setup_draft()
    key = str(uuid4())
    first = enqueue(client, sheet_id, idempotency_key=key)
    assert first.status_code == 201, first.json()
    job_id = first.json()["id"]
    repeat = enqueue(client, sheet_id, idempotency_key=key)
    assert repeat.status_code == 200 and repeat.json()["id"] == job_id
    assert enqueue(client, sheet_id, idempotency_key=key, normal_count=3).status_code == 409
    assert enqueue(client, sheet_id).status_code == 409
    assert client.get(f"{JOBS}?subject={subject.id}").json()["status_counts"] == {"queued": 1}

    call_command("run_automation_worker", once=True)
    job = client.get(f"{JOBS}/{job_id}").json()
    assert job["status"] == Status.READY_FOR_AI
    assert job["attempts"][0]["result"] == "succeeded"
    assert job["output"]["plan"]["sheet_revision"] == 1
    assert job["output"]["plan"]["total_pdf_pages"] == 6
    assert job["output"]["schema"] == "lockin.question_task.v1"
    assert job["output"]["normal_count"] == 2
    assert client.get(f"{JOBS}?status=failed").json()["count"] == 0
    assert AuditRecord.objects.filter(action="automation.queued", actor=admin).count() == 1


def test_job_permissions_are_checked_on_reads_controls_and_worker():
    _, client, _, sheet_id = setup_draft()
    user = create_user()
    for capability in ("content.view", "assessments.view", "content.manage", "assessments.manage"):
        OperationalCapabilityAssignment.objects.create(user=user, capability_id=capability)
    client.force_authenticate(user)
    created = enqueue(client, sheet_id)
    assert created.status_code == 201, created.json()
    job_id = created.json()["id"]
    OperationalCapabilityAssignment.objects.filter(
        user=user, capability_id="assessments.manage"
    ).delete()
    user.__dict__.pop("_operational_capability_cache", None)
    assert client.get(f"{JOBS}/{job_id}").status_code == 200
    assert (
        client.post(f"{JOBS}/{job_id}", {"action": "cancel", "expected_revision": 1}).status_code
        == 403
    )
    call_command("run_automation_worker", once=True)
    assert client.get(f"{JOBS}/{job_id}").json()["error_code"] == "permission_removed"
    client.force_authenticate(create_user(email="automation-student@example.com"))
    assert client.get(JOBS).status_code == 403
    assert client.get(f"{JOBS}/{job_id}").status_code == 403
    assert enqueue(client, sheet_id).status_code == 403


def test_worker_recovery_retry_limit_and_cancel_fence():
    admin, client, _, sheet_id = setup_draft()
    job_id = enqueue(client, sheet_id).json()["id"]
    with pytest.raises(AutomationConflict):
        transition(AutomationJob.objects.get(id=job_id), Status.COMPLETED)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        job = claim_job()
        assert job is not None
        assert job.attempts.count() == attempt
        assert claim_job() is None
        AutomationJob.objects.filter(pk=job.id).update(lease_expires_at=timezone.now())
    assert claim_job() is None
    job.refresh_from_db()
    assert job.status == Status.FAILED
    assert set(job.attempts.values_list("result", flat=True)) == {"abandoned"}
    with pytest.raises(AutomationConflict, match="retry limit"):
        control_job(actor=admin, job_id=job.id, revision=job.revision, action="retry")
    with pytest.raises(AutomationConflict, match="job changed"):
        control_job(actor=admin, job_id=job.id, revision=1, action="cancel")

    other_id = enqueue(client, sheet_id).json()["id"]
    job = claim_job()
    assert job is not None and str(job.id) == other_id
    claim_revision = job.revision
    control_job(actor=admin, job_id=job.id, revision=claim_revision, action="cancel")
    assert not finish_job(
        job_id=job.id,
        claim_revision=claim_revision,
        output={"late": True},
        target=Status.READY_FOR_AI,
        result=AutomationAttempt.Result.SUCCEEDED,
    )
    job.refresh_from_db()
    assert job.status == Status.CANCELLED and job.output_manifest == {}
    assert job.attempts.get().result == "cancelled"


def test_worker_retries_a_blocked_pdf_after_scan(settings):
    admin, client, _, sheet_id = setup_draft()
    settings.CONTENT_REQUIRE_CLEAN_SCAN = True
    job_id = enqueue(client, sheet_id).json()["id"]
    call_command("run_automation_worker", once=True)
    job = AutomationJob.objects.get(id=job_id)
    assert job.error_code == "pdf_unavailable"
    control_job(actor=admin, job_id=job.id, revision=job.revision, action="retry")
    settings.CONTENT_REQUIRE_CLEAN_SCAN = False
    call_command("run_automation_worker", once=True)
    job.refresh_from_db()
    assert job.status == Status.READY_FOR_AI
    assert list(job.attempts.values_list("result", flat=True)) == ["blocked", "succeeded"]


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_workers_only_claim_one_job():
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL locking test")
    admin, client, subject, first = setup_draft()
    second = client.post(
        f"/api/v1/operations/admin/content/subjects/{subject.id}/automation-drafts",
        {"title": "Other", "pdf": _pdf(8, "other.pdf")},
    ).json()["id"]
    assert enqueue(client, first).status_code == 201
    assert enqueue(client, second).status_code == 201

    def claim():
        close_old_connections()
        try:
            return claim_job()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as workers:
        claims = list(workers.map(lambda _: claim(), range(2)))
    assert sum(job is not None for job in claims) == 1
    assert AutomationJob.objects.filter(status=Status.QUEUED).count() == 1
    assert (
        AutomationJob.objects.filter(
            status=Status.PREPARING, lease_expires_at__gt=timezone.now() + timedelta(minutes=1)
        ).count()
        == 1
    )
    assert AuditRecord.objects.filter(action="automation.queued", actor=admin).count() == 2


def page_document(plan, normal_count=2):
    from apps.content.tests.test_all_questions import _question

    active = {}
    for row in plan["difficulties"]:
        difficulty = row["difficulty"]
        active[difficulty] = {
            "pages": [
                {"page": page, "questions": [_question(f"{difficulty}-page-{page}")]}
                for page in row["page_numbers"]
            ],
            "final_exam": {
                "questions": [
                    _question(f"{difficulty}-final-{index}")
                    for index in range(row["final_exam_questions"])
                ]
            },
        }
    return {
        "active_study": active,
        "sheet_questions": {"questions": [_question(f"normal-{i}") for i in range(normal_count)]},
    }


def test_question_job_validation_review_import_and_separate_publication():
    from copy import deepcopy

    from apps.content.models import LearningObject
    from apps.questions.models import Question, QuestionImportBatch, QuestionVersion

    admin, client, _, sheet_id = setup_draft()
    job_id = enqueue(client, sheet_id).json()["id"]
    call_command("run_automation_worker", once=True)
    job = client.get(f"{JOBS}/{job_id}").json()
    assert job["status"] == Status.READY_FOR_AI
    assert job["output"]["visual_review_pages"] == [1, 2, 3, 4, 5, 6]
    review = f"{JOBS}/{job_id}/questions"
    response = client.post(review, {"action": "start", "expected_revision": job["revision"]})
    assert response.status_code == 200
    revision = response.json()["revision"]
    document = page_document(job["output"]["plan"])
    document["sheet_questions"]["questions"][0].update(source_page=2, difficulty="easy")
    wrong = deepcopy(document)
    wrong["active_study"]["easy"]["pages"][0]["page"] = 100
    invalid = client.put(review, {"payload": wrong, "expected_revision": revision}, format="json")
    assert invalid.status_code == 400
    assert any("page" in error["path"] for error in invalid.json()["errors"])
    wrong = deepcopy(document)
    wrong["sheet_questions"]["questions"][0] = wrong["active_study"]["easy"]["pages"][0][
        "questions"
    ][0]
    duplicate = client.put(review, {"payload": wrong, "expected_revision": revision}, format="json")
    assert duplicate.status_code == 400
    assert any("repeats" in error["message"] for error in duplicate.json()["errors"])
    assert client.get(review).status_code == 404
    wrong = deepcopy(document)
    wrong["sheet_questions"]["questions"][0]["source_page"] = 7
    invalid = client.put(review, {"payload": wrong, "expected_revision": revision}, format="json")
    assert invalid.status_code == 400
    assert any(error["path"].endswith(".source_page") for error in invalid.json()["errors"])

    validated = client.put(
        review, {"payload": document, "expected_revision": revision}, format="json"
    )
    assert validated.status_code == 200, validated.json()
    assert validated.json()["job"]["status"] == Status.NEEDS_REVIEW
    candidate = client.get(review).json()
    assert candidate["payload"] == document
    assert QuestionImportBatch.objects.count() == 0
    rejected = client.post(review, {"action": "reject", "expected_revision": candidate["revision"]})
    assert rejected.status_code == 200
    assert client.get(review).status_code == 404
    validated = client.put(
        review,
        {"payload": document, "expected_revision": rejected.json()["revision"]},
        format="json",
    )
    revision = validated.json()["job"]["revision"]
    approved = client.post(review, {"action": "approve", "expected_revision": revision})
    assert approved.status_code == 200, approved.json()
    assert approved.json()["status"] == Status.COMPLETED
    assert (
        client.post(review, {"action": "approve", "expected_revision": revision}).status_code == 409
    )
    sheet = LearningObject.objects.get(id=sheet_id)
    assert sheet.published_version_id is None
    assert QuestionImportBatch.objects.count() == 1
    assert QuestionVersion.objects.filter(source_page=2, difficulty="easy").count() == 1
    assert set(Question.objects.values_list("workflow_status", flat=True)) == {"draft"}
    assert (
        AuditRecord.objects.filter(action="automation.candidate_approved", actor=admin).count() == 1
    )

    base = f"/api/v1/operations/admin/content/sheets/{sheet_id}"
    student = APIClient()
    student.force_authenticate(create_user())
    response = student.get(f"/api/v1/focus/managed-active-study/sheets/{sheet_id}")
    assert response.status_code == 400
    assert "Active Study is not available for this sheet" in response.json()["error"]["message"]
    assert (
        student.post(
            f"{base}/actions", {"action": "publish", "expected_revision": sheet.revision}
        ).status_code
        == 403
    )
    published = client.post(
        f"{base}/actions", {"action": "publish", "expected_revision": sheet.revision}
    )
    assert published.status_code == 200, published.json()
    assert AuditRecord.objects.filter(action="content.sheet_published", actor=admin).count() == 1
    assert set(Question.objects.values_list("workflow_status", flat=True)) == {"draft"}
    question_ids = [str(value) for value in Question.objects.values_list("id", flat=True)]
    result = client.post(
        "/api/v1/operations/admin/content/questions/bulk",
        {"action": "publish", "question_ids": question_ids},
        format="json",
    )
    assert result.status_code == 200, result.json()
    assert set(Question.objects.values_list("workflow_status", flat=True)) == {"published"}
    assert AuditRecord.objects.filter(action="questions.bulk_publish", actor=admin).exists()


def test_question_approval_rejects_changed_sheet():
    _, client, _, sheet_id = setup_draft()
    job_id = enqueue(client, sheet_id).json()["id"]
    call_command("run_automation_worker", once=True)
    job = client.get(f"{JOBS}/{job_id}").json()
    review = f"{JOBS}/{job_id}/questions"
    response = client.put(
        review,
        {"payload": page_document(job["output"]["plan"]), "expected_revision": job["revision"]},
        format="json",
    )
    assert response.status_code == 200, response.json()
    revision = response.json()["job"]["revision"]
    changed = client.patch(
        f"/api/v1/operations/admin/content/sheets/{sheet_id}",
        {"title": "Changed lecture", "expected_revision": 1},
        format="json",
    )
    assert changed.status_code == 200, changed.json()
    assert (
        client.post(review, {"action": "approve", "expected_revision": revision}).status_code == 409
    )
    assert client.get(f"{JOBS}/{job_id}").json()["status"] == Status.NEEDS_REVIEW


def test_bounded_operator_image_export(tmp_path):
    from shutil import which

    from django.core.management.base import CommandError

    if which("pdftoppm") is None:
        pytest.skip("Optional operator tool Poppler is unavailable")
    _, client, _, sheet_id = setup_draft()
    job_id = enqueue(client, sheet_id).json()["id"]
    call_command("run_automation_worker", once=True)
    with pytest.raises(CommandError, match="within the original PDF"):
        call_command(
            "export_automation_page_images",
            job_id,
            "--page",
            "7",
            "--output-dir",
            str(tmp_path / "invalid"),
        )
    target = tmp_path / "pages"
    call_command(
        "export_automation_page_images",
        job_id,
        "--page",
        "2",
        "--page",
        "6",
        "--output-dir",
        str(target),
    )
    assert [path.name for path in sorted(target.iterdir())] == ["page-0002.png", "page-0006.png"]
    assert (target / "page-0002.png").read_bytes().startswith(b"\x89PNG")
