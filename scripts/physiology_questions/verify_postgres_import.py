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
        return 0
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
