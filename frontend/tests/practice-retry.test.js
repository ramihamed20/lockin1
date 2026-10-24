import assert from "node:assert/strict";
import test from "node:test";
import { gradeRecordedRetry } from "../src/lib/practiceRetry.js";
const question = { choices: [{ id: "a" }, { id: "b" }, { id: "c" }] };
const recorded = { correct_choice_ids: ["b"], selected_choice_ids: ["a"], xp_awarded: 10, explanation: "Why B" };
test("practice feedback uses previously revealed answers and never awards XP", () => {
  assert.equal(gradeRecordedRetry(question, recorded, ["b"]).is_correct, true);
  assert.equal(gradeRecordedRetry(question, recorded, ["a"]).is_correct, false);
  assert.equal(gradeRecordedRetry(question, recorded, ["b"]).xp_awarded, 0);
  assert.equal(recorded.xp_awarded, 10);
});
test("a verdict for another published version cannot grade the current choices", () => {
  assert.equal(gradeRecordedRetry(question, { correct_choice_ids: ["old-option"] }, ["b"]), null);
  assert.equal(gradeRecordedRetry(question, null, ["a"]), null);
  assert.equal(gradeRecordedRetry(question, { correct_choice_ids: [] }, ["a"]), null);
  assert.equal(gradeRecordedRetry(question, recorded, ["foreign-choice"]), null);
});
test("multiple-select and true/false retries compare the whole selected set", () => {
  const key = { ...recorded, correct_choice_ids: ["a", "c"] };
  assert.equal(gradeRecordedRetry(question, key, ["c", "a"]).is_correct, true);
  assert.equal(gradeRecordedRetry(question, key, ["a"]).is_correct, false);
  assert.equal(gradeRecordedRetry(question, key, ["a", "a"]), null);
  assert.equal(gradeRecordedRetry(question, key, ["a", "b", "c"]).is_correct, false);
  const tf = { choices: [{ id: "true" }, { id: "false" }] };
  assert.equal(gradeRecordedRetry(tf, { correct_choice_ids: ["false"] }, ["false"]).is_correct, true);
});
