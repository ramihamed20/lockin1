import assert from "node:assert/strict";
import test from "node:test";
import { availablePageQuestions, customPageRanges, maxCustomPages, maxCustomQuestions, selectPageQuestions } from "../src/lib/activeStudyPages.js";
import { buildActiveStudyJsonPrompt } from "../src/lib/activeStudyPrompt.js";
import { allQuestionsTotals, buildAllQuestionsPrompt } from "../src/lib/allQuestionsPrompt.js";

const ranges = [{ part: 1, start_page: 2, end_page: 6 }, { part: 2, start_page: 7, end_page: 8 }];
const bank = { pages: Array.from({ length: 7 }, (_, index) => ({ page: index + 2, questions: Array.from({ length: 15 }, (_, q) => ({ question: `page-${index + 2}-${q}` })) })) };

test("custom groups honor exclusions, the requested size and the final short group", () => {
  assert.deepEqual(customPageRanges(2, 8, 3), [
    { part: 1, start_page: 2, end_page: 4 }, { part: 2, start_page: 5, end_page: 7 }, { part: 3, start_page: 8, end_page: 8 }
  ]);
  for (const size of [0, -1, 1.5, true, 8]) assert.throws(() => customPageRanges(2, 8, size));
});

test("selection stays within the pages and uses stable identities after regrouping", () => {
  const selected = selectPageQuestions(bank, 2, 4, 5);
  assert.deepEqual(selected.map((q) => q.source_key), ["page:2:question:1", "page:3:question:1", "page:4:question:1", "page:2:question:2", "page:3:question:2"]);
  assert.equal(selectPageQuestions(bank, 2, 2, 15).length, 15);
  assert.equal(selectPageQuestions(bank, 2, 2, 1)[0].source_key, selected[0].source_key);
  assert.throws(() => selectPageQuestions(bank, 1, 1, 5));
});

test("sparse pages work with up to fifteen; older banks of twenty use only the first fifteen", () => {
  const sparse = { pages: [{ page: 2, questions: [{ question: "a" }, { question: "b" }] }] };
  assert.equal(availablePageQuestions(sparse, 2, 2), 2);
  assert.equal(selectPageQuestions(sparse, 2, 2, 2).length, 2);
  assert.throws(() => selectPageQuestions(sparse, 2, 2, 3), /not enough/);
  const legacy = { pages: [{ page: 2, questions: Array.from({ length: 20 }, (_, q) => ({ question: `old-${q}` })) }] };
  assert.equal(selectPageQuestions(legacy, 2, 2, 15).length, 15);
  assert.throws(() => selectPageQuestions(legacy, 2, 2, 16), /not enough/);
  assert.equal(maxCustomQuestions(21, 1), 15);
  assert.equal(maxCustomQuestions(20, 2), 30);
  assert.equal(maxCustomQuestions(21, 2), 15, "an odd sheet ends on a single page");
  assert.equal(maxCustomQuestions(21, 10), 15, "the last group is a single page");
  assert.equal(maxCustomPages(21), 10);
  assert.equal(maxCustomPages(4), 4);
  assert.throws(() => customPageRanges(2, 22, 11));
});

test("new-sheet prompts use physical PDF pages and fifteen questions per page", () => {
  const prompt = buildActiveStudyJsonPrompt({ questionFormat: "pages", difficulty: "medium", numberOfParts: 2, pageRanges: ranges, questionsPerPart: 15, finalExamQuestions: 50 });
  const skeleton = JSON.parse(prompt.slice(prompt.indexOf('{\n  "pages"'), prompt.indexOf('\nVerify every')));
  assert.deepEqual(skeleton.pages.map((p) => p.page), [2, 3, 4, 5, 6, 7, 8]);
  assert.ok(!("parts" in skeleton));
  assert.match(prompt, /up to 15 distinct questions for EACH eligible page/);
  assert.doesNotMatch(prompt, /exactly 15 questions/);
  assert.match(prompt, /up to 30 questions per checkpoint/);
});

test("All Questions calculates and prompts for the same page bank totals", () => {
  const context = { effective_start_page: 2, effective_end_page: 8, edition: "university", sheet_questions: { max_count: 200 }, difficulties: ["easy", "medium", "hard"].map((difficulty) => ({ difficulty, question_format: "pages", number_of_parts: 2, page_ranges: ranges, questions_per_checkpoint: 15, final_exam_questions: 50 })) };
  const totals = allQuestionsTotals(context, 10);
  assert.equal(totals.total, 475);
  const prompt = buildAllQuestionsPrompt(context, 10);
  const skeleton = JSON.parse(prompt.slice(prompt.indexOf('{\n  "active_study"')));
  assert.equal(skeleton.active_study.medium.pages.length, 7);
  assert.ok(!("parts" in skeleton.active_study.medium));
  assert.match(prompt, /up to 15 distinct questions for EACH eligible page/);
  assert.match(prompt, /Maximum possible questions/);
});
