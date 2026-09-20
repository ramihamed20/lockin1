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
  // The subject list is the server's catalog, not a table compiled into the
  // client: a sheet reaches Questions because the reader's cohort owns the
  // subject it already sits under, so a published question is reachable.
  assert.doesNotMatch(questions, /getCohortMaterials/);
  assert.match(questions, /catalogWorkspaceApi\.questionMaterials\(\)/);
  assert.match(questions, /catalogWorkspaceApi\.sheetQuestions\(sheetId/);
  assert.match(questions, /getCohortQuestionCategories\(user\)/);
  assert.match(questions, /t\("questions\.noQuestionsTitle"\)/);
  assert.match(questions, /t\("questions\.startQuestions"\)/);
  assert.match(questions, /const \[started, setStarted\] = useState\(false\)/);
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
  assert.match(app, /path="\/questions\/categories\/:categoryId\/subjects\/:subjectId\/sheets\/:sheetId"/);
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

test("sheet questions are answered one tap at a time and graded by the server", async () => {
  const [questions, api, catalogue] = await Promise.all([
    readFile(new URL("../src/pages/Questions.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/catalogWorkspace.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8")
  ]);
  // The server decides correctness and XP; the client never reads either
  // from the question it was sent.
  assert.match(api, /answerQuestion\(sheetId, questionId, choiceIds\)/);
  assert.match(api, /\/answer`, \{\s*method: "POST"/);
  assert.doesNotMatch(questions, /choice\.is_correct|question\.explanation/);
  assert.match(questions, /answer\.correct_choice_ids|answer\?\.correct_choice_ids/);
  assert.match(questions, /answer\.xp_awarded/);
  // A single-answer tap submits; only multiple-select keeps a check button.
  assert.match(questions, /if \(!multiple\) \{\s*setSelected\(\[id\]\);\s*submit\(\[id\]\);/);
  assert.match(questions, /\{multiple && !answer && \(\s*<button[^>]*onClick=\{\(\) => submit\(selected\)\}/);
  assert.match(questions, /inFlight\.current/);
  assert.doesNotMatch(questions, /questions\.tryAgain/);
  assert.match(questions, /t\("questions\.progress", \{ index: position, total \}\)/);
  assert.match(questions, /t\("questions\.remaining", \{ count: total - position \}\)/);
  assert.match(catalogue, /"questions\.progress": "Question \{index\} of \{total\}"/);
  assert.match(catalogue, /"questions\.xpEarned": "\+\{count\} XP"/);
});

test("only a correct answer shows an XP reward", async () => {
  const questions = await readFile(new URL("../src/pages/Questions.jsx", import.meta.url), "utf8");
  // The reward chip reads the server's award, which is zero for a wrong answer.
  assert.match(questions, /\{answer\.xp_awarded > 0 && <span className="question-xp-chip">/);
  assert.doesNotMatch(questions, /xp_value[^;]*xpEarned/);
});

test("admin scope analytics is server-aggregated and filtered by node ids", async () => {
  const [page, api, admin] = await Promise.all([
    readFile(new URL("../src/pages/admin/ScopeAnalytics.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/adminControl.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/OperationsAdmin.jsx", import.meta.url), "utf8")
  ]);
  assert.match(api, /request\("\/operations\/admin\/analytics\/scope" \+ buildQueryString\(\{ university, specialty, year \}\)\)/);
  assert.match(admin, /<ScopeAnalytics \/>/);
  // Choosing a level clears the ones beneath it, so a Specialty id is never
  // sent without the University it belongs to.
  assert.match(page, /setScope\(\{ \.\.\.EMPTY_SCOPE, university: value \}\)/);
  assert.match(page, /specialty: value, year: ""/);
  // No client-side totals: every figure is read from the response.
  assert.doesNotMatch(page, /\.reduce\(/);
  assert.match(page, /No data in this scope yet/);
});
