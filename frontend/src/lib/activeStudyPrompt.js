const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function assertPlan({ difficulty, numberOfParts, pageRanges, questionsPerPart, finalExamQuestions }) {
  if (!DIFFICULTIES.has(difficulty)) throw new Error("Difficulty must be easy, medium, or hard.");
  requirePositiveInteger(numberOfParts, "Number of parts");
  requirePositiveInteger(questionsPerPart, "Questions per part");
  requirePositiveInteger(finalExamQuestions, "Final exam questions");
  if (!Array.isArray(pageRanges) || pageRanges.length !== numberOfParts) throw new Error("A complete backend Active Study plan is required.");
  pageRanges.forEach((range, index) => {
    if (range?.part !== index + 1 || !Number.isInteger(range.start_page) || !Number.isInteger(range.end_page) || range.start_page < 1 || range.end_page < range.start_page) throw new Error("Active Study page ranges must be consecutive and valid.");
  });
}

function partSkeleton(numberOfParts) {
  return Array.from({ length: numberOfParts }, (_, index) => ({ part: index + 1, questions: [] }))
    .map((part) => JSON.stringify(part, null, 2).split("\n").map((line) => `    ${line}`).join("\n"))
    .join(",\n");
}

/** Builds, but never persists, the manual external-AI JSON prompt. */
export function buildActiveStudyJsonPrompt(plan) {
  assertPlan(plan);
  const { difficulty, numberOfParts, pageRanges, questionsPerPart, finalExamQuestions } = plan;
  const ranges = pageRanges.map((range) => `Part ${range.part} → Pages ${range.start_page}–${range.end_page}`).join("\n");
  return `You are filling question content for Lock-in Active Study.

Your task is to return a JSON object that can be pasted directly into Lock-in.
Do not change the JSON structure. Do not add unrequested fields.
Do not return Markdown, code fences, or any text before or after the JSON.
Return valid JSON only.

ACTIVE STUDY CONFIGURATION

Difficulty: ${difficulty}
Number of Parts: ${numberOfParts}
Questions per Part: ${questionsPerPart}
Final Exam Questions: ${finalExamQuestions}

PART STRUCTURE

${ranges}

QUESTION REQUIREMENTS

For every Part:
- Create exactly ${questionsPerPart} MCQ questions related to that Part's assigned pages.
- Each question must have exactly four options: A, B, C, D.
- Exactly one option must be correct, and every question needs a concise explanation.
- Do not add difficulty, part, source_pages, xp, id, tags, score, or other metadata inside individual questions.
- Do not duplicate identical questions.

For the Final Exam:
- Create exactly ${finalExamQuestions} MCQ questions at ${difficulty} difficulty.
- Cover the complete eligible content of the sheet.
- Each question must have A, B, C, D, one correct answer, and an explanation.

CONTENT RULES

I will provide the study material, questions, answers, notes, or PDF separately.
Use only the material I provide. If I provide a question and correct answer, preserve the intended answer and create three plausible incorrect options when needed. If I provide an MCQ, preserve it unless there is an obvious structural issue. Do not silently replace an explicitly provided answer.

QUESTION JSON FORMAT

{
  "question": "Question text",
  "options": {
    "A": "Option A",
    "B": "Option B",
    "C": "Option C",
    "D": "Option D"
  },
  "correct_answer": "B",
  "explanation": "Explanation of why B is correct."
}

FINAL JSON STRUCTURE

{
  "parts": [
${partSkeleton(numberOfParts)}
  ],
  "final_exam": {
    "questions": []
  }
}

STRICT VALIDATION

Before returning the final JSON verify:
1. There are exactly ${numberOfParts} Parts numbered sequentially from 1 to ${numberOfParts}.
2. Every Part contains exactly ${questionsPerPart} questions.
3. Final Exam contains exactly ${finalExamQuestions} questions.
4. Every question is non-empty and has exactly A, B, C, and D options.
5. No option is empty or duplicates another option in the same question.
6. correct_answer is exactly A, B, C, or D.
7. Every question has a non-empty explanation and there are no duplicate questions.
8. JSON syntax is valid, has no comments or trailing commas, and contains no extra fields.

Wait for me to provide the study material/questions before generating the final JSON.`;
}
