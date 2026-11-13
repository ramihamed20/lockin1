from __future__ import annotations

import hashlib
import json
import unicodedata
from collections.abc import Iterator
from typing import Any
from uuid import UUID

from django.db import transaction

from apps.accounts.models import User
from apps.content.admin_services import edition_primary_file
from apps.content.all_questions import (
    AllQuestionsValidationError,
    save_all_questions,
    validate_all_questions,
)
from apps.content.editions import UNIVERSITY
from apps.content.models import LearningObject
from apps.files.services import managed_file_delivery_ready

from .automation import AutomationConflict, audit_job, available_types, transition
from .automation_tasks import AutomationBlocked, sheet_task_context
from .models import AutomationArtifact, AutomationJob

Status = AutomationJob.Status


def lock_review_job(actor: User, job_id: UUID, expected_revision: int) -> AutomationJob:
    job = (
        AutomationJob.objects.select_for_update()
        .filter(job_type="question_package", job_type__in=available_types(actor, write=True))
        .get(id=job_id)
    )
    if job.revision != expected_revision:
        raise AutomationConflict("The job changed. Reload the current revision.")
    return job


def source_sheet(job: AutomationJob) -> LearningObject:
    sheet_id = job.learning_object_id
    if sheet_id is None:
        raise AutomationConflict("The source sheet no longer exists.")
    sheet = LearningObject.objects.select_for_update().filter(pk=sheet_id).first()
    if sheet is None or sheet.revision != job.input_manifest["sheet_revision"]:
        raise AutomationConflict("The PDF revision changed. Queue a fresh task.")
    file = edition_primary_file(sheet, UNIVERSITY)
    if (
        file is None
        or file.checksum_sha256 != job.output_manifest.get("source_sha256")
        or not managed_file_delivery_ready(file)
    ):
        raise AutomationConflict("The source PDF changed or is unavailable.")
    try:
        current = sheet_task_context(sheet, job.input_manifest["normal_count"])
    except AutomationBlocked as error:
        raise AutomationConflict(str(error)) from error
    if current != job.output_manifest["plan"]:
        raise AutomationConflict("The Active Study plan changed. Queue a fresh task.")
    return sheet


def question_items(payload: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    for difficulty, bank in payload["active_study"].items():
        for group_name in ("parts", "pages"):
            for group_index, group in enumerate(bank.get(group_name, [])):
                for index, question in enumerate(group["questions"]):
                    yield (
                        f"active_study.{difficulty}.{group_name}[{group_index}].questions[{index}]",
                        question,
                    )
        for index, question in enumerate(bank["final_exam"]["questions"]):
            yield f"active_study.{difficulty}.final_exam.questions[{index}]", question
    for index, question in enumerate(payload.get("sheet_questions", {}).get("questions", [])):
        yield f"sheet_questions.questions[{index}]", question


def check_generated_questions(payload: dict[str, Any], summary: dict[str, object]) -> None:
    seen: dict[str, str] = {}
    errors = []
    for path, question in question_items(payload):
        prompt = unicodedata.normalize("NFKC", question["question"]).casefold()
        key = " ".join(prompt.split()).rstrip("?.!؟")
        first = seen.setdefault(key, path)
        if first != path:
            errors.append(
                {
                    "path": f"{path}.question",
                    "message": f"This question repeats {first}.",
                }
            )
    if errors:
        raise AllQuestionsValidationError(errors, summary)


@transaction.atomic
def review_candidate(
    *,
    actor: User,
    job_id: UUID,
    revision: int,
    payload: Any,
) -> tuple[AutomationJob, dict[str, object]]:
    job = lock_review_job(actor, job_id, revision)
    if job.status not in {Status.READY_FOR_AI, Status.PROCESSING, Status.NEEDS_REVIEW}:
        raise AutomationConflict("The job is not accepting a question document.")
    sheet = source_sheet(job)
    transition(job, Status.VALIDATING)
    validation = validate_all_questions(
        sheet=sheet,
        payload=payload,
        edition=UNIVERSITY,
        sheet_question_count=job.input_manifest["normal_count"],
    )
    # With zero Normal Questions, the legacy validator permits the entire
    # optional section to be omitted. Treat null the same here.
    if job.input_manifest["normal_count"] == 0:
        payload = {**payload, "sheet_questions": {"questions": []}}
    check_generated_questions(payload, validation.summary)
    canonical = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    AutomationArtifact.objects.update_or_create(
        job=job,
        artifact_type=AutomationArtifact.Kind.QUESTION_CANDIDATE,
        defaults={
            "payload": payload,
            "checksum": hashlib.sha256(canonical.encode()).hexdigest(),
            "validation_status": AutomationArtifact.Validation.VALID,
        },
    )
    transition(job, Status.NEEDS_REVIEW)
    audit_job(job, actor=actor, action="candidate_validated")
    return job, validation.as_dict()


@transaction.atomic
def review_action(
    *,
    actor: User,
    job_id: UUID,
    revision: int,
    action: str,
) -> AutomationJob:
    job = lock_review_job(actor, job_id, revision)
    if action == "start":
        transition(job, Status.PROCESSING)
    elif action == "reject":
        if job.status != Status.NEEDS_REVIEW:
            raise AutomationConflict("There is no validated candidate to reject.")
        job.artifacts.filter(artifact_type=AutomationArtifact.Kind.QUESTION_CANDIDATE).update(
            validation_status=AutomationArtifact.Validation.REJECTED
        )
        transition(job, Status.READY_FOR_AI)
    elif action == "approve":
        if job.status != Status.NEEDS_REVIEW:
            raise AutomationConflict("A validated candidate is required for approval.")
        sheet = source_sheet(job)
        artifact = job.artifacts.get(
            artifact_type=AutomationArtifact.Kind.QUESTION_CANDIDATE,
            validation_status=AutomationArtifact.Validation.VALID,
        )
        plan = job.output_manifest["plan"]
        transition(job, Status.APPROVED)
        audit_job(job, actor=actor, action="candidate_approved")
        imported = save_all_questions(
            actor=actor,
            sheet_id=sheet.id,
            payload=artifact.payload,
            edition=UNIVERSITY,
            sheet_question_count=job.input_manifest["normal_count"],
            excluded_start_pages=plan["excluded_start_pages"],
            excluded_end_pages=plan["excluded_end_pages"],
            settings_revision=plan["settings_revision"],
            expected_revisions={
                row["difficulty"]: row["existing"]["revision"] for row in plan["difficulties"]
            },
            publish_sheet_questions=False,
            draft_sheet_revision=plan["sheet_revision"],
        )
        job.output_manifest = {
            **job.output_manifest,
            "draft_import": imported,
            "approved_by": str(actor.id),
        }
        transition(job, Status.COMPLETED)
    else:
        raise AutomationConflict("Unsupported review action.")
    audit_job(job, actor=actor, action=action)
    return job
