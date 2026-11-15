#!/usr/bin/env python3
"""Unit tests for Physiology prompt generation, validation, and extraction script safety."""

from __future__ import annotations

import ast
import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from build_physiology_prompt import (  # noqa: E402
    PHYSIOLOGY_EXAM_STYLE,
    build_context,
    build_prompt,
)
from safe_extract_tar_stream import (  # noqa: E402
    safe_unpack_and_verify,
    validate_dest_dir,
)
from validate_physiology_questions import validate_and_audit  # noqa: E402


def _make_mcq(idx: int, letter: str, *, meta_d: bool = False) -> dict[str, object]:
    opts = {
        "A": f"Synthetic structural term A{idx}",
        "B": f"Synthetic structural term B{idx}",
        "C": f"Synthetic structural term C{idx}",
        "D": "None of the above" if meta_d else f"Synthetic structural term D{idx}",
    }
    return {
        "type": "mcq",
        "question": f"Synthetic fixture stem {idx} has KEYWORD:",
        "options": opts,
        "correct_answer": letter,
        "explanation": f"Synthetic rationale {idx}.",
    }


def _make_tf(idx: int, value: bool) -> dict[str, object]:
    return {
        "type": "true_false",
        "question": f"Synthetic declarative statement {idx} holds.",
        "correct_answer": value,
        "explanation": f"Synthetic T/F rationale {idx}.",
    }


def _make_bank(offset: int, count: int) -> list[dict[str, object]]:
    letters = ["A", "B", "C", "D"]
    out = []
    for i in range(count):
        uid = offset + i
        if i % 5 == 4:
            out.append(_make_tf(uid, (i // 5) % 2 == 0))
        else:
            letter = letters[i % 4]
            out.append(_make_mcq(uid, letter, meta_d=(i % 4 == 0 and letter != "D")))
    return out


def _build_tar(entries: list[tuple[str, bytes]]) -> io.BytesIO:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for name, raw in entries:
            ti = tarfile.TarInfo(name=name)
            ti.size = len(raw)
            tf.addfile(ti, io.BytesIO(raw))
    buf.seek(0)
    return buf


class PhysiologyToolingTests(unittest.TestCase):
    def test_exam_style_length_within_admin_cap(self) -> None:
        self.assertLessEqual(len(PHYSIOLOGY_EXAM_STYLE), 6000)

    def test_introduction_30p_plan_parts_and_pages(self) -> None:
        parts_ctx = build_context(
            total_pdf_pages=30, excluded_start_pages=1, excluded_end_pages=0, mode="parts"
        )
        self.assertEqual(parts_ctx["effective_start_page"], 2)
        self.assertEqual(parts_ctx["effective_end_page"], 30)
        diffs = {d["difficulty"]: d for d in parts_ctx["difficulties"]}
        self.assertEqual(diffs["easy"]["number_of_parts"], 4)
        self.assertEqual(diffs["medium"]["number_of_parts"], 5)
        self.assertEqual(diffs["hard"]["number_of_parts"], 7)
        self.assertEqual(diffs["easy"]["page_ranges"][0], {"part": 1, "start_page": 2, "end_page": 7})
        prompt_parts = build_prompt(parts_ctx, normal_count=58)
        self.assertIn("Total: 448 questions", prompt_parts)
        self.assertIn("EXAM-STYLE REFERENCE", prompt_parts)

        pages_ctx = build_context(
            total_pdf_pages=30, excluded_start_pages=1, excluded_end_pages=0, mode="pages"
        )
        self.assertEqual(len(pages_ctx["difficulties"][0]["page_numbers"]), 29)
        prompt_pages = build_prompt(pages_ctx, normal_count=58)
        self.assertIn("Do not use parts.", prompt_pages)
        self.assertIn("Maximum total questions: 1513", prompt_pages)

    def test_valid_parts_payload_passes_backend_and_style_audit(self) -> None:
        ctx = build_context(
            total_pdf_pages=10,
            excluded_start_pages=0,
            excluded_end_pages=0,
            mode="parts",
            questions_per_checkpoint=10,
            final_exam_questions=10,
        )
        offset = 1
        active = {}
        for row in ctx["difficulties"]:
            parts = []
            for r in row["page_ranges"]:
                pages_str = (
                    str(r["start_page"])
                    if r["start_page"] == r["end_page"]
                    else f"{r['start_page']}-{r['end_page']}"
                )
                parts.append(
                    {"part": r["part"], "pages": pages_str, "questions": _make_bank(offset, 10)}
                )
                offset += 100
            active[row["difficulty"]] = {
                "parts": parts,
                "final_exam": {"questions": _make_bank(offset, 10)},
            }
            offset += 100
        payload = {
            "active_study": active,
            "sheet_questions": {"questions": _make_bank(offset, 10)},
        }
        report = validate_and_audit(
            payload,
            total_pdf_pages=10,
            mode="parts",
            normal_count=10,
            questions_per_checkpoint=10,
            final_exam_questions=10,
            strict_style=True,
        )
        self.assertTrue(report.ok, msg=f"Errors: {report}")
        self.assertEqual(report.stats["mcq_colon_stem_rate"], 1.0)
        self.assertEqual(report.stats["meta_d_correct_rate"], 0.0)

    def test_valid_pages_payload_and_error_detection(self) -> None:
        payload = {
            "active_study": {
                diff: {
                    "pages": [{"page": 1, "questions": _make_bank(1000 * (idx + 1), 5)}],
                    "final_exam": {"questions": _make_bank(5000 * (idx + 1), 10)},
                }
                for idx, diff in enumerate(("easy", "medium", "hard"))
            },
            "sheet_questions": {"questions": _make_bank(9000, 10)},
        }
        report = validate_and_audit(
            payload,
            total_pdf_pages=1,
            mode="pages",
            normal_count=10,
            questions_per_checkpoint=15,
            final_exam_questions=10,
            strict_style=True,
        )
        self.assertTrue(report.ok, msg=f"Errors: {report}")

        bad_complete = {
            **payload,
            "sheet_questions": {
                "questions": [
                    *payload["sheet_questions"]["questions"][:-1],
                    {
                        "type": "complete",
                        "question": "Invalid complete question:",
                        "correct_answer": "ANSWER",
                        "explanation": "Should fail.",
                    },
                ]
            },
        }
        r_complete = validate_and_audit(
            bad_complete,
            total_pdf_pages=1,
            mode="pages",
            normal_count=10,
            questions_per_checkpoint=15,
            final_exam_questions=10,
        )
        self.assertFalse(r_complete.ok)
        self.assertTrue(r_complete.schema_errors)

        dup_q = dict(payload["active_study"]["easy"]["pages"][0]["questions"][0])
        dup_q["options"] = {**dup_q["options"], "A": "None of the above"}
        bad_style = {
            **payload,
            "sheet_questions": {
                "questions": [
                    dup_q,
                    *payload["sheet_questions"]["questions"][1:],
                ]
            },
        }
        for i in range(3):
            bad_style["sheet_questions"]["questions"][i] = {
                **bad_style["sheet_questions"]["questions"][i],
                "type": "mcq",
                "options": {
                    "A": "None of the above" if i == 0 else f"OptA {i}",
                    "B": f"OptB {i}",
                    "C": f"OptC {i}",
                    "D": f"OptD {i}",
                },
                "correct_answer": "A",
            }
        r_style = validate_and_audit(
            bad_style,
            total_pdf_pages=1,
            mode="pages",
            normal_count=10,
            questions_per_checkpoint=15,
            final_exam_questions=10,
            strict_style=True,
        )
        self.assertFalse(r_style.ok)
        self.assertTrue(r_style.cross_duplicates)
        self.assertGreaterEqual(len(r_style.style_errors), 2)

    def test_production_extractor_is_strictly_read_only_and_compatible_with_models(self) -> None:
        src = (HERE / "inspect_and_export_physiology.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        forbidden_calls = {"save", "create", "update", "delete", "bulk_create", "bulk_update"}
        found = [
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in forbidden_calls
            and not (
                node.func.attr == "update"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "digest"
            )
        ]
        self.assertEqual(found, [], msg=f"Unexpected DB write-like calls: {found}")
        self.assertNotIn("SECRET", src)
        self.assertNotIn("PASSWORD", src)
        self.assertNotIn("cohort.slug", src)

        # Verify actual Django model fields in this repo AND production lockin1 (main)
        from apps.content.models import (
            ActiveStudyQuestionContent,
            ActiveStudySettings,
            CatalogDocument,
            CatalogSubject,
            LearningObject,
            LearningObjectAsset,
            LearningObjectVersion,
        )
        from apps.education.models import AcademicProgram, EducationNode, StudentCohort
        from apps.files.models import ManagedFile
        from apps.questions.models import Question, QuestionVersion

        cohort_fields = {f.name for f in StudentCohort._meta.get_fields()}
        self.assertIn("code", cohort_fields)
        self.assertIn("name_en", cohort_fields)
        self.assertIn("program", cohort_fields)
        self.assertNotIn("slug", cohort_fields)

        program_fields = {f.name for f in AcademicProgram._meta.get_fields()}
        self.assertTrue({"code", "name_en"}.issubset(program_fields))

        node_fields = {f.name for f in EducationNode._meta.get_fields()}
        self.assertTrue({"path", "title", "slug"}.issubset(node_fields))

        subj_fields = {f.name for f in CatalogSubject._meta.get_fields()}
        self.assertTrue({"id", "title", "slug", "material_slug", "is_active", "cohort", "source_node"}.issubset(subj_fields))

        lo_fields = {f.name for f in LearningObject._meta.get_fields()}
        self.assertTrue({"id", "workflow_status", "position", "current_version"}.issubset(lo_fields))
        self.assertTrue({"academic_node", "content_type", "title"}.issubset({f.name for f in LearningObjectVersion._meta.get_fields()}))
        self.assertTrue({"version", "managed_file", "role", "position"}.issubset({f.name for f in LearningObjectAsset._meta.get_fields()}))
        self.assertTrue({"managed_file", "is_active", "sheet_slug"}.issubset({f.name for f in CatalogDocument._meta.get_fields()}))
        self.assertTrue({"sheet", "edition", "enabled", "total_pdf_pages", "excluded_start_pages", "excluded_end_pages", "revision", "updated_at"}.issubset({f.name for f in ActiveStudySettings._meta.get_fields()}))
        self.assertTrue({"sheet", "difficulty", "checkpoint_question_count", "final_exam_question_count", "revision", "updated_at"}.issubset({f.name for f in ActiveStudyQuestionContent._meta.get_fields()}))
        self.assertTrue({"source_learning_object", "question", "question_type"}.issubset({f.name for f in QuestionVersion._meta.get_fields()}))
        self.assertTrue({"current_version", "workflow_status"}.issubset({f.name for f in Question._meta.get_fields()}))
        self.assertTrue({"id", "blob", "original_name", "checksum_sha256", "pdf_page_count"}.issubset({f.name for f in ManagedFile._meta.get_fields()}))

    def test_safe_tar_extractor_atomicity_no_overwrite_and_error_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "production_pdfs"
            base.mkdir()

            # Outside allowed base must raise
            with self.assertRaises(ValueError):
                validate_dest_dir(Path(tmp) / "outside", allowed_base=base)
            with self.assertRaises(ValueError):
                validate_dest_dir(base, allowed_base=base)

            # Empty stream must fail AND must NOT create destination directory or leftovers
            empty_dest = base / "fail_empty"
            with self.assertRaises(ValueError):
                safe_unpack_and_verify(io.BytesIO(b""), empty_dest, allowed_base=base)
            self.assertFalse(empty_dest.exists())
            self.assertEqual(list(base.iterdir()), [])

            # Partial stream missing live_physiology_report.json must fail cleanly with no leftovers
            pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"
            pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()
            manifest_bytes = json.dumps(
                {"files_count": 1, "files": [{"archive_name": "sheet1.pdf", "checksum": pdf_sha}]}
            ).encode("utf-8")
            partial_dest = base / "fail_missing_report"
            with self.assertRaises(FileNotFoundError):
                safe_unpack_and_verify(
                    _build_tar([("sheet1.pdf", pdf_bytes), ("manifest.json", manifest_bytes)]),
                    partial_dest,
                    allowed_base=base,
                )
            self.assertFalse(partial_dest.exists())
            self.assertEqual(list(base.iterdir()), [])

            # Path traversal tar member must raise and leave no destination dir
            trav_dest = base / "fail_traversal"
            with self.assertRaises(ValueError):
                safe_unpack_and_verify(
                    _build_tar([("../escape.pdf", pdf_bytes)]),
                    trav_dest,
                    allowed_base=base,
                )
            self.assertFalse(trav_dest.exists())

            # Corrupted SHA-256 must raise and leave no destination dir
            mismatch_manifest = json.dumps(
                {"files_count": 1, "files": [{"archive_name": "sheet1.pdf", "checksum": "0" * 64}]}
            ).encode("utf-8")
            bad_sha_dest = base / "fail_bad_sha"
            with self.assertRaises(ValueError):
                safe_unpack_and_verify(
                    _build_tar(
                        [
                            ("sheet1.pdf", pdf_bytes),
                            ("manifest.json", mismatch_manifest),
                            ("live_physiology_report.json", b"{}"),
                        ]
                    ),
                    bad_sha_dest,
                    allowed_base=base,
                )
            self.assertFalse(bad_sha_dest.exists())
            self.assertEqual(list(base.iterdir()), [])

            # Valid extraction succeeds cleanly
            good_dest = base / "physiology_year1"
            verified = safe_unpack_and_verify(
                _build_tar(
                    [
                        ("sheet1.pdf", pdf_bytes),
                        ("manifest.json", manifest_bytes),
                        ("live_physiology_report.json", b'{"dentistry_year1_subjects":[]}'),
                    ]
                ),
                good_dest,
                allowed_base=base,
            )
            self.assertEqual(len(verified), 1)
            self.assertEqual(verified[0]["sha256"], pdf_sha)
            self.assertTrue((good_dest / "sheet1.pdf").is_file())

            # Re-running into non-empty directory must refuse overwrite and preserve existing files
            (good_dest / "sheet1.pdf").write_bytes(b"existing-sentinel")
            with self.assertRaises(FileExistsError):
                safe_unpack_and_verify(
                    _build_tar(
                        [
                            ("sheet1.pdf", pdf_bytes),
                            ("manifest.json", manifest_bytes),
                            ("live_physiology_report.json", b"{}"),
                        ]
                    ),
                    good_dest,
                    allowed_base=base,
                )
            self.assertEqual((good_dest / "sheet1.pdf").read_bytes(), b"existing-sentinel")


class PredeployAndRollbackSafetyTests(unittest.TestCase):
    def test_predeploy_script_is_strictly_read_only_and_covers_target_sheets(self) -> None:
        from predeploy_check_and_backup_physiology import (
            ARCHIVED_INTRO_ID,
            TARGET_SHEETS,
            _canonical_sha256,
        )

        self.assertEqual(
            [sid for _, sid in TARGET_SHEETS],
            [
                "35923940-c141-44f6-bc49-acd4869577c0",
                "4e76d4c0-c3ee-4a69-a5b2-1d51479d1cc1",
                "b6b6f3e8-1ec1-4b4f-af41-131b8faaa758",
                "06c3f406-cc1f-400b-86ee-308a41dbc03d",
            ],
        )
        self.assertEqual(ARCHIVED_INTRO_ID, "766bc7a1-12df-4086-b3e4-1e0150809cd9")

        source = (HERE / "predeploy_check_and_backup_physiology.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        write_attrs = {"save", "create", "update", "delete", "bulk_create", "bulk_update", "get_or_create"}
        called_attrs = {
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        self.assertEqual(called_attrs & write_attrs, set())
        self.assertEqual(len(_canonical_sha256({"ok": True})), 64)

    def test_rollback_rejects_tampered_snapshot_sha256(self) -> None:
        from predeploy_check_and_backup_physiology import _canonical_sha256
        from rollback_physiology_import import verify_snapshot_envelope

        payload = {"generated_at_utc": "2026-11-15T13:00:00+00:00", "target_sheets": []}
        envelope = {"snapshot_sha256": _canonical_sha256(payload), "snapshot": payload}
        self.assertEqual(verify_snapshot_envelope(envelope), payload)

        tampered = {"snapshot_sha256": envelope["snapshot_sha256"], "snapshot": {"target_sheets": ["x"]}}
        with self.assertRaises(ValueError):
            verify_snapshot_envelope(tampered)

        source = (HERE / "rollback_physiology_import.py").read_text(encoding="utf-8")
        self.assertIn("transaction.atomic()", source)
        self.assertIn("default is dry-run", source)


if __name__ == "__main__":
    unittest.main()
