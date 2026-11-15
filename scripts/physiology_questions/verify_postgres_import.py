#!/usr/bin/env python3
"""Verify importing all 4 Physiology All Questions JSONs into PostgreSQL (isolated CI DB)."""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
OUT_DIR = HERE / "outputs"

# (filename, title, total_pages, expected_received, backend_expected_at_15_per_page)
SHEETS = [
    ("01_the_cell_35923940_all_questions.json", "01. The Cell", 8, 309, 450),
    ("02_cell_junction_4e76d4c0_all_questions.json", "02. Cell Junction", 5, 264, 315),
    ("03_cell_membrane_bde95a78_all_questions.json", "03. Cell Membrane", 7, 312, 405),
    ("04_homeostasis_2855f5b0_all_questions.json", "04. Homeostasis", 6, 276, 360),
]


def main() -> int:
    tmpdir = Path(tempfile.mkdtemp(prefix="pg_import_verify_"))
    try:
        media_dir = tmpdir / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.test")
        os.environ["LOCKIN_TEST_MEDIA_ROOT"] = str(media_dir)
        sys.path.insert(0, str(BACKEND_DIR))

        import django

        django.setup()
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.core.management import call_command
        from django.db import connection
        from pypdf import PdfWriter
        from rest_framework.test import APIClient

        use_sqlite = os.environ.get("LOCKIN_TEST_USE_SQLITE", "").lower() in {"1", "true", "yes"}
        if not use_sqlite:
            assert connection.vendor == "postgresql", f"Expected postgresql, got {connection.vendor}"
            assert connection.features.has_select_for_update is True, "Expected select_for_update=True on PostgreSQL"

        call_command("migrate", verbosity=0)

        from apps.content.admin_services import create_sheet
        from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings
        from apps.content.page_question_bank import QUESTIONS_PER_PAGE, select_page_questions
        from apps.education.tests.helpers import create_admin, published_path
        from apps.files.services import create_managed_file
        from apps.questions.models import Question

        assert QUESTIONS_PER_PAGE == 15, f"Expected QUESTIONS_PER_PAGE=15, got {QUESTIONS_PER_PAGE}"

        def make_pdf(pages: int, name: str) -> SimpleUploadedFile:
            writer = PdfWriter()
            for _ in range(pages):
                writer.add_blank_page(width=200, height=200)
            buf = io.BytesIO()
            writer.write(buf)
            return SimpleUploadedFile(name, buf.getvalue(), content_type="application/pdf")

        admin = create_admin()
        _, subject, _ = published_path(admin=admin)
        client = APIClient()
        client.force_authenticate(admin)

        for filename, title, total_pages, expected_received, expected_capacity in SHEETS:
            payload_bytes = (OUT_DIR / filename).read_bytes()
            sheet = create_sheet(
                actor=admin,
                subject=subject,
                managed_file=create_managed_file(
                    owner=admin, upload=make_pdf(total_pages, f"{title}.pdf"), kind="pdf"
                ),
                title=title,
                summary="",
                position=0,
                publish=True,
                notify_students=False,
                allow_download=False,
            )
            assert sheet.active_study_page_bank_enabled is True, "Expected pages mode on new sheet"
            base = f"/api/v1/operations/admin/content/sheets/{sheet.id}"

            patched = client.patch(
                f"{base}/active-study",
                {
                    "expected_revision": 0,
                    "enabled": True,
                    "excluded_start_pages": 1,
                    "excluded_end_pages": 1,
                },
                format="json",
            )
            assert patched.status_code == 200, patched.json()

            ctx_resp = client.get(f"{base}/all-questions")
            assert ctx_resp.status_code == 200, ctx_resp.json()
            ctx = ctx_resp.json()
            for diff_row in ctx["difficulties"]:
                assert diff_row["questions_per_page"] == 15
                assert diff_row["question_format"] == "pages"

            val_file = SimpleUploadedFile(filename, payload_bytes, content_type="application/json")
            val_resp = client.post(
                f"{base}/all-questions/validate",
                {
                    "payload_file": val_file,
                    "sheet_question_count": "30",
                    "excluded_start_pages": "1",
                    "excluded_end_pages": "1",
                },
                format="multipart",
            )
            assert val_resp.status_code == 200, f"{title} validate failed: {val_resp.json()}"
            val_json = val_resp.json()
            assert val_json["valid"] is True, val_json
            assert val_json["summary"]["total_received"] == expected_received
            assert val_json["summary"]["total_expected"] == expected_capacity
            assert all(row["ok"] for row in val_json["summary"]["difficulties"])
            assert all(
                part["ok"] and part["expected"] == 15
                for row in val_json["summary"]["difficulties"]
                for part in row["parts"]
            )
            assert val_json["summary"]["sheet_questions"] == {
                "expected": 30,
                "received": 30,
                "ok": True,
            }
            assert ActiveStudyQuestionContent.objects.filter(sheet=sheet).count() == 0

            put_file = SimpleUploadedFile(filename, payload_bytes, content_type="application/json")
            put_resp = client.put(
                f"{base}/all-questions",
                {
                    "payload_file": put_file,
                    "sheet_question_count": "30",
                    "excluded_start_pages": "1",
                    "excluded_end_pages": "1",
                    "settings_revision": str(ctx["settings_revision"]),
                    "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
                    "publish_sheet_questions": "true",
                },
                format="multipart",
            )
            assert put_resp.status_code == 200, f"{title} PUT failed: {put_resp.json()}"

            bank_rows = ActiveStudyQuestionContent.objects.filter(sheet=sheet)
            assert bank_rows.count() == 3
            for bank in bank_rows:
                selected = select_page_questions(bank.payload, 2, total_pages - 1, 5)
                assert len(selected) == 5

            pub_normal = Question.objects.filter(
                current_version__source_learning_object=sheet,
                workflow_status=Question.WorkflowStatus.PUBLISHED,
            ).count()
            assert pub_normal == 30, f"Expected 30 published normal questions, got {pub_normal}"
            settings = ActiveStudySettings.objects.get(sheet=sheet, edition="university")
            assert (settings.excluded_start_pages, settings.excluded_end_pages) == (1, 1)

            stale_file = SimpleUploadedFile(filename, payload_bytes, content_type="application/json")
            stale_resp = client.put(
                f"{base}/all-questions",
                {
                    "payload_file": stale_file,
                    "sheet_question_count": "30",
                    "excluded_start_pages": "1",
                    "excluded_end_pages": "1",
                    "settings_revision": str(ctx["settings_revision"]),
                    "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
                    "publish_sheet_questions": "true",
                },
                format="multipart",
            )
            assert stale_resp.status_code == 409, f"Expected 409 conflict, got {stale_resp.status_code}"

            print(
                f"OK [{connection.vendor}] {title}: validate=200 (valid=True, received={expected_received}, "
                f"backend_max_at_15={expected_capacity}), put=200 (3 active_study banks, {pub_normal} published normal Qs), stale_lock=409"
            )

        # Round-trip & conflict verification of pre-deploy snapshot + atomic rollback
        sys.path.insert(0, str(HERE))
        from predeploy_check_and_backup_physiology import (
            collect_postimport_manifest,
            collect_predeploy_snapshot,
        )
        from rollback_physiology_import import RollbackConflictError, rollback_from_snapshot
        from apps.focus.models import ActiveStudyRun
        from apps.questions.models import QuestionImportBatch, QuestionOption, QuestionVersion
        from apps.questions.tests.helpers import published_question

        rb_sheet = create_sheet(
            actor=admin,
            subject=subject,
            managed_file=create_managed_file(
                owner=admin, upload=make_pdf(5, "Rollback Check.pdf"), kind="pdf"
            ),
            title="Rollback Check",
            summary="",
            position=99,
            publish=True,
            notify_students=False,
            allow_download=False,
        )
        manual_q = published_question(actor=admin, node=subject, prompt="Manual physiology stem")
        manual_q.current_version.source_learning_object = rb_sheet
        manual_q.current_version.save(update_fields=("source_learning_object",))

        rb_payload_bytes = (OUT_DIR / "02_cell_junction_4e76d4c0_all_questions.json").read_bytes()
        rb_base = f"/api/v1/operations/admin/content/sheets/{rb_sheet.id}"

        # Case A: pre-import snapshot on fresh sheet + post-import manifest + rollback by import_batch_id
        snap_a = collect_predeploy_snapshot(
            sheet_specs=[("Rollback Check", str(rb_sheet.id))],
            archived_intro_id=None,
        )
        assert snap_a["snapshot"]["target_sheets"][0]["existing_questions_summary"]["untouched_other_questions_count"] == 1
        assert client.patch(
            f"{rb_base}/active-study",
            {"expected_revision": 0, "enabled": True, "excluded_start_pages": 1, "excluded_end_pages": 1},
            format="json",
        ).status_code == 200
        put_a = client.put(
            f"{rb_base}/all-questions",
            {
                "payload_file": SimpleUploadedFile("rb.json", rb_payload_bytes, content_type="application/json"),
                "sheet_question_count": "30",
                "excluded_start_pages": "1",
                "excluded_end_pages": "1",
                "settings_revision": "1",
                "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
                "publish_sheet_questions": "true",
            },
            format="multipart",
        )
        assert put_a.status_code == 200, put_a.json()
        batch_a_id = put_a.json()["sheet_question_batch_id"]
        manifest_a = collect_postimport_manifest(snap_a)
        assert manifest_a["manifest"]["sheets"][str(rb_sheet.id)]["sheet_question_batch_id"] == batch_a_id

        # Dry-run rollback must not alter DB
        dry_res = rollback_from_snapshot(snap_a, apply=False, post_import_manifest=manifest_a)
        assert dry_res["applied"] is False
        assert dry_res["actions"][0]["target_import_batch_id"] == batch_a_id
        assert ActiveStudyQuestionContent.objects.filter(sheet=rb_sheet).count() == 3

        # Apply rollback Case A -> retires batch_a ONLY, marks batch UNDONE, preserves manual_q
        apply_a = rollback_from_snapshot(snap_a, apply=True, post_import_manifest=manifest_a)
        assert apply_a["applied"] is True
        assert ActiveStudyQuestionContent.objects.filter(sheet=rb_sheet).count() == 0
        assert ActiveStudySettings.objects.filter(sheet=rb_sheet).count() == 0
        assert QuestionImportBatch.objects.get(id=batch_a_id).status == QuestionImportBatch.Status.UNDONE
        assert Question.objects.filter(
            current_version__source_learning_object=rb_sheet,
            workflow_status=Question.WorkflowStatus.PUBLISHED,
        ).count() == 1
        manual_q.refresh_from_db()
        assert manual_q.workflow_status == Question.WorkflowStatus.PUBLISHED

        # Cannot roll back an already-undone batch a second time
        try:
            rollback_from_snapshot(snap_a, apply=False, target_batch_ids={str(rb_sheet.id): batch_a_id})
            raise AssertionError("Expected RollbackConflictError for already-undone batch")
        except RollbackConflictError:
            pass

        # Case B: seed v1 -> snapshot -> overwrite v2 AND simulate hard deletions of old bank, settings, and Question
        put_b1 = client.put(
            f"{rb_base}/all-questions",
            {
                "payload_file": SimpleUploadedFile("rb1.json", rb_payload_bytes, content_type="application/json"),
                "sheet_question_count": "30",
                "excluded_start_pages": "1",
                "excluded_end_pages": "1",
                "settings_revision": "0",
                "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
                "publish_sheet_questions": "true",
            },
            format="multipart",
        )
        assert put_b1.status_code == 200
        batch_b1_id = put_b1.json()["sheet_question_batch_id"]
        v1_easy_bank = ActiveStudyQuestionContent.objects.get(sheet=rb_sheet, difficulty="easy")
        v1_bank_rev = v1_easy_bank.revision
        v1_easy_payload_copy = json.loads(json.dumps(v1_easy_bank.payload))

        snap_b = collect_predeploy_snapshot(
            sheet_specs=[("Rollback Check", str(rb_sheet.id))],
            archived_intro_id=None,
        )
        assert snap_b["snapshot"]["target_sheets"][0]["existing_questions_summary"]["will_be_archived_all_questions_count"] == 30

        ctx_b = client.get(f"{rb_base}/all-questions").json()
        put_b2 = client.put(
            f"{rb_base}/all-questions",
            {
                "payload_file": SimpleUploadedFile("rb2.json", rb_payload_bytes, content_type="application/json"),
                "sheet_question_count": "30",
                "excluded_start_pages": "1",
                "excluded_end_pages": "1",
                "settings_revision": str(ctx_b["settings_revision"]),
                "expected_revisions": json.dumps(snap_b["snapshot"]["target_sheets"][0]["expected_revisions"]),
                "publish_sheet_questions": "true",
            },
            format="multipart",
        )
        assert put_b2.status_code == 200
        batch_b2_id = put_b2.json()["sheet_question_batch_id"]

        # Simulate destructive deletion of old settings, old bank, and one backed-up v1 Question/Version/Options
        ActiveStudySettings.objects.filter(sheet=rb_sheet).delete()
        ActiveStudyQuestionContent.objects.filter(sheet=rb_sheet, difficulty="easy").delete()
        doomed_q = Question.objects.filter(import_batch_id=batch_b1_id).order_by("id").first()
        assert doomed_q is not None
        doomed_q_id = doomed_q.id
        doomed_prompt = doomed_q.current_version.prompt
        doomed_opt_count = doomed_q.current_version.options.count()
        doomed_q.current_version = None
        doomed_q.published_version = None
        doomed_q.save(update_fields=("current_version", "published_version"))
        QuestionOption.objects.filter(version__question=doomed_q).delete()
        QuestionVersion.objects.filter(question=doomed_q).delete()
        doomed_q.delete()
        assert not Question.objects.filter(id=doomed_q_id).exists()

        apply_b = rollback_from_snapshot(snap_b, apply=True, target_batch_ids={str(rb_sheet.id): batch_b2_id})
        act_b = apply_b["actions"][0]
        assert act_b["retired_newly_imported_questions"] == 30
        assert act_b["restored_previously_archived_questions"] == 29
        assert act_b["recreated_deleted_questions"] == 1
        assert "easy" in act_b["recreated_deleted_banks"]
        assert any(op.startswith("recreate:university:") for op in act_b["settings_ops"])

        restored_easy = ActiveStudyQuestionContent.objects.get(sheet=rb_sheet, difficulty="easy")
        assert restored_easy.revision == v1_bank_rev
        assert restored_easy.payload == v1_easy_payload_copy
        assert ActiveStudySettings.objects.get(sheet=rb_sheet, edition="university").excluded_start_pages == 1
        recreated_q = Question.objects.get(id=doomed_q_id)
        assert recreated_q.workflow_status == Question.WorkflowStatus.PUBLISHED
        assert recreated_q.current_version.prompt == doomed_prompt
        assert recreated_q.current_version.options.count() == doomed_opt_count
        assert Question.objects.filter(
            current_version__source_learning_object=rb_sheet,
            workflow_status=Question.WorkflowStatus.PUBLISHED,
        ).count() == 31

        # Case C: Concurrent / post-import modification & failure guards (all must raise RollbackConflictError & keep DB untouched)
        snap_c = collect_predeploy_snapshot(
            sheet_specs=[("Rollback Check", str(rb_sheet.id))],
            archived_intro_id=None,
        )
        ctx_c = client.get(f"{rb_base}/all-questions").json()
        put_c1 = client.put(
            f"{rb_base}/all-questions",
            {
                "payload_file": SimpleUploadedFile("rc1.json", rb_payload_bytes, content_type="application/json"),
                "sheet_question_count": "30",
                "excluded_start_pages": "1",
                "excluded_end_pages": "1",
                "settings_revision": str(ctx_c["settings_revision"]),
                "expected_revisions": json.dumps(snap_c["snapshot"]["target_sheets"][0]["expected_revisions"]),
                "publish_sheet_questions": "true",
            },
            format="multipart",
        )
        assert put_c1.status_code == 200
        batch_c1_id = put_c1.json()["sheet_question_batch_id"]
        manifest_c1 = collect_postimport_manifest(snap_c)

        # C1: Concurrent/post-import ActiveStudySettings PATCH -> RollbackConflictError (with & without manifest)
        cur_set_rev = ActiveStudySettings.objects.get(sheet=rb_sheet, edition="university").revision
        assert client.patch(
            f"{rb_base}/active-study",
            {"expected_revision": cur_set_rev, "enabled": False},
            format="json",
        ).status_code == 200
        for kw in ({"post_import_manifest": manifest_c1}, {}):
            try:
                rollback_from_snapshot(snap_c, apply=True, **kw)
                raise AssertionError("Expected RollbackConflictError on post-import settings edit")
            except RollbackConflictError:
                pass
        # Revert test tweak via ORM revision reset? Better: use fresh sheet Case D for remaining failure tests cleanly!

        # Case D: Fresh sheet isolated failure & PostgreSQL concurrent edit checks
        fail_sheet = create_sheet(
            actor=admin,
            subject=subject,
            managed_file=create_managed_file(
                owner=admin, upload=make_pdf(5, "Failure Guards.pdf"), kind="pdf"
            ),
            title="Failure Guards",
            summary="",
            position=100,
            publish=True,
            notify_students=False,
            allow_download=False,
        )
        fail_base = f"/api/v1/operations/admin/content/sheets/{fail_sheet.id}"
        snap_d = collect_predeploy_snapshot(
            sheet_specs=[("Failure Guards", str(fail_sheet.id))],
            archived_intro_id=None,
        )
        put_d1 = client.put(
            f"{fail_base}/all-questions",
            {
                "payload_file": SimpleUploadedFile("d1.json", rb_payload_bytes, content_type="application/json"),
                "sheet_question_count": "30",
                "excluded_start_pages": "1",
                "excluded_end_pages": "1",
                "settings_revision": "0",
                "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
                "publish_sheet_questions": "true",
            },
            format="multipart",
        )
        assert put_d1.status_code == 200
        batch_d1_id = put_d1.json()["sheet_question_batch_id"]
        manifest_d1 = collect_postimport_manifest(snap_d)

        # D1: Post-import bank edit (both manifest & non-manifest)
        easy_d = ActiveStudyQuestionContent.objects.get(sheet=fail_sheet, difficulty="easy")
        easy_d.revision += 1
        easy_d.save(update_fields=("revision", "updated_at"))
        for kw in ({"post_import_manifest": manifest_d1}, {}):
            try:
                rollback_from_snapshot(snap_d, apply=True, **kw)
                raise AssertionError("Expected RollbackConflictError on bank edit")
            except RollbackConflictError:
                pass
        easy_d.revision -= 1
        easy_d.save(update_fields=("revision",))

        # D2: Post-import student ActiveStudyRun activity -> RollbackConflictError
        ActiveStudyRun.objects.create(
            user=admin,
            sheet=fail_sheet,
            material_slug="phys",
            sheet_slug="failure-guards",
            difficulty="easy",
            edition="university",
            status="active",
            page_count=5,
            plan_signature={"mode": "pages"},
        )
        try:
            rollback_from_snapshot(snap_d, apply=True, post_import_manifest=manifest_d1)
            raise AssertionError("Expected RollbackConflictError on post-import student ActiveStudyRun")
        except RollbackConflictError:
            pass
        ActiveStudyRun.objects.filter(sheet=fail_sheet).delete()

        # D3: Post-import edit to an imported Question -> RollbackConflictError
        target_q = Question.objects.filter(import_batch_id=batch_d1_id).first()
        orig_rev = target_q.revision
        target_q.revision += 1
        target_q.save(update_fields=("revision",))
        try:
            rollback_from_snapshot(snap_d, apply=True, post_import_manifest=manifest_d1)
            raise AssertionError("Expected RollbackConflictError on edited batch question")
        except RollbackConflictError:
            pass
        target_q.revision = orig_rev
        target_q.save(update_fields=("revision",))

        # D4: Second PUT /all-questions batch -> RollbackConflictError (multi-batch ambiguity & target_batch_id mismatch)
        ctx_d2 = client.get(f"{fail_base}/all-questions").json()
        put_d2 = client.put(
            f"{fail_base}/all-questions",
            {
                "payload_file": SimpleUploadedFile("d2.json", rb_payload_bytes, content_type="application/json"),
                "sheet_question_count": "30",
                "excluded_start_pages": "1",
                "excluded_end_pages": "1",
                "settings_revision": str(ctx_d2["settings_revision"]),
                "expected_revisions": json.dumps({"easy": 1, "medium": 1, "hard": 1}),
                "publish_sheet_questions": "true",
            },
            format="multipart",
        )
        assert put_d2.status_code == 200
        try:
            rollback_from_snapshot(snap_d, apply=True, target_batch_ids={str(fail_sheet.id): batch_d1_id})
            raise AssertionError("Expected RollbackConflictError when 2nd batch exists")
        except RollbackConflictError:
            pass
        # Verify rollback aborted atomically and batch_d2 remains PUBLISHED
        assert Question.objects.filter(
            import_batch_id=put_d2.json()["sheet_question_batch_id"],
            workflow_status=Question.WorkflowStatus.PUBLISHED,
        ).count() == 30

        # D5: Multi-connection PostgreSQL concurrent modification check
        if connection.vendor == "postgresql":
            import psycopg
            from django.db import connections

            pg_cfg = connections["default"].settings_dict
            pg_sheet = create_sheet(
                actor=admin,
                subject=subject,
                managed_file=create_managed_file(
                    owner=admin, upload=make_pdf(5, "PG Concurrency.pdf"), kind="pdf"
                ),
                title="PG Concurrency",
                summary="",
                position=101,
                publish=True,
                notify_students=False,
                allow_download=False,
            )
            pg_base = f"/api/v1/operations/admin/content/sheets/{pg_sheet.id}"
            snap_pg = collect_predeploy_snapshot(
                sheet_specs=[("PG Concurrency", str(pg_sheet.id))],
                archived_intro_id=None,
            )
            put_pg = client.put(
                f"{pg_base}/all-questions",
                {
                    "payload_file": SimpleUploadedFile("pg.json", rb_payload_bytes, content_type="application/json"),
                    "sheet_question_count": "30",
                    "excluded_start_pages": "1",
                    "excluded_end_pages": "1",
                    "settings_revision": "0",
                    "expected_revisions": json.dumps({"easy": 0, "medium": 0, "hard": 0}),
                    "publish_sheet_questions": "true",
                },
                format="multipart",
            )
            assert put_pg.status_code == 200
            manifest_pg = collect_postimport_manifest(snap_pg)
            with psycopg.connect(
                dbname=pg_cfg["NAME"],
                user=pg_cfg["USER"],
                password=pg_cfg["PASSWORD"],
                host=pg_cfg["HOST"],
                port=pg_cfg["PORT"],
            ) as conn2:
                conn2.execute(
                    "UPDATE content_activestudyquestioncontent SET revision = revision + 1 "
                    "WHERE sheet_id = %s AND difficulty = 'medium'",
                    (str(pg_sheet.id),),
                )
                conn2.commit()
            try:
                rollback_from_snapshot(snap_pg, apply=True, post_import_manifest=manifest_pg)
                raise AssertionError("Expected RollbackConflictError after concurrent PG connection commit")
            except RollbackConflictError:
                pass

        print(f"OK [{connection.vendor}] predeploy snapshot + lossless recreate + batch_id/conflict guards verified")
        return 0
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
