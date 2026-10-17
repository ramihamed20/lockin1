/**
 * All Questions: one prompt for every question bank of a sheet.
 *
 * Everything here is built from the backend's All Questions context -- the
 * same Active Study planner Admin previews and saves through -- so part
 * counts, page ranges and question counts are never computed on this device.
 * The backend validates the returned JSON again before anything is saved.
 */

import { bankPageNumbers } from "./activeStudyPages.js";

const DIFFICULTY_ORDER = ["easy", "medium", "hard"];

const DIFFICULTY_BEHAVIOUR = {
  easy: "Focus on direct recall, recognition and basic understanding.",
  medium: "Focus on understanding, interpretation and application.",
  hard: "Focus on deeper understanding, discrimination, integration and more challenging application, but never introduce information outside the sheet."
};

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function assertContext(context) {
  if (!context || !Array.isArray(context.difficulties)) throw new Error("The All Questions plan has not loaded yet.");
  const keys = context.difficulties.map((row) => row.difficulty);
  if (DIFFICULTY_ORDER.some((key) => !keys.includes(key))) throw new Error("The All Questions plan must include Easy, Medium and Hard.");
  for (const row of context.difficulties) {
    positiveInteger(row.number_of_parts, `${row.label || row.difficulty} parts`);
    positiveInteger(row.questions_per_checkpoint, "Questions per part");
    positiveInteger(row.final_exam_questions, "Final Exam questions");
    if (!Array.isArray(row.page_ranges) || row.page_ranges.length !== row.number_of_parts) throw new Error("A complete backend Active Study plan is required.");
    row.page_ranges.forEach((range, index) => {
      if (range?.part !== index + 1 || !Number.isInteger(range.start_page) || !Number.isInteger(range.end_page) || range.end_page < range.start_page) throw new Error("Active Study page ranges must be consecutive and valid.");
    });
  }
  positiveInteger(context.effective_start_page, "Effective start page");
  positiveInteger(context.effective_end_page, "Effective end page");
}

function ordered(context) {
  return DIFFICULTY_ORDER.map((key) => context.difficulties.find((row) => row.difficulty === key));
}

function label(row) {
  return row.label || row.difficulty.charAt(0).toUpperCase() + row.difficulty.slice(1);
}

/** Whole-number Normal Questions count, clamped to what the Question import accepts. */
export function normalizeSheetQuestionCount(value, max = 200) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(number)));
}

/** The counts preview: per difficulty, Normal Questions, and the total. */
export function allQuestionsTotals(context, sheetQuestionCount) {
  const normal = normalizeSheetQuestionCount(sheetQuestionCount, context?.sheet_questions?.max_count ?? 200);
  const difficulties = (context?.difficulties || []).map((row) => {
    const partQuestions = row.question_format === "pages" ? bankPageNumbers(row.page_ranges).length * 20 : row.number_of_parts * row.questions_per_checkpoint;
    return { difficulty: row.difficulty, label: label(row), parts: row.question_format === "pages" ? bankPageNumbers(row.page_ranges).length : row.number_of_parts, questionFormat: row.question_format, partQuestions, finalExam: row.final_exam_questions, total: partQuestions + row.final_exam_questions };
  });
  return { difficulties, normal, total: difficulties.reduce((sum, row) => sum + row.total, 0) + normal };
}

/**
 * Question sets Save would replace. Normal Questions split in two: the ones an
 * earlier All Questions run imported (replaced) and every other one (kept).
 */
export function existingQuestionSets(context) {
  const replaced = [];
  for (const row of context?.difficulties || []) {
    const existing = row.existing || {};
    if (existing.checkpoint_question_count > 0) replaced.push({ key: `${row.difficulty}-parts`, label: `${label(row)} ${row.question_format === "pages" ? "Pages" : "Parts"}`, count: existing.checkpoint_question_count });
    if (existing.final_exam_question_count > 0) replaced.push({ key: `${row.difficulty}-final`, label: `${label(row)} Final Exam`, count: existing.final_exam_question_count });
  }
  const normalExisting = Number(context?.sheet_questions?.existing_count) || 0;
  const normalAllQuestions = Number(context?.sheet_questions?.all_questions_count) || 0;
  return { replaced, normalExisting, normalAllQuestions, normalOther: Math.max(0, normalExisting - normalAllQuestions) };
}

function pagesText(start, end) {
  return start === end ? `page ${start}` : `pages ${start}–${end}`;
}

function skeleton(context) {
  const activeStudy = {};
  for (const row of ordered(context)) {
    activeStudy[row.difficulty] = {
      parts: row.page_ranges.map((range) => ({ part: range.part, pages: range.start_page === range.end_page ? String(range.start_page) : `${range.start_page}-${range.end_page}`, questions: [] })),
      final_exam: { questions: [] }
    };
  }
  return JSON.stringify({ active_study: activeStudy, sheet_questions: { questions: [] } }, null, 2);
}

/** Builds, but never persists, the single external-AI prompt. */
export function buildAllQuestionsPrompt(context, sheetQuestionCount, options = {}) {
  const instructions = String(options.examStyle || "").trim().slice(0, 6000);
  const style = instructions ? `\n\nEXAM-STYLE REFERENCE\n\n${instructions}\n\nUse this reference for wording, question styles and distractors only. The supplied sheet remains the only factual source. Keep all required JSON keys, page assignments and exact counts.\n` : "";
  assertContext(context);
  if (context.difficulties.every((row) => row.question_format === "pages")) return buildAllPageQuestionsPrompt(context, sheetQuestionCount, style);
  const normal = normalizeSheetQuestionCount(sheetQuestionCount, context.sheet_questions?.max_count ?? 200);
  const totals = allQuestionsTotals(context, normal);
  const whole = pagesText(context.effective_start_page, context.effective_end_page);
  const plan = ordered(context).map((row) => [
    label(row),
    ...row.page_ranges.map((range) => `- Part ${range.part}: ${pagesText(range.start_page, range.end_page)} — ${row.questions_per_checkpoint} questions`),
    `- ${label(row)} Final Exam — ${row.final_exam_questions} questions (entire effective sheet, ${whole})`
  ].join("\n")).join("\n\n");
  const normalPlan = normal > 0 ? `Normal Sheet Questions\n- ${normal} questions (entire effective sheet, ${whole})` : "Normal Sheet Questions\n- None requested. Leave sheet_questions.questions as an empty array.";
  const verify = [
    ...ordered(context).map((row) => `${label(row)}: exactly ${row.number_of_parts} Parts numbered 1 to ${row.number_of_parts}, each with exactly ${row.questions_per_checkpoint} questions, and its own Final Exam with exactly ${row.final_exam_questions} questions.`),
    `sheet_questions.questions has exactly ${normal} questions.`,
    "Every Part keeps the \"pages\" value shown in the structure below.",
    "Every question has non-empty question text and type mcq or true_false; legacy MCQ may omit type.",
    "MCQ has distinct, non-empty A, B, C, D options and a correct_answer letter.",
    "True/False has no options and a boolean correct_answer.",
    "Every question has a non-empty explanation.",
    "No question is repeated anywhere in the document.",
    "The JSON is valid: no comments, no trailing commas, no extra fields."
  ].map((line, index) => `${index + 1}. ${line}`).join("\n");

  return `You are generating every question for one Lock-in study sheet in a single pass.

Return ONE JSON object that can be pasted directly into Lock-in.
Return valid JSON only. Do not return Markdown. Do not wrap the JSON in code fences. Do not add any explanation before or after the JSON.

SHEET

Edition: ${context.edition_label || context.edition}
Effective pages: ${context.effective_start_page}–${context.effective_end_page}
Pages outside the effective range are excluded. Do not use them.
The sheet is supplied with this message. If it is not, ask for it before generating anything.

GENERATE

${plan}

${normalPlan}${style}

Total: ${totals.total} questions

CONTENT RULES

- Use only information contained in the supplied sheet.
- Do not invent facts that are not present in the sheet.
- Generate each Part's questions strictly from that Part's page range.
- Avoid duplicate questions and avoid repeated wording.
- Questions should test different points wherever possible.
- Use exam-style wording and plausible distractors. Distribute correct MCQ letters evenly across A/B/C/D (counts may differ by at most one).
- Do not write "according to the sheet" or rely on images.
- Return one complete JSON document covering all requested banks; do not omit sections or return a partial batch.
- If file output is supported, place that same complete JSON in one .json file.

QUESTION RULES

- Use any sensible mixture of MCQ and True/False for each configured total; no ratio is required.
- MCQ has exactly four distinct options A, B, C, D and one correct letter.
- True/False has no options and a boolean correct_answer.
- Include a concise explanation for every question.
- Do not add id, difficulty, part, pages, source_page, tags or any other field inside a question.

DIFFICULTY

Easy: ${DIFFICULTY_BEHAVIOUR.easy}
Medium: ${DIFFICULTY_BEHAVIOUR.medium}
Hard: ${DIFFICULTY_BEHAVIOUR.hard}

FINAL EXAMS

There is no shared Final Exam. Easy, Medium and Hard each have their own Final Exam inside their own object.
Each Final Exam covers the entire effective sheet (${whole}), not only the last Part.
The Easy Final Exam is at Easy level, the Medium Final Exam at Medium level, and the Hard Final Exam at Hard level.

NORMAL SHEET QUESTIONS

${normal > 0 ? `Generate ${normal} useful general questions covering the whole effective sheet.` : "None requested."}

QUESTION FORMAT

{
  "type": "mcq",
  "question": "Question text",
  "options": {
    "A": "Option A",
    "B": "Option B",
    "C": "Option C",
    "D": "Option D"
  },
  "correct_answer": "B",
  "explanation": "Why B is correct."
}

For True/False, use:

{
  "type": "true_false",
  "question": "Statement to judge",
  "correct_answer": true,
  "explanation": "Why the statement is true."
}

Older MCQ questions without type remain valid.

JSON STRUCTURE

Fill every "questions" array. Keep every key and every "part" and "pages" value exactly as shown.

${skeleton(context)}

BEFORE RETURNING, VERIFY

${verify}`;
}

/**
 * Parses the pasted document. Tolerates the one mistake AIs make most -- a
 * Markdown code fence around the JSON -- and nothing else.
 */
export function parseAllQuestionsJson(text) {
  let source = String(text ?? "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("Paste the All Questions JSON first.");
  const fenced = source.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  if (fenced) source = fenced[1].trim();
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON syntax: ${error instanceof Error ? error.message : "the JSON could not be read."}`);
  }
}


function buildAllPageQuestionsPrompt(context, sheetQuestionCount, style = "") {
  const normal = normalizeSheetQuestionCount(sheetQuestionCount, context.sheet_questions?.max_count ?? 200);
  const active = Object.fromEntries(ordered(context).map((row) => [row.difficulty, {
    pages: bankPageNumbers(row.page_ranges).map((page) => ({ page, questions: [] })), final_exam: { questions: [] }
  }]));
  return `Generate every question for one Lock-in sheet as ONE valid JSON object. No Markdown, commentary or extra fields.
Use only the supplied PDF, physical page numbers ${context.effective_start_page}–${context.effective_end_page}; excluded pages must not be used. Wait for the sheet if missing.
For EACH difficulty (easy, medium, hard), create exactly 20 distinct questions for EACH eligible page, grouped under pages. Do not use parts.
${ordered(context).map((row) => `${label(row)}: ${DIFFICULTY_BEHAVIOUR[row.difficulty]} Final exam: exactly ${row.final_exam_questions} separate questions covering the entire eligible sheet.`).join("\n")}
Normal Sheet Questions: exactly ${normal} questions covering the whole eligible sheet.${style}
Return one complete JSON document with every requested page and all three final exams. If file output is supported, place that same complete JSON in one .json file. Do not split the task into separate prompts, omit sections, or return a partial batch.
Only MCQ and True/False; no fill-in or image-dependent questions. Use exam-style stems, plausible distractors and balanced MCQ correct letters. Never say "according to the sheet". No repeated questions anywhere.
MCQ format: {"type":"mcq","question":"Stem","options":{"A":"First","B":"Second","C":"Third","D":"Fourth"},"correct_answer":"B","explanation":"Reason"}.
True/False format: {"type":"true_false","question":"Statement","correct_answer":true,"explanation":"Reason"}. No options for True/False.
Every question must be supported entirely by its assigned page. If a page cannot support 20 valid questions, report that limitation instead of inventing content; do not return an incomplete bank as complete.
Do not add metadata inside individual questions. Fill every questions array below and preserve every page number. Each difficulty has its own final exam. Verify all counts and valid JSON syntax before returning.
Total questions: ${allQuestionsTotals(context, normal).total}.
${JSON.stringify({ active_study: active, sheet_questions: { questions: [] } }, null, 2)}`;
}
