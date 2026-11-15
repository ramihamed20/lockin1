#!/usr/bin/env python3
"""Build Lock-in All Questions prompts for 1st-Year Dentistry Physiology sheets.

Uses the repository's ``apps.content.active_study.plan_payload`` directly so
part counts, page ranges, and question caps always match Lock-in Admin.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from apps.content.active_study import plan_payload  # noqa: E402

DIFFICULTY_ORDER = ("easy", "medium", "hard")

DIFFICULTY_BEHAVIOUR = {
    "easy": "Focus on direct recall, recognition and basic understanding.",
    "medium": "Focus on understanding, interpretation and application.",
    "hard": (
        "Focus on deeper understanding, discrimination, integration and more "
        "challenging application, but never introduce information outside the sheet."
    ),
}

PHYSIOLOGY_EXAM_STYLE = """PHYSIOLOGY EXAM STYLE (Adapted from the supplied Dental Anatomy Past-Exam Style Guide for 1st-Year Dentistry):

1) QUESTION MIX & STRICT FORMAT COMPATIBILITY
- Generate ONLY "mcq" (~82%) and "true_false" (~18%). Never emit "complete", fill-in-the-blank, essay, or "why/explain" questions.
- Convert completion-style recall items (originally ~16% of past exams) into 4-option MCQs with short 1-6 word term/value options.
- Target per-bank mix: ~82% MCQ and ~18% True/False (keep T/F balanced roughly 50% true / 50% false).

2) STEM RULES (SHORT, DIRECT, NO CLINICAL VIGNETTES)
- Write short, direct English stems (typically 8-15 words). No long scenarios, no "according to the sheet", no image-dependent phrasing.
- End MCQ stems with a colon ":" instead of a question mark (e.g., "The PRIMARY intracellular cation is:").
- Capitalize key constraints and qualifiers in UPPERCASE: ONLY, NOT, EXCEPT, PRIMARY, MAIN, HIGHEST, LOWEST, INTRACELLULAR, EXTRACELLULAR, INCREASE, DECREASE, FIRST, LAST.
- Dominant stem patterns:
  * ~65%: Direct sentence completion / definition ("The X is:", "The process of X is called:", "The normal value of X is:")
  * ~17-20%: "Which of the following ..." / "Which statement is TRUE regarding ..."
  * ~15%: Superlatives/exclusives (HIGHEST, MAIN, ONLY, PRIMARY)
  * ~3%: Negative stems (EXCEPT / NOT) -- keep rare!
- Focus on high-yield definitions/terminology (~28%), numerical values/concentrations/thresholds (~25%), comparisons between compartments/mechanisms/ions (~25%), classification/counts (~10%), and physiological mechanisms/cause-effect (~12%, kept concise and strictly grounded in the sheet).

3) MCQ OPTIONS & DISTRACTORS (ALWAYS 4 OPTIONS A-D)
- All four options A-D must be short (1-6 words when possible; longer only for rare "Which statement is true" stems) and belong to the SAME physiological category:
  1. Opposite direction/compartment (increase vs decrease; depolarization vs hyperpolarization; ICF vs ECF).
  2. Sibling physiological entities (Na+/K+/Ca2+/Cl-; Golgi/ER/lysosome/mitochondria; alpha/beta/muscarinic/nicotinic).
  3. Confusable terms (osmolarity vs osmolality vs tonicity; facilitated diffusion vs active transport).
  4. Plausible adjacent numbers/units from the same physiological scale.
  5. Comparison pattern ("Higher than...", "Lower than...", "Equal to...", "None of the above") where A or B is usually correct.
  6. Order/relationship permutations (e.g., inside/outside gradients reversed).

4) META OPTIONS & ANSWER DISTRIBUTION
- Meta options ("None of the above", "A and B", "A and C", "B and C", rare "All of the above") MUST ONLY appear in option "D", never in A, B, or C.
- Include a meta option in D in ~25% of MCQs (mostly "None of the above" for comparison items or "A and B"/"B and C" for multi-property items; keep "All of the above" very rare).
- When D is a meta option, make D the correct answer only ~18-20% of the time (~80% of meta D options are distractors).
- Overall correct MCQ letter distribution target: ~27% A, ~31% B, ~22% C, ~20% D (balanced, no letter exceeding 31%, and NEVER repeat the same correct letter 3 times in a row).

5) TRUE/FALSE RULES
- Single declarative sentence ending with a period ".".
- Balance TRUE (~50%) and FALSE (~50%).
- Construct FALSE statements by changing ONE specific physiological detail from a true sheet fact (direction, ion/compartment, value, or adding an unwarranted qualifier like ONLY/ALL).
- Include a concise 1-sentence scientific explanation for every MCQ and True/False item."""

assert len(PHYSIOLOGY_EXAM_STYLE) <= 6000, "Exam-style reference exceeds Admin 6000-char limit"


def build_context(
    *,
    total_pdf_pages: int,
    excluded_start_pages: int = 0,
    excluded_end_pages: int = 0,
    mode: str = "pages",
    edition: str = "university",
    questions_per_checkpoint: int = 15,
    final_exam_questions: int = 50,
) -> dict[str, object]:
    """Build an ``allQuestionsPrompt.js``-compatible context via ``plan_payload``."""

    if mode not in ("parts", "pages"):
        raise ValueError(f"Unsupported mode {mode!r}; expected 'parts' or 'pages'.")
    page_question_bank = mode == "pages"
    plan = plan_payload(
        total_pdf_pages=total_pdf_pages,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
        questions_per_checkpoint=questions_per_checkpoint,
        final_exam_questions=final_exam_questions,
        page_question_bank=page_question_bank,
    )
    effective_start = excluded_start_pages + 1
    effective_end = total_pdf_pages - excluded_end_pages
    difficulties = []
    for row in plan["difficulties"]:
        page_ranges = row["page_ranges"]
        page_numbers = [
            page
            for r in page_ranges
            for page in range(r["start_page"], r["end_page"] + 1)
        ]
        difficulties.append(
            {
                **row,
                "label": row["difficulty"].capitalize(),
                "page_numbers": page_numbers,
            }
        )
    return {
        "edition": edition,
        "edition_label": "University Edition" if edition == "university" else "Lock-in Edition",
        "total_pdf_pages": total_pdf_pages,
        "effective_start_page": effective_start,
        "effective_end_page": effective_end,
        "excluded_start_pages": excluded_start_pages,
        "excluded_end_pages": excluded_end_pages,
        "difficulties": difficulties,
        "sheet_questions": {"max_count": 200},
    }


def _pages_text(start: int, end: int) -> str:
    return f"page {start}" if start == end else f"pages {start}–{end}"


def _totals(context: dict[str, object], normal_count: int) -> dict[str, object]:
    normal = min(200, max(0, int(normal_count)))
    diff_rows = []
    for row in context["difficulties"]:
        if row["question_format"] == "pages":
            part_q = len(row["page_numbers"]) * 15
        else:
            part_q = row["number_of_parts"] * row["questions_per_checkpoint"]
        final_q = row["final_exam_questions"]
        diff_rows.append(
            {
                "difficulty": row["difficulty"],
                "part_questions": part_q,
                "final_exam": final_q,
                "total": part_q + final_q,
            }
        )
    return {
        "difficulties": diff_rows,
        "normal": normal,
        "total": sum(r["total"] for r in diff_rows) + normal,
    }


def build_prompt(
    context: dict[str, object],
    *,
    normal_count: int = 50,
    exam_style: str = PHYSIOLOGY_EXAM_STYLE,
) -> str:
    """Render the exact All Questions prompt (parts or pages mode)."""

    normal = min(200, max(0, int(normal_count)))
    instructions = exam_style.strip()[:6000]
    style_block = (
        f"\n\nEXAM-STYLE REFERENCE\n\n{instructions}\n\n"
        "Use this reference for wording, question styles and distractors only. "
        "The supplied sheet remains the only factual source. Keep all required JSON "
        "keys and page assignments. Final Exam and Normal Questions counts are exact; "
        "page-based counts are caps.\n"
        if instructions
        else ""
    )

    diffs = context["difficulties"]
    eff_start = context["effective_start_page"]
    eff_end = context["effective_end_page"]
    totals = _totals(context, normal)

    if all(row["question_format"] == "pages" for row in diffs):
        active = {
            row["difficulty"]: {
                "pages": [{"page": page, "questions": []} for page in row["page_numbers"]],
                "final_exam": {"questions": []},
            }
            for row in diffs
        }
        diff_lines = "\n".join(
            f"{row['label']}: {DIFFICULTY_BEHAVIOUR[row['difficulty']]} "
            f"Final exam: exactly {row['final_exam_questions']} separate questions "
            f"covering the entire eligible sheet."
            for row in diffs
        )
        skeleton_json = json.dumps(
            {"active_study": active, "sheet_questions": {"questions": []}}, indent=2
        )
        return (
            "Generate every question for one Lock-in sheet as ONE valid JSON object. "
            "No Markdown, commentary or extra fields.\n"
            f"Use only the supplied PDF, physical page numbers {eff_start}–{eff_end}; "
            "excluded pages must not be used. Wait for the sheet if missing.\n"
            "For EACH difficulty (easy, medium, hard), create up to 15 distinct questions "
            "for EACH eligible page (1–15 supported questions per page), grouped under pages. "
            "Do not use parts.\n"
            f"{diff_lines}\n"
            f"Normal Sheet Questions: exactly {normal} questions covering the whole "
            f"eligible sheet.{style_block}"
            "Return one complete JSON document with every requested page and all three final exams. "
            "If file output is supported, place that same complete JSON in one .json file. "
            "Do not split the task into separate prompts, omit sections, or return a partial batch.\n"
            'Only MCQ and True/False; no fill-in or image-dependent questions. Use exam-style stems, '
            'plausible distractors and balanced MCQ correct letters. Never say "according to the sheet". '
            "No repeated questions anywhere.\n"
            'MCQ format: {"type":"mcq","question":"Stem","options":{"A":"First","B":"Second",'
            '"C":"Third","D":"Fourth"},"correct_answer":"B","explanation":"Reason"}.\n'
            'True/False format: {"type":"true_false","question":"Statement","correct_answer":true,'
            '"explanation":"Reason"}. No options for True/False.\n'
            "Every question must be supported entirely by its assigned page. Use fewer than 15 if "
            "that is all the page can support. Each eligible page must contain at least one valid "
            "question; never invent or repeat content to reach 15.\n"
            "Do not add metadata inside individual questions. Fill every questions array below and "
            "preserve every page number. Each difficulty has its own final exam. Verify all counts "
            "and valid JSON syntax before returning.\n"
            f"Maximum total questions: {totals['total']} (page banks contain up to 15 per page; "
            "Final Exams and Normal Questions have exact counts).\n"
            f"{skeleton_json}"
        )

    whole = _pages_text(eff_start, eff_end)
    plan_sections = []
    for row in diffs:
        lines = [row["label"]]
        for r in row["page_ranges"]:
            lines.append(
                f"- Part {r['part']}: {_pages_text(r['start_page'], r['end_page'])} "
                f"— {row['questions_per_checkpoint']} questions"
            )
        lines.append(
            f"- {row['label']} Final Exam — {row['final_exam_questions']} questions "
            f"(entire effective sheet, {whole})"
        )
        plan_sections.append("\n".join(lines))
    plan_text = "\n\n".join(plan_sections)
    normal_plan = (
        f"Normal Sheet Questions\n- {normal} questions (entire effective sheet, {whole})"
        if normal > 0
        else "Normal Sheet Questions\n- None requested. Leave sheet_questions.questions as an empty array."
    )
    active_skel = {
        row["difficulty"]: {
            "parts": [
                {
                    "part": r["part"],
                    "pages": (
                        str(r["start_page"])
                        if r["start_page"] == r["end_page"]
                        else f"{r['start_page']}-{r['end_page']}"
                    ),
                    "questions": [],
                }
                for r in row["page_ranges"]
            ],
            "final_exam": {"questions": []},
        }
        for row in diffs
    }
    skeleton_json = json.dumps(
        {"active_study": active_skel, "sheet_questions": {"questions": []}}, indent=2
    )
    verify_lines = [
        *[
            f"{row['label']}: exactly {row['number_of_parts']} Parts numbered 1 to "
            f"{row['number_of_parts']}, each with exactly {row['questions_per_checkpoint']} "
            f"questions, and its own Final Exam with exactly {row['final_exam_questions']} questions."
            for row in diffs
        ],
        f"sheet_questions.questions has exactly {normal} questions.",
        'Every Part keeps the "pages" value shown in the structure below.',
        "Every question has non-empty question text and type mcq or true_false; legacy MCQ may omit type.",
        "MCQ has distinct, non-empty A, B, C, D options and a correct_answer letter.",
        "True/False has no options and a boolean correct_answer.",
        "Every question has a non-empty explanation.",
        "No question is repeated anywhere in the document.",
        "The JSON is valid: no comments, no trailing commas, no extra fields.",
    ]
    verify_text = "\n".join(f"{idx}. {line}" for idx, line in enumerate(verify_lines, start=1))
    return (
        "You are generating every question for one Lock-in study sheet in a single pass.\n\n"
        "Return ONE JSON object that can be pasted directly into Lock-in.\n"
        "Return valid JSON only. Do not return Markdown. Do not wrap the JSON in code fences. "
        "Do not add any explanation before or after the JSON.\n\n"
        "SHEET\n\n"
        f"Edition: {context['edition_label']}\n"
        f"Effective pages: {eff_start}–{eff_end}\n"
        "Pages outside the effective range are excluded. Do not use them.\n"
        "The sheet is supplied with this message. If it is not, ask for it before generating anything.\n\n"
        "GENERATE\n\n"
        f"{plan_text}\n\n"
        f"{normal_plan}{style_block}\n"
        f"Total: {totals['total']} questions\n\n"
        "CONTENT RULES\n\n"
        "- Use only information contained in the supplied sheet.\n"
        "- Do not invent facts that are not present in the sheet.\n"
        "- Generate each Part's questions strictly from that Part's page range.\n"
        "- Avoid duplicate questions and avoid repeated wording.\n"
        "- Questions should test different points wherever possible.\n"
        "- Use exam-style wording and plausible distractors. Distribute correct MCQ letters evenly across A/B/C/D (counts may differ by at most one).\n"
        '- Do not write "according to the sheet" or rely on images.\n'
        "- Return one complete JSON document covering all requested banks; do not omit sections or return a partial batch.\n"
        "- If file output is supported, place that same complete JSON in one .json file.\n\n"
        "QUESTION RULES\n\n"
        "- Use any sensible mixture of MCQ and True/False for each configured total; no ratio is required.\n"
        "- MCQ has exactly four distinct options A, B, C, D and one correct letter.\n"
        "- True/False has no options and a boolean correct_answer.\n"
        "- Include a concise explanation for every question.\n"
        "- Do not add id, difficulty, part, pages, source_page, tags or any other field inside a question.\n\n"
        "DIFFICULTY\n\n"
        f"Easy: {DIFFICULTY_BEHAVIOUR['easy']}\n"
        f"Medium: {DIFFICULTY_BEHAVIOUR['medium']}\n"
        f"Hard: {DIFFICULTY_BEHAVIOUR['hard']}\n\n"
        "FINAL EXAMS\n\n"
        "There is no shared Final Exam. Easy, Medium and Hard each have their own Final Exam inside their own object.\n"
        f"Each Final Exam covers the entire effective sheet ({whole}), not only the last Part.\n"
        "The Easy Final Exam is at Easy level, the Medium Final Exam at Medium level, and the Hard Final Exam at Hard level.\n\n"
        "NORMAL SHEET QUESTIONS\n\n"
        f"{f'Generate {normal} useful general questions covering the whole effective sheet.' if normal > 0 else 'None requested.'}\n\n"
        "QUESTION FORMAT\n\n"
        '{\n  "type": "mcq",\n  "question": "Question text",\n  "options": {\n'
        '    "A": "Option A",\n    "B": "Option B",\n    "C": "Option C",\n    "D": "Option D"\n'
        '  },\n  "correct_answer": "B",\n  "explanation": "Why B is correct."\n}\n\n'
        "For True/False, use:\n\n"
        '{\n  "type": "true_false",\n  "question": "Statement to judge",\n'
        '  "correct_answer": true,\n  "explanation": "Why the statement is true."\n}\n\n'
        "Older MCQ questions without type remain valid.\n\n"
        "JSON STRUCTURE\n\n"
        'Fill every "questions" array. Keep every key and every "part" and "pages" value exactly as shown.\n\n'
        f"{skeleton_json}\n\n"
        "BEFORE RETURNING, VERIFY\n\n"
        f"{verify_text}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--total-pages", type=int, default=30)
    parser.add_argument("--excl-start", type=int, default=1)
    parser.add_argument("--excl-end", type=int, default=0)
    parser.add_argument("--mode", choices=("parts", "pages"), default="pages")
    parser.add_argument("--edition", choices=("university", "lockin"), default="university")
    parser.add_argument("--normal-count", type=int, default=58)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    ctx = build_context(
        total_pdf_pages=args.total_pages,
        excluded_start_pages=args.excl_start,
        excluded_end_pages=args.excl_end,
        mode=args.mode,
        edition=args.edition,
    )
    prompt = build_prompt(ctx, normal_count=args.normal_count)
    if args.output:
        args.output.write_text(prompt, encoding="utf-8")
        print(f"Wrote {args.output} ({len(prompt)} chars)")
    else:
        print(prompt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
