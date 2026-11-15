#!/usr/bin/env python3
"""Unit tests for Physiology prompt generation, validation, and extraction script safety."""

from __future__ import annotations

import ast
import sys
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

    def test_production_extractor_is_strictly_read_only_and_valid_python(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
