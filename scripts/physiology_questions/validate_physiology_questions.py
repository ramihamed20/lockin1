#!/usr/bin/env python3
"""Validate and style-audit a Lock-in All Questions JSON file for Physiology.

Runs the real backend validators from ``apps.content.all_questions`` (without
touching any database), checks global cross-bank deduplication, and audits
compliance with the adapted Dental Anatomy exam-style guide.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
import django  # noqa: E402

django.setup()

from apps.content.active_study import DIFFICULTIES, plan_payload  # noqa: E402
from apps.content.all_questions import (  # noqa: E402
    _validate_difficulty,
    _validate_sheet_questions,
)

META_OPTION_RE = re.compile(
    r"^(?:"
    r"none of the above|all of the above|"
    r"(?:both\s+)?[a-d]\s+(?:and|&)\s+[a-d]|"
    r"[a-d]\s*,\s*[a-d]\s*(?:,?\s*and\s*[a-d])?|"
    r"neither\s+[a-d]\s+nor\s+[a-d]"
    r")\.?$",
    re.IGNORECASE,
)


@dataclass
class AuditReport:
    schema_errors: list[dict[str, str]] = field(default_factory=list)
    cross_duplicates: list[dict[str, str]] = field(default_factory=list)
    style_warnings: list[str] = field(default_factory=list)
    style_errors: list[str] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.schema_errors and not self.cross_duplicates and not self.style_errors


def _normalize_stem(text: str) -> str:
    return " ".join(str(text).strip().split()).casefold()


def _iter_all_questions(payload: dict[str, Any]):
    active = payload.get("active_study") or {}
    for diff in ("easy", "medium", "hard"):
        block = active.get(diff)
        if not isinstance(block, dict):
            continue
        for container_key in ("parts", "pages"):
            items = block.get(container_key)
            if isinstance(items, list):
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    label = (
                        f"{diff}.page[{item.get('page')}]"
                        if container_key == "pages"
                        else f"{diff}.part[{item.get('part')}]"
                    )
                    for idx, q in enumerate(item.get("questions") or []):
                        yield f"{label}[{idx}]", q
        final_exam = block.get("final_exam")
        if isinstance(final_exam, dict):
            for idx, q in enumerate(final_exam.get("questions") or []):
                yield f"{diff}.final_exam[{idx}]", q
    sheet_q = payload.get("sheet_questions")
    if isinstance(sheet_q, dict):
        for idx, q in enumerate(sheet_q.get("questions") or []):
            yield f"sheet_questions[{idx}]", q


def validate_and_audit(
    payload: Any,
    *,
    total_pdf_pages: int,
    excluded_start_pages: int = 0,
    excluded_end_pages: int = 0,
    mode: str = "pages",
    normal_count: int = 58,
    questions_per_checkpoint: int = 15,
    final_exam_questions: int = 50,
    strict_style: bool = False,
) -> AuditReport:
    """Run backend validation + global dedup + Dental Anatomy style audit."""

    report = AuditReport()
    plan = plan_payload(
        total_pdf_pages=total_pdf_pages,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
        questions_per_checkpoint=questions_per_checkpoint,
        final_exam_questions=final_exam_questions,
        page_question_bank=(mode == "pages"),
    )

    errors: list[dict[str, str]] = []
    if not isinstance(payload, dict):
        errors.append(
            {
                "path": "payload",
                "message": "The JSON must be one object with active_study and sheet_questions.",
            }
        )
        report.schema_errors = errors
        return report

    for key in sorted(set(payload) - {"active_study", "sheet_questions"}):
        errors.append({"path": key, "message": "Unsupported root field."})

    active = payload.get("active_study")
    if not isinstance(active, dict):
        errors.append(
            {
                "path": "active_study",
                "message": "active_study must be an object with easy, medium and hard.",
            }
        )
        active = {}
    for key in sorted(set(active) - {item.key for item in DIFFICULTIES}):
        errors.append(
            {
                "path": f"active_study.{key}",
                "message": "Unsupported difficulty. Use easy, medium and hard.",
            }
        )

    for row in plan["difficulties"]:
        _validate_difficulty(active.get(str(row["difficulty"])), row=row, errors=errors)

    _validate_sheet_questions(
        payload.get("sheet_questions"), expected=normal_count, errors=errors
    )
    report.schema_errors = errors

    seen_stems: dict[str, str] = {}
    type_counts: Counter[str] = Counter()
    mcq_letter_counts: Counter[str] = Counter()
    mcq_letter_seq: list[tuple[str, str]] = []
    tf_counts: Counter[bool] = Counter()
    meta_d_total = 0
    meta_d_correct = 0
    meta_outside_d: list[str] = []
    mcq_colon_stems = 0
    mcq_total = 0

    for loc, q in _iter_all_questions(payload):
        if not isinstance(q, dict):
            continue
        stem = str(q.get("question") or "")
        norm = _normalize_stem(stem)
        if norm:
            if norm in seen_stems:
                report.cross_duplicates.append(
                    {"first": seen_stems[norm], "duplicate": loc, "question": stem}
                )
            else:
                seen_stems[norm] = loc

        q_type = q.get("type") or ("mcq" if "options" in q else "unknown")
        type_counts[str(q_type)] += 1

        if q_type == "mcq":
            mcq_total += 1
            if stem.rstrip().endswith(":"):
                mcq_colon_stems += 1
            ans = q.get("correct_answer")
            if isinstance(ans, str) and ans in ("A", "B", "C", "D"):
                mcq_letter_counts[ans] += 1
                mcq_letter_seq.append((loc, ans))
            opts = q.get("options")
            if isinstance(opts, dict):
                for key in ("A", "B", "C"):
                    val = str(opts.get(key) or "").strip()
                    if META_OPTION_RE.match(val):
                        meta_outside_d.append(f"{loc} option {key}={val!r}")
                d_val = str(opts.get("D") or "").strip()
                if META_OPTION_RE.match(d_val):
                    meta_d_total += 1
                    if ans == "D":
                        meta_d_correct += 1
        elif q_type == "true_false":
            ans = q.get("correct_answer")
            if isinstance(ans, bool):
                tf_counts[ans] += 1

    if meta_outside_d:
        msg = (
            f"Meta option(s) found outside option D ({len(meta_outside_d)}): "
            + ", ".join(meta_outside_d[:5])
        )
        (report.style_errors if strict_style else report.style_warnings).append(msg)

    run_len = 1
    bad_runs: list[str] = []
    prev_section = None
    prev_letter = None
    for loc, letter in mcq_letter_seq:
        section = loc.split("[")[0]
        if section == prev_section and letter == prev_letter:
            run_len += 1
            if run_len == 3:
                bad_runs.append(f"{loc} ({letter} x3+)")
        else:
            run_len = 1
        prev_section = section
        prev_letter = letter
    if bad_runs:
        msg = f"3+ consecutive identical MCQ letters: {', '.join(bad_runs[:5])}"
        (report.style_errors if strict_style else report.style_warnings).append(msg)

    if mcq_total >= 16:
        max_letter, max_count = max(mcq_letter_counts.items(), key=lambda kv: kv[1])
        max_share = max_count / mcq_total
        if max_share > 0.35:
            msg = (
                f"MCQ letter imbalance: {max_letter} is {max_share:.1%} "
                f"(target <= 31%, counts={dict(mcq_letter_counts)})."
            )
            (report.style_errors if strict_style else report.style_warnings).append(msg)

    tf_total = tf_counts[True] + tf_counts[False]
    if tf_total >= 10:
        true_share = tf_counts[True] / tf_total
        if not (0.35 <= true_share <= 0.65):
            msg = (
                f"True/False imbalance: true={tf_counts[True]}, false={tf_counts[False]} "
                f"({true_share:.1%} true; target ~50%)."
            )
            (report.style_errors if strict_style else report.style_warnings).append(msg)

    report.stats = {
        "total_questions": sum(type_counts.values()),
        "type_counts": dict(type_counts),
        "mcq_total": mcq_total,
        "mcq_colon_stem_rate": round(mcq_colon_stems / mcq_total, 3) if mcq_total else 0.0,
        "mcq_letters": {k: mcq_letter_counts.get(k, 0) for k in ("A", "B", "C", "D")},
        "tf_true": tf_counts[True],
        "tf_false": tf_counts[False],
        "meta_d_total": meta_d_total,
        "meta_d_correct": meta_d_correct,
        "meta_d_correct_rate": round(meta_d_correct / meta_d_total, 3) if meta_d_total else 0.0,
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json_file", type=Path)
    parser.add_argument("--total-pages", type=int, required=True)
    parser.add_argument("--excl-start", type=int, default=0)
    parser.add_argument("--excl-end", type=int, default=0)
    parser.add_argument("--mode", choices=("parts", "pages"), default="pages")
    parser.add_argument("--normal-count", type=int, default=58)
    parser.add_argument("--strict-style", action="store_true")
    args = parser.parse_args()

    payload = json.loads(args.json_file.read_text(encoding="utf-8"))
    report = validate_and_audit(
        payload,
        total_pdf_pages=args.total_pages,
        excluded_start_pages=args.excl_start,
        excluded_end_pages=args.excl_end,
        mode=args.mode,
        normal_count=args.normal_count,
        strict_style=args.strict_style,
    )
    print(
        json.dumps(
            {
                "ok": report.ok,
                "schema_errors": report.schema_errors,
                "cross_duplicates": report.cross_duplicates,
                "style_errors": report.style_errors,
                "style_warnings": report.style_warnings,
                "stats": report.stats,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
