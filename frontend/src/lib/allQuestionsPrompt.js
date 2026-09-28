/**
 * All Questions: one prompt for every question bank of a sheet.
 *
 * Everything here is built from the backend's All Questions context -- the
 * same Active Study planner Admin previews and saves through -- so part
 * counts, page ranges and question counts are never computed on this device.
 * The backend validates the returned JSON again before anything is saved.
 */

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
    const partQuestions = row.number_of_parts * row.questions_per_checkpoint;
    return { difficulty: row.difficulty, label: label(row), parts: row.number_of_parts, partQuestions, finalExam: row.final_exam_questions, total: partQuestions + row.final_exam_questions };
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
    if (existing.checkpoint_question_count > 0) replaced.push({ key: `${row.difficulty}-parts`, label: `${label(row)} Parts`, count: existing.checkpoint_question_count });
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
export function buildAllQuestionsPrompt(context, sheetQuestionCount) {
  assertContext(context);
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
    "Every question has non-empty question text and exactly the options A, B, C and D, none empty and no two the same.",
    "correct_answer is exactly \"A\", \"B\", \"C\" or \"D\".",
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

${normalPlan}

Total: ${totals.total} questions

CONTENT RULES

- Use only information contained in the supplied sheet.
- Do not invent facts that are not present in the sheet.
- Generate each Part's questions strictly from that Part's page range.
- Avoid duplicate questions and avoid repeated wording.
- Questions should test different points wherever possible.

QUESTION RULES

- Every question must contain exactly four options: A, B, C, D.
- Exactly one option must be correct.
- correct_answer must be exactly "A", "B", "C" or "D".
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
  let source = String(text ?? "").trim();
  if (!source) throw new Error("Paste the All Questions JSON first.");
  const fenced = source.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  if (fenced) source = fenced[1].trim();
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON syntax: ${error instanceof Error ? error.message : "the JSON could not be read."}`);
  }
}
