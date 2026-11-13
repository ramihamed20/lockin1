from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit

from .automation_tasks import TASKS, AutomationBlocked
from .models import AutomationAttempt, AutomationJob
from .permissions import operational_capabilities

logger = logging.getLogger(__name__)
Status = AutomationJob.Status
Result = AutomationAttempt.Result
MAX_ATTEMPTS = 3
LEASE = timedelta(minutes=5)
# Transaction-scoped lock shared by queue claimers. Work runs outside the transaction.
CLAIM_LOCK = 0x4C4F434B4155544F
TRANSITIONS: dict[str, set[str]] = {
    Status.QUEUED: {Status.PREPARING, Status.CANCELLED},
    Status.PREPARING: {
        Status.QUEUED,
        Status.READY_FOR_AI,
        Status.COMPLETED,
        Status.FAILED,
        Status.CANCELLED,
        Status.BLOCKED,
    },
    Status.READY_FOR_AI: {Status.PROCESSING, Status.VALIDATING, Status.CANCELLED},
    Status.PROCESSING: {Status.VALIDATING, Status.CANCELLED},
    Status.VALIDATING: {Status.NEEDS_REVIEW, Status.READY_FOR_AI, Status.FAILED, Status.BLOCKED},
    Status.NEEDS_REVIEW: {
        Status.VALIDATING,
        Status.APPROVED,
        Status.READY_FOR_AI,
        Status.CANCELLED,
    },
    Status.APPROVED: {Status.COMPLETED},
    Status.FAILED: {Status.QUEUED, Status.CANCELLED},
    Status.BLOCKED: {Status.QUEUED, Status.CANCELLED},
}
FINISHED = {Status.COMPLETED, Status.FAILED, Status.CANCELLED, Status.BLOCKED}
STAGE_PROGRESS: dict[str, int] = {
    Status.READY_FOR_AI: 40,
    Status.NEEDS_REVIEW: 75,
    Status.APPROVED: 90,
    Status.COMPLETED: 100,
}


class AutomationConflict(ValueError):
    pass


def available_types(actor: User, *, write: bool = False) -> list[str]:
    capabilities = operational_capabilities(actor)
    return [
        key
        for key, task in TASKS.items()
        if capabilities.issuperset(
            task.view_permissions + (task.write_permissions if write else ())
        )
    ]


def audit_job(job: AutomationJob, *, actor: User | None, action: str) -> None:
    record_audit(
        actor=actor,
        action=f"automation.{action}",
        domain="automation",
        target_type="administration.automation_job",
        target_id=str(job.id),
        reason="Administrative automation workflow.",
        source="administration.automation",
        new_state={"status": job.status, "revision": job.revision, "job_type": job.job_type},
    )


@transaction.atomic
def enqueue_job(
    *,
    actor: User,
    job_type: str,
    idempotency_key: UUID,
    input_manifest: dict[str, Any],
    subject_id: UUID | None = None,
    sheet_id: UUID | None = None,
) -> tuple[AutomationJob, bool]:
    try:
        with transaction.atomic():
            job, created = AutomationJob.objects.get_or_create(
                requested_by=actor,
                idempotency_key=idempotency_key,
                defaults={
                    "job_type": job_type,
                    "input_manifest": input_manifest,
                    "academic_subject_id": subject_id,
                    "learning_object_id": sheet_id,
                },
            )
    except IntegrityError as error:
        raise AutomationConflict(
            "An active automation job already exists for this sheet."
        ) from error
    if not created and (
        job.job_type,
        job.input_manifest,
        job.academic_subject_id,
        job.learning_object_id,
    ) != (job_type, input_manifest, subject_id, sheet_id):
        raise AutomationConflict("This request key was already used with different inputs.")
    if created:
        audit_job(job, actor=actor, action="queued")
    return job, created


def transition(job: AutomationJob, target: str, *, error: tuple[str, str] = ("", "")) -> None:
    """Change a row already locked by the calling transaction."""
    if target not in TRANSITIONS.get(job.status, set()):
        raise AutomationConflict(f"Cannot move a {job.get_status_display()} job to {target}.")
    job.status = target
    job.revision += 1
    job.error_code, job.error_message = error
    job.completed_at = timezone.now() if target in FINISHED else None
    if target != Status.PREPARING:
        job.lease_expires_at = None
    if target == Status.QUEUED:
        job.progress = 0
        job.started_at = None
        job.output_manifest = {}
    elif target in STAGE_PROGRESS:
        job.progress = STAGE_PROGRESS[target]
    job.save()


def finish_attempt(job: AutomationJob, result: str, error: tuple[str, str] = ("", "")) -> None:
    job.attempts.filter(finished_at__isnull=True).update(
        finished_at=timezone.now(),
        result=result,
        error_details={"code": error[0], "message": error[1]} if error[0] else {},
    )


@transaction.atomic
def control_job(*, actor: User, job_id: UUID, revision: int, action: str) -> AutomationJob:
    job = AutomationJob.objects.select_for_update().get(
        id=job_id, job_type__in=available_types(actor, write=True)
    )
    if job.revision != revision:
        raise AutomationConflict("The job changed. Refresh it before taking action.")
    if action == "retry":
        if job.status not in {Status.FAILED, Status.BLOCKED}:
            raise AutomationConflict("Only failed or blocked jobs can be retried.")
        if job.attempts.count() >= MAX_ATTEMPTS:
            raise AutomationConflict("This job reached its retry limit.")
        try:
            with transaction.atomic():
                transition(job, Status.QUEUED)
        except IntegrityError as error:
            raise AutomationConflict("Another active job exists for this sheet.") from error
    else:
        transition(job, Status.CANCELLED)
        finish_attempt(job, Result.CANCELLED)
    audit_job(job, actor=actor, action=action)
    return job


@transaction.atomic
def claim_job() -> AutomationJob | None:
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [CLAIM_LOCK])
    now = timezone.now()
    running = AutomationJob.objects.filter(status=Status.PREPARING)
    expired = running.select_for_update(skip_locked=True).filter(lease_expires_at__lte=now)
    for abandoned in expired:
        error = ("worker_abandoned", "The worker stopped before saving a result.")
        finish_attempt(abandoned, Result.ABANDONED, error)
        target = Status.FAILED if abandoned.attempts.count() >= MAX_ATTEMPTS else Status.QUEUED
        transition(abandoned, target, error=error)
        audit_job(abandoned, actor=None, action="recovered")
    if running.exists():
        return None
    job = (
        AutomationJob.objects.select_for_update(skip_locked=True)
        .filter(status=Status.QUEUED, job_type__in=TASKS)
        .order_by("-priority", "created_at", "id")
        .first()
    )
    if job is None:
        return None
    job.started_at = now
    job.lease_expires_at = now + LEASE
    transition(job, Status.PREPARING)
    AutomationAttempt.objects.create(job=job, attempt_number=job.attempts.count() + 1)
    return job


@transaction.atomic
def finish_job(
    *,
    job_id: UUID,
    claim_revision: int,
    output: dict[str, Any],
    target: str,
    result: str,
    error: tuple[str, str] = ("", ""),
) -> bool:
    job = AutomationJob.objects.select_for_update().get(id=job_id)
    if job.status != Status.PREPARING or job.revision != claim_revision:
        return False
    task = TASKS[job.job_type]
    if task.commit_output is not None and result == Result.SUCCEEDED:
        try:
            with transaction.atomic():
                output = task.commit_output(job, output)
        except Exception:
            logger.error("Automation job %s failed while saving its result.", job.id)
            target, result, error, output = (
                Status.FAILED,
                Result.FAILED,
                ("output_failed", "Could not save the job result. Retry this job."),
                {},
            )
    job.output_manifest = output
    transition(job, target, error=error)
    finish_attempt(job, result, error)
    audit_job(job, actor=None, action="worker_finished")
    return True


def process_one_job() -> bool:
    job = claim_job()
    if job is None:
        return False
    task = TASKS[job.job_type]
    output: dict[str, Any] = {}
    try:
        actor = job.requested_by
        if actor is None or job.job_type not in available_types(actor, write=True):
            raise AutomationBlocked("permission_removed", "The requester no longer has access.")
        output = task.prepare(job)
        target, result, error = task.success_status, Result.SUCCEEDED, ("", "")
    except AutomationBlocked as blocked:
        target, result, error = Status.BLOCKED, Result.BLOCKED, (blocked.code, str(blocked))
    except Exception:
        logger.error("Automation job %s failed during preparation.", job.id)
        target, result, error = (
            Status.FAILED,
            Result.FAILED,
            ("preparation_failed", "Preparation failed. Retry this job."),
        )
    finish_job(
        job_id=job.id,
        claim_revision=job.revision,
        output=output,
        target=target,
        result=result,
        error=error,
    )
    return True
