import assert from "node:assert/strict";
import test from "node:test";
import { allQuestionsPreviewSections, allQuestionsRequestBody, allQuestionsValidationToken, MAX_ALL_QUESTIONS_FILE_BYTES, readAllQuestionsFile } from "../src/lib/allQuestionsImport.js";
import { buildAllQuestionsPrompt, parseAllQuestionsJson } from "../src/lib/allQuestionsPrompt.js";

const context = {
  edition: "university", effective_start_page: 2, effective_end_page: 3,
  excluded_start_pages: 1, excluded_end_pages: 0, settings_revision: 1,
  difficulties: ["easy", "medium", "hard"].map((difficulty) => ({
    difficulty, question_format: "pages", page_numbers: [2, 3],
    number_of_parts: 1, page_ranges: [{ part: 1, start_page: 2, end_page: 3 }],
    questions_per_checkpoint: 15, questions_per_page: 20, final_exam_questions: 50,
    prompt_template_supported: true, existing: { revision: 0 }
  })), sheet_questions: { max_count: 200 }
};

test("small imports keep the JSON contract; large imports send the same single document as a file", async () => {
  const body = { payload: { active_study: {} }, sheet_question_count: 0 };
  assert.equal(allQuestionsRequestBody(body), body);
  const large = { ...body, payload: { explanation: "س".repeat(600_000) }, settings_revision: 2,
    expected_revisions: { easy: 1, medium: 0, hard: 0 }, publish_sheet_questions: false,
    excluded_start_pages: 0, excluded_end_pages: null };
  const form = allQuestionsRequestBody(large);
  assert.ok(form instanceof FormData);
  assert.deepEqual(JSON.parse(await form.get("payload_file").text()), large.payload);
  assert.equal(form.get("payload_file").name, "all-questions.json");
  assert.equal(form.has("payload"), false);
  assert.equal(form.get("settings_revision"), "2");
  assert.deepEqual(JSON.parse(form.get("expected_revisions")), large.expected_revisions);
  assert.equal(form.get("publish_sheet_questions"), "false");
  assert.equal(form.get("excluded_start_pages"), "0");
  assert.equal(form.has("excluded_end_pages"), false);
  assert.throws(() => allQuestionsRequestBody({ payload: "x".repeat(MAX_ALL_QUESTIONS_FILE_BYTES) }), /16 MB/);
});

test("UTF-8 JSON and TXT files tolerate a BOM and Markdown fences; bad files fail before reading", async () => {
  for (const name of ["bank.JSON", "bank.txt"]) {
    const file = new File(['\uFEFF```json\n{"active_study":{}}\n```'], name);
    assert.deepEqual(parseAllQuestionsJson(await readAllQuestionsFile(file)), { active_study: {} });
  }
  await assert.rejects(readAllQuestionsFile(new File(["{}"], "bank.pdf")), /json or .txt/);
  await assert.rejects(readAllQuestionsFile({ name: "big.json", size: MAX_ALL_QUESTIONS_FILE_BYTES + 1,
    text() { assert.fail("Oversized files must not be read"); } }), /16 MB/);
  assert.throws(() => parseAllQuestionsJson("{truncated"), /Invalid JSON syntax/);
});

test("changing text, counts, boundaries, plan or a saved revision invalidates the review", () => {
  const token = allQuestionsValidationToken(context, 1, 30);
  const changed = (change) => { const copy = JSON.parse(JSON.stringify(context)); change(copy); return copy; };
  for (const [ctx, version, count] of [
    [context, 2, 30], [context, 1, 20],
    [changed((ctx) => { ctx.edition = "lockin"; }), 1, 30],
    [changed((ctx) => { ctx.excluded_start_pages = 2; }), 1, 30],
    [changed((ctx) => { ctx.settings_revision++; }), 1, 30],
    [changed((ctx) => { ctx.difficulties[0].existing.revision++; }), 1, 30],
    [changed((ctx) => { ctx.difficulties[0].final_exam_questions = 40; }), 1, 30],
    [changed((ctx) => { ctx.difficulties[0].page_ranges[0].end_page = 4; }), 1, 30]
  ]) assert.notEqual(allQuestionsValidationToken(ctx, version, count), token);
  assert.equal(allQuestionsValidationToken(JSON.parse(JSON.stringify(context)), 1, 30), token);
});

test("the preview keeps physical pages, legacy parts and each final exam separate", () => {
  const question = { question: "False statement", type: "true_false", correct_answer: false, explanation: "Reason" };
  const payload = { active_study: {
    easy: { pages: [{ page: 7, questions: [question] }], final_exam: { questions: [question] } },
    medium: { parts: [{ part: 2, questions: [question] }], final_exam: { questions: [question] } }
  }, sheet_questions: { questions: [question] } };
  const sections = allQuestionsPreviewSections(payload);
  assert.deepEqual(sections.map((row) => row.id), ["easy-page-7", "easy-final", "medium-part-2", "medium-final", "normal"]);
  assert.equal(sections[0].number, 7);
  assert.equal(sections[0].questions[0].correct_answer, false);
  assert.equal(allQuestionsPreviewSections({ sheet_questions: { questions: [] } }).length, 0);
});

test("exam-style instructions stay inside one prompt and preserve the page JSON schema", () => {
  const style = "Use short clinical vignettes and plausible distractors.";
  const prompt = buildAllQuestionsPrompt(context, 30, { examStyle: style });
  assert.equal(prompt.split(style).length - 1, 1);
  assert.match(prompt, /EXAM-STYLE REFERENCE/);
  assert.match(prompt, /one \.json file/);
  assert.match(prompt, /Do not split the task into separate prompts/);
  const structure = JSON.parse(prompt.slice(prompt.lastIndexOf("{\n  \"active_study\"")));
  assert.deepEqual(Object.keys(structure), ["active_study", "sheet_questions"]);
  for (const difficulty of ["easy", "medium", "hard"]) {
    assert.deepEqual(structure.active_study[difficulty].pages.map((row) => row.page), [2, 3]);
    assert.deepEqual(structure.active_study[difficulty].final_exam, { questions: [] });
    assert.equal(structure.active_study[difficulty].parts, undefined);
  }
  const legacy = { ...context, difficulties: context.difficulties.map((row) => ({ ...row, question_format: "parts" })) };
  const oldPrompt = buildAllQuestionsPrompt(legacy, 0, { examStyle: style });
  assert.equal(oldPrompt.split(style).length - 1, 1);
  assert.match(oldPrompt, /"parts":/);
  assert.match(oldPrompt, /Leave sheet_questions.questions as an empty array/);
});
