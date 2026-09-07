import assert from "node:assert/strict";
import test from "node:test";

import { buildActiveStudyJsonPrompt } from "../src/lib/activeStudyPrompt.js";

function plan(difficulty, numberOfParts) {
  return {
    difficulty,
    numberOfParts,
    questionsPerPart: 15,
    finalExamQuestions: 50,
    pageRanges: Array.from({ length: numberOfParts }, (_, index) => ({
      part: index + 1,
      start_page: index * 5 + 2,
      end_page: index === numberOfParts - 1 ? index * 5 + 7 : index * 5 + 6
    }))
  };
}

test("medium prompt uses the backend plan's exact four-part ranges and JSON skeleton", () => {
  const prompt = buildActiveStudyJsonPrompt(plan("medium", 4));
  assert.match(prompt, /Difficulty: medium/);
  assert.match(prompt, /Number of Parts: 4/);
  assert.match(prompt, /Part 1 → Pages 2–6/);
  assert.match(prompt, /Part 4 → Pages 17–22/);
  assert.equal((prompt.match(/"part": \d+/g) || []).length, 4);
  assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/);
});

test("prompt generator supports easy, hard, and dynamic one-to-ten part counts", () => {
  assert.match(buildActiveStudyJsonPrompt(plan("easy", 1)), /Difficulty: easy/);
  const hard = buildActiveStudyJsonPrompt(plan("hard", 10));
  assert.match(hard, /Difficulty: hard/);
  assert.match(hard, /Number of Parts: 10/);
  assert.equal((hard.match(/"part": \d+/g) || []).length, 10);
});

test("prompt generator rejects an incomplete plan and preserves the importer question contract", () => {
  assert.throws(() => buildActiveStudyJsonPrompt({ ...plan("medium", 4), pageRanges: [] }), /complete backend Active Study plan/);
  const prompt = buildActiveStudyJsonPrompt(plan("medium", 1));
  assert.match(prompt, /"question": "Question text"/);
  assert.match(prompt, /"options": \{/);
  assert.match(prompt, /"correct_answer": "B"/);
  assert.match(prompt, /"explanation": "Explanation of why B is correct\."/);
});
