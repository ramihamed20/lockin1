"""Read-only production inspection and PDF export for Dentistry Year 1 Physiology.

Designed to run inside the production backend container via stdin:
  sudo docker compose ... exec -T backend python - < inspect_and_export_physiology.py

Never writes to the database and never prints secrets, passwords, or keys.
Streams a tar archive to stdout containing:
  - live_physiology_report.json (latest live settings, modes, question counts)
  - manifest.json (extracted PDFs metadata & SHA-256 checksums)
  - extracted PDF files (SHA-256 verified)
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tarfile
import tempfile
from datetime import datetime, timezone

os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE",
    os.environ.get("DJANGO_SETTINGS_MODULE", "config.settings.production"),
)

import django  # noqa: E402

django.setup()

from django.db.models import F  # noqa: E402

from apps.content.active_study import plan_payload  # noqa: E402
from apps.content.admin_services import edition_primary_file  # noqa: E402
from apps.content.editions import LOCKIN, UNIVERSITY  # noqa: E402
from apps.content.models import (  # noqa: E402
    ActiveStudyQuestionContent,
    ActiveStudySettings,
    CatalogDocument,
    CatalogSubject,
    LearningObject,
    LearningObjectVersion,
)
from apps.questions.models import QuestionVersion  # noqa: E402


def _is_dentistry_year1(subject: CatalogSubject) -> bool:
    cohort = subject.cohort
    node = subject.source_node
    parts = [
        subject.material_slug or "",
        cohort.slug if cohort else "",
        node.path if node else "",
        node.title if node else "",
    ]
    joined = " ".join(parts).casefold()
    return (
        "physiology" in joined
        and "dentistry" in joined
        and ("year-1" in joined or "first year" in joined)
    )


def _serialize_settings(setting: ActiveStudySettings, *, page_bank_enabled: bool | None) -> dict:
    total = setting.total_pdf_pages
    excl_start = setting.excluded_start_pages
    excl_end = setting.excluded_end_pages
    questions_per_checkpoint = getattr(setting, "questions_per_checkpoint", 15)
    final_exam_questions = getattr(setting, "final_exam_questions", 50)
    plan = None
    if total:
        try:
            plan = plan_payload(
                total_pdf_pages=total,
                excluded_start_pages=excl_start,
                excluded_end_pages=excl_end,
                questions_per_checkpoint=questions_per_checkpoint,
                final_exam_questions=final_exam_questions,
                **(
                    {"page_question_bank": bool(page_bank_enabled)}
                    if "page_question_bank" in plan_payload.__code__.co_varnames
                    else {}
                ),
            )
        except Exception as exc:
            plan = {"plan_error": str(exc)}
    return {
        "edition": setting.edition,
        "enabled": setting.enabled,
        "total_pdf_pages": total,
        "excluded_start_pages": excl_start,
        "excluded_end_pages": excl_end,
        "effective_start_page": (excl_start + 1) if total else None,
        "effective_end_page": (total - excl_end) if total else None,
        "questions_per_checkpoint": questions_per_checkpoint,
        "final_exam_questions": final_exam_questions,
        "revision": setting.revision,
        "updated_at": setting.updated_at.isoformat() if setting.updated_at else None,
        "plan": plan,
    }


def _question_summary(sheet: LearningObject) -> dict:
    qs = QuestionVersion.objects.filter(
        source_learning_object=sheet,
        question__current_version=F("id"),
    )
    published = qs.filter(question__workflow_status="published")
    by_type = {}
    for row in published.values("question_type"):
        t = row["question_type"]
        by_type[t] = by_type.get(t, 0) + 1
    active_rows = [
        {
            "difficulty": row.difficulty,
            "checkpoint_question_count": row.checkpoint_question_count,
            "final_exam_question_count": row.final_exam_question_count,
            "revision": row.revision,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in ActiveStudyQuestionContent.objects.filter(sheet=sheet).order_by("difficulty")
    ]
    return {
        "normal_questions_total": qs.count(),
        "normal_questions_published": published.count(),
        "normal_questions_published_by_type": by_type,
        "active_study_content": active_rows,
    }


def main() -> None:
    phys_subjects = list(
        CatalogSubject.objects.filter(title__icontains="physiology")
        .select_related("cohort", "source_node")
        .order_by("material_slug")
    )

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dentistry_year1_subjects": [],
        "other_physiology_subjects": [],
    }
    manifest_entries = []
    exported_file_ids = set()

    tar = tarfile.open(fileobj=sys.stdout.buffer, mode="w|")

    for subj in phys_subjects:
        node = subj.source_node
        subj_info = {
            "subject_id": str(subj.id),
            "title": subj.title,
            "material_slug": subj.material_slug,
            "is_active": subj.is_active,
            "cohort_slug": subj.cohort.slug if subj.cohort else None,
            "node_path": node.path if node else None,
            "sheets": [],
        }
        if not _is_dentistry_year1(subj):
            sheet_count = (
                LearningObject.objects.filter(
                    current_version__academic_node__path__startswith=node.path,
                    current_version__content_type=LearningObjectVersion.ContentType.PDF,
                ).count()
                if node
                else 0
            )
            subj_info["pdf_sheet_count"] = sheet_count
            report["other_physiology_subjects"].append(subj_info)
            continue

        sheets = (
            list(
                LearningObject.objects.filter(
                    current_version__academic_node__path__startswith=node.path,
                    current_version__content_type=LearningObjectVersion.ContentType.PDF,
                )
                .select_related("current_version", "current_version__academic_node")
                .order_by("position", "created_at")
            )
            if node
            else []
        )

        for sheet in sheets:
            version = sheet.current_version
            title = version.title if version else str(sheet.id)
            page_bank_enabled = getattr(sheet, "active_study_page_bank_enabled", None)
            settings_rows = list(
                ActiveStudySettings.objects.filter(sheet=sheet).order_by("edition")
            )
            editions_info = {}

            for edition in (UNIVERSITY, LOCKIN):
                managed = edition_primary_file(sheet, edition)
                if not managed:
                    continue
                file_id = str(managed.id)
                expected_sha = managed.checksum_sha256 or ""
                page_count = managed.pdf_page_count or 0
                clean_slug = "".join(
                    c if c.isalnum() or c in ("-", "_") else "_" for c in subj.material_slug
                ).strip("_")
                clean_title = "".join(
                    c if c.isalnum() or c in ("-", "_") else "_" for c in title
                ).strip("_")
                archive_name = f"{clean_slug}__{edition}__{clean_title}__{file_id[:8]}.pdf"

                actual_sha = ""
                file_size = 0
                export_error = None
                if file_id not in exported_file_ids:
                    try:
                        digest = hashlib.sha256()
                        with managed.blob.open("rb") as src, tempfile.SpooledTemporaryFile(
                            max_size=16 * 1024 * 1024
                        ) as tmp:
                            for chunk in iter(lambda: src.read(1024 * 1024), b""):
                                digest.update(chunk)
                                tmp.write(chunk)
                            actual_sha = digest.hexdigest()
                            file_size = tmp.tell()
                            if expected_sha and actual_sha != expected_sha:
                                export_error = (
                                    f"checksum_mismatch: expected {expected_sha}, got {actual_sha}"
                                )
                            else:
                                item = tarfile.TarInfo(name=archive_name)
                                item.size = file_size
                                item.mode = 0o600
                                tmp.seek(0)
                                tar.addfile(item, tmp)
                                exported_file_ids.add(file_id)
                                manifest_entries.append(
                                    {
                                        "material_slug": subj.material_slug,
                                        "sheet_id": str(sheet.id),
                                        "sheet_title": title,
                                        "edition": edition,
                                        "file_id": file_id,
                                        "original_name": managed.original_name or "",
                                        "checksum": actual_sha,
                                        "page_count": page_count,
                                        "file_size": file_size,
                                        "archive_name": archive_name,
                                    }
                                )
                    except Exception as exc:
                        export_error = str(exc)

                doc = CatalogDocument.objects.filter(managed_file=managed, is_active=True).first()
                editions_info[edition] = {
                    "file_id": file_id,
                    "original_name": managed.original_name or "",
                    "page_count": page_count,
                    "checksum": expected_sha,
                    "sheet_slug": doc.sheet_slug if doc else None,
                    "archive_name": archive_name,
                    "export_error": export_error,
                }

            subj_info["sheets"].append(
                {
                    "sheet_id": str(sheet.id),
                    "title": title,
                    "workflow_status": sheet.workflow_status,
                    "position": sheet.position,
                    "active_study_page_bank_enabled": page_bank_enabled,
                    "inferred_mode": "pages" if page_bank_enabled else "parts",
                    "active_study_settings": [
                        _serialize_settings(s, page_bank_enabled=page_bank_enabled)
                        for s in settings_rows
                    ],
                    "existing_questions": _question_summary(sheet),
                    "editions": editions_info,
                }
            )

        report["dentistry_year1_subjects"].append(subj_info)

    for fname, obj in (
        ("live_physiology_report.json", report),
        (
            "manifest.json",
            {"files_count": len(manifest_entries), "files": manifest_entries},
        ),
    ):
        raw = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        info = tarfile.TarInfo(name=fname)
        info.size = len(raw)
        info.mode = 0o600
        tar.addfile(info, io.BytesIO(raw))

    tar.close()
    sys.stderr.write(
        f"SUCCESS: Inspected {len(report['dentistry_year1_subjects'])} Dentistry Year-1 Physiology subject(s), "
        f"exported {len(manifest_entries)} PDF(s).\n"
    )


if __name__ == "__main__":
    main()
