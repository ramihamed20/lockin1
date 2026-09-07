import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Questions offers cohort question sources and lists subjects under AI Sheet", async () => {
  const [questions, catalogue] = await Promise.all([
    readFile(new URL("../src/pages/Questions.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8")
  ]);
  for (const [id, label] of [["practice", "Practice"], ["years", "Years"], ["aiSheet", "AI Sheet"], ["mix", "Mix"]]) {
    assert.match(questions, new RegExp(`titleKey: "questions\.${id}"`));
    assert.match(catalogue, new RegExp(`"questions\.${id}": "${label}"`));
  }
  // Quizzes is gone with the local demo quiz it used to open.
  assert.doesNotMatch(questions, /quizzes/i);
  assert.doesNotMatch(catalogue, /"questions\.quizzes"/);
  assert.match(questions, /id: "ai-sheet".*available: true/);
  assert.match(questions, /getCohortMaterials\(user\)/);
  assert.match(questions, /getCohortQuestionCategories\(user\)/);
  assert.match(questions, /t\("questions\.noQuestionsTitle"\)/);
  assert.match(catalogue, /"questions\.noQuestionsTitle": "No questions yet"/);
  assert.match(questions, /text=\{t\("common\.soon"\)\}/);
  assert.doesNotMatch(questions, /Practice mode is coming soon\.|has not been published by the server yet/);
});

test("quiz launch bypasses attempt details and the player keeps grading server-authoritative", async () => {
  const [app, launch, attempt, result, catalogue] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/QuizDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Attempt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/AssessmentResult.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/questions\/categories\/:categoryId"/);
  assert.match(app, /path="\/questions\/categories\/:categoryId\/subjects\/:subjectId"/);
  assert.doesNotMatch(app, /questions\/demo/);
  assert.match(launch, /assessmentsApi\.startAttempt\(quizId/);
  assert.doesNotMatch(launch, /Start or resume|Practice size|configured questions/);
  assert.match(attempt, /t\("assessment\.questionOf", \{ index: activeIndex \+ 1, total: questions\.length \}\)/);
  assert.match(catalogue, /"assessment\.questionOf": "Question \{index\} of \{total\}"/);
  assert.match(attempt, /t\("assessment\.submitQuiz"\)/);
  assert.match(catalogue, /"assessment\.submitQuiz": "Submit Quiz"/);
  assert.match(attempt, /t\("assessment\.explainQuestion"\)/);
  assert.match(catalogue, /"assessment\.explainQuestion": "Explain Question"/);
  assert.doesNotMatch(attempt, /correct_option_ids|question\.explanation/);
  assert.match(result, /t\("assessment\.discussQuiz"\)/);
  assert.match(catalogue, /"assessment\.discussQuiz": "Discuss Quiz"/);
  assert.match(result, /"assessment\.explainQuestion"/);
  assert.match(result, /question\.correct/);
});
