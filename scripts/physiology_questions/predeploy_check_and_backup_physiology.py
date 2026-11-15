#!/usr/bin/env python3
"""Read-only pre-deployment audit & lossless JSON rollback snapshot for Physiology.

Usage inside production container (strictly read-only, zero DB writes):
  sudo docker compose --env-file /home/lockin/lockin1/.env.production \
    -f /home/lockin/lockin1/compose.production.yaml \
    exec -T backend python - < predeploy_check_and_backup_physiology.py \
    > physiology_predeploy_snapshot.json
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

TARGET_SHEETS = [
    ("01. The Cell", "35923940-c141-44f6-bc49-acd4869577c0"),
    ("02. Cell Junction", "4e76d4c0-c3ee-4a69-a5b2-1d51479d1cc1"),
    ("03. Cell Membrane", "b6b6f3e8-1ec1-4b4f-af41-131b8faaa758"),
    ("04. Homeostasis", "06c3f406-cc1f-400b-86ee-308a41dbc03d"),
]
ARCHIVED_INTRO_ID = "766bc7a1-12df-4086-b3e4-1e0150809cd9"


def _canonical_sha256(obj: Any) -> str:
    raw = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _serialize_import_batch(batch: Any) -> dict[str, Any]:
    return {
        "id": str(batch.id),
        "actor_id": str(batch.actor_id),
        "academic_node_id": str(batch.academic_node_id),
        "sheet_id": str(batch.sheet_id),
        "schema_version": batch.schema_version,
        "status": batch.status,
        "question_count": batch.question_count,
        "type_counts": batch.type_counts,
        "warnings": batch.warnings,
        "undone_by_id": str(batch.undone_by_id) if batch.undone_by_id else None,
        "undone_at": batch.undone_at.isoformat() if batch.undone_at else None,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


def _serialize_question_full(question: Any, *, answer_count: int) -> dict[str, Any]:
    versions_out: list[dict[str, Any]] = []
    for ver in question.versions.all().prefetch_related("options").order_by("version_number", "id"):
        options_out = [
            {
                "id": str(opt.id),
                "text": opt.text,
                "position": opt.position,
                "is_correct": opt.is_correct,
            }
            for opt in ver.options.all().order_by("position", "id")
        ]
        versions_out.append(
            {
                "id": str(ver.id),
                "version_number": ver.version_number,
                "academic_node_id": str(ver.academic_node_id),
                "source_learning_object_id": (
                    str(ver.source_learning_object_id) if ver.source_learning_object_id else None
                ),
                "question_type": ver.question_type,
                "prompt": ver.prompt,
                "explanation": ver.explanation,
                "topic": ver.topic,
                "source_page": ver.source_page,
                "difficulty": ver.difficulty,
                "language": ver.language,
                "metadata": ver.metadata,
                "created_by_id": str(ver.created_by_id),
                "options": options_out,
            }
        )

    return {
        "id": str(question.id),
        "owner_id": str(question.owner_id),
        "import_batch_id": str(question.import_batch_id) if question.import_batch_id else None,
        "import_batch": _serialize_import_batch(question.import_batch)
        if question.import_batch is not None
        else None,
        "current_version_id": (
            str(question.current_version_id) if question.current_version_id else None
        ),
        "published_version_id": (
            str(question.published_version_id) if question.published_version_id else None
        ),
        "workflow_status": question.workflow_status,
        "review_note": question.review_note,
        "revision": question.revision,
        "published_at": question.published_at.isoformat() if question.published_at else None,
        "retired_at": question.retired_at.isoformat() if question.retired_at else None,
        "answer_count": answer_count,
        "versions": versions_out,
    }


def collect_predeploy_snapshot(
    sheet_specs: list[tuple[str, str]] | None = None,
    *,
    archived_intro_id: str | None = ARCHIVED_INTRO_ID,
) -> dict[str, Any]:
    """Collect a read-only pre-deployment state and lossless rollback snapshot."""

    from apps.content.all_questions import all_questions_sheet_questions
    from apps.content.models import (
        ActiveStudyQuestionContent,
        ActiveStudySettings,
        LearningObject,
    )
    from apps.focus.models import ActiveStudyRun
    from apps.questions.models import Question, QuestionAnswer, QuestionImportBatch

    specs = sheet_specs if sheet_specs is not None else TARGET_SHEETS
    sheets_out: list[dict[str, Any]] = []
    warnings: list[str] = []

    for label, sid in specs:
        sheet = LearningObject.objects.select_related("current_version").filter(id=sid).first()
        if sheet is None:
            warnings.append(f"Missing target sheet {label} ({sid})")
            sheets_out.append({"label": label, "sheet_id": sid, "exists": False})
            continue

        settings_rows = list(ActiveStudySettings.objects.filter(sheet=sheet).order_by("edition"))
        settings_backup = [
            {
                "id": str(s.id),
                "edition": s.edition,
                "enabled": s.enabled,
                "total_pdf_pages": s.total_pdf_pages,
                "source_version_id": str(s.source_version_id) if s.source_version_id else None,
                "page_count_verified_at": (
                    s.page_count_verified_at.isoformat() if s.page_count_verified_at else None
                ),
                "excluded_start_pages": s.excluded_start_pages,
                "excluded_end_pages": s.excluded_end_pages,
                "questions_per_checkpoint": s.questions_per_checkpoint,
                "final_exam_questions": s.final_exam_questions,
                "revision": s.revision,
                "updated_at": s.updated_at.isoformat(),
            }
            for s in settings_rows
        ]
        uni_setting = next((s for s in settings_rows if s.edition == "university"), None)

        content_rows = list(
            ActiveStudyQuestionContent.objects.filter(sheet=sheet).order_by("difficulty")
        )
        content_backup = [
            {
                "id": str(c.id),
                "difficulty": c.difficulty,
                "payload": c.payload,
                "plan_signature": c.plan_signature,
                "source_version_id": str(c.source_version_id) if c.source_version_id else None,
                "checkpoint_question_count": c.checkpoint_question_count,
                "final_exam_question_count": c.final_exam_question_count,
                "revision": c.revision,
                "created_by_id": str(c.created_by_id),
                "updated_by_id": str(c.updated_by_id),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in content_rows
        ]
        expected_revisions = {"easy": 0, "medium": 0, "hard": 0}
        for c in content_rows:
            expected_revisions[c.difficulty] = c.revision

        baseline_batches = list(
            QuestionImportBatch.objects.filter(sheet=sheet).order_by("created_at", "id")
        )
        baseline_import_batch_ids = [str(b.id) for b in baseline_batches]

        all_sheet_qs = list(
            Question.objects.filter(current_version__source_learning_object=sheet)
            .select_related("current_version", "import_batch")
            .order_by("created_at", "id")
        )
        by_status: dict[str, int] = {}
        for q in all_sheet_qs:
            by_status[q.workflow_status] = by_status.get(q.workflow_status, 0) + 1

        will_archive_qs = list(
            all_questions_sheet_questions(sheet)
            .select_related("import_batch")
            .prefetch_related("versions__options")
            .order_by("created_at", "id")
        )
        will_archive_id_set = {str(q.id) for q in will_archive_qs}
        will_archive_backup = [
            _serialize_question_full(
                q,
                answer_count=QuestionAnswer.objects.filter(question=q).count(),
            )
            for q in will_archive_qs
        ]
        untouched_questions_baseline = {
            str(q.id): {
                "workflow_status": q.workflow_status,
                "revision": q.revision,
                "current_version_id": (
                    str(q.current_version_id) if q.current_version_id else None
                ),
            }
            for q in all_sheet_qs
            if str(q.id) not in will_archive_id_set
        }
        total_answers_on_sheet = QuestionAnswer.objects.filter(
            question__current_version__source_learning_object=sheet
        ).count()

        runs = ActiveStudyRun.objects.filter(sheet=sheet)
        baseline_active_study_run_ids = [str(rid) for rid in runs.values_list("id", flat=True)]
        run_counts = {
            "total": runs.count(),
            "active": runs.filter(status="active").count(),
            "completed": runs.filter(status="completed").count(),
            "abandoned": runs.filter(status="abandoned").count(),
        }

        if will_archive_id_set:
            warnings.append(
                f"{label}: {len(will_archive_id_set)} existing all_questions normal Qs will be soft-archived."
            )
        if content_rows:
            warnings.append(
                f"{label}: {len(content_rows)} existing ActiveStudyQuestionContent bank(s) will be overwritten."
            )
        if run_counts["active"] > 0:
            warnings.append(
                f"{label}: {run_counts['active']} active student ActiveStudyRun(s) exist."
            )

        sheets_out.append(
            {
                "label": label,
                "sheet_id": str(sheet.id),
                "exists": True,
                "title": sheet.current_version.title if sheet.current_version else label,
                "workflow_status": sheet.workflow_status,
                "sheet_revision": sheet.revision,
                "active_study_page_bank_enabled": sheet.active_study_page_bank_enabled,
                "expected_settings_revision_university": uni_setting.revision if uni_setting else 0,
                "expected_revisions": expected_revisions,
                "baseline_import_batch_ids": baseline_import_batch_ids,
                "baseline_active_study_run_ids": baseline_active_study_run_ids,
                "active_study_settings_backup": settings_backup,
                "active_study_content_backup": content_backup,
                "existing_questions_summary": {
                    "total_all_statuses": len(all_sheet_qs),
                    "by_workflow_status": by_status,
                    "will_be_archived_all_questions_count": len(will_archive_id_set),
                    "untouched_other_questions_count": len(untouched_questions_baseline),
                    "total_student_answers_on_sheet": total_answers_on_sheet,
                },
                "untouched_questions_baseline": untouched_questions_baseline,
                "will_archive_questions_backup": will_archive_backup,
                "active_study_runs": run_counts,
            }
        )

    intro_summary = None
    if archived_intro_id:
        intro = (
            LearningObject.objects.select_related("current_version")
            .filter(id=archived_intro_id)
            .first()
        )
        if intro:
            intro_summary = {
                "sheet_id": str(intro.id),
                "title": intro.current_version.title if intro.current_version else "Introduction",
                "workflow_status": intro.workflow_status,
                "active_study_page_bank_enabled": intro.active_study_page_bank_enabled,
                "normal_questions_total": Question.objects.filter(
                    current_version__source_learning_object=intro
                ).count(),
            }

    snapshot = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "schema_version": 2,
        "read_only": True,
        "target_sheets": sheets_out,
        "excluded_archived_intro": intro_summary,
        "warnings": warnings,
    }
    return {
        "snapshot_sha256": _canonical_sha256(snapshot),
        "snapshot": snapshot,
    }


def collect_postimport_manifest(
    snapshot_envelope: dict[str, Any],
    *,
    target_batch_ids: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Capture expected post-import fingerprint (batch IDs, revisions, digests) read-only."""

    from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings, LearningObject
    from apps.questions.models import Question, QuestionImportBatch

    snap = snapshot_envelope["snapshot"]
    sheets_manifest: dict[str, dict[str, Any]] = {}
    batch_overrides = target_batch_ids or {}

    for entry in snap["target_sheets"]:
        if not entry.get("exists"):
            continue
        sid = entry["sheet_id"]
        sheet = LearningObject.objects.get(id=sid)
        baseline_ids = set(entry.get("baseline_import_batch_ids", []))
        new_batches = [
            b
            for b in QuestionImportBatch.objects.filter(sheet=sheet).order_by("created_at", "id")
            if str(b.id) not in baseline_ids
        ]
        if sid in batch_overrides:
            batch_id = batch_overrides[sid]
        elif len(new_batches) == 1:
            batch_id = str(new_batches[0].id)
        elif not new_batches:
            batch_id = None
        else:
            raise ValueError(
                f"Expected at most 1 new QuestionImportBatch on sheet {sid}, found {len(new_batches)}."
            )

        settings_by_edition = {
            s.edition: s.revision
            for s in ActiveStudySettings.objects.filter(sheet=sheet).order_by("edition")
        }
        contents = list(
            ActiveStudyQuestionContent.objects.filter(sheet=sheet).order_by("difficulty")
        )
        content_revisions = {c.difficulty: c.revision for c in contents}
        content_digests = {c.difficulty: _canonical_sha256(c.payload) for c in contents}
        batch_q_revisions = (
            {
                str(q.id): {
                    "revision": q.revision,
                    "workflow_status": q.workflow_status,
                }
                for q in Question.objects.filter(import_batch_id=batch_id).order_by("id")
            }
            if batch_id
            else {}
        )
        untouched_revisions = {
            str(q.id): {
                "revision": q.revision,
                "workflow_status": q.workflow_status,
            }
            for q in Question.objects.filter(
                id__in=list(entry.get("untouched_questions_baseline", {}).keys())
            ).order_by("id")
        }
        sheets_manifest[sid] = {
            "sheet_question_batch_id": batch_id,
            "settings_revisions": settings_by_edition,
            "content_revisions": content_revisions,
            "content_payload_sha256": content_digests,
            "batch_question_revisions": batch_q_revisions,
            "untouched_question_revisions": untouched_revisions,
        }

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "snapshot_sha256": snapshot_envelope["snapshot_sha256"],
        "sheets": sheets_manifest,
    }
    return {
        "manifest_sha256": _canonical_sha256(manifest),
        "manifest": manifest,
    }


def main() -> int:
    os.environ.setdefault(
        "DJANGO_SETTINGS_MODULE",
        os.environ.get("DJANGO_SETTINGS_MODULE", "config.settings.production"),
    )
    import django

    django.setup()
    envelope = collect_predeploy_snapshot()
    sys.stdout.write(json.dumps(envelope, indent=2, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
