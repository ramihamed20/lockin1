import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [player, api, study, styles] = await Promise.all([
  readFile(new URL("../src/components/learning/ActiveStudyPlayer.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/api/focus.js", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/LearningObjectStudy.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8")
]);

test("managed-sheet Active Study is available from a real learning object and preserves Normal Study", () => {
  assert.match(study, /ActiveStudyPlayer sheetId=\{learningObject\.id\}/);
  assert.match(study, /Open material/);
  assert.match(player, /Easy/);
  assert.match(player, /Medium/);
  assert.match(player, /Hard/);
  assert.match(player, /Resume/);
  assert.match(player, /item\.status\.replaceAll/);
});

test("student flow uses server-backed actions for checkpoints, retries, and completion", () => {
  for (const name of [
    "getManagedActiveStudyAvailability",
    "startManagedActiveStudy",
    "getManagedActiveStudyQuestions",
    "answerManagedActiveStudyQuestion",
    "submitManagedActiveStudy"
  ]) assert.match(api, new RegExp(name));
  assert.match(player, /Study this part again/);
  assert.match(player, /Continue anyway/);
  assert.match(player, /Retry Final Exam/);
  assert.match(player, /Difficulty Completed/);
  assert.match(player, /Check answer/);
  assert.match(player, /correct_answer/);
});

test("Active Study has responsive question and reading surfaces", () => {
  assert.match(styles, /active-study-player__options/);
  assert.match(styles, /active-study-player__reading iframe/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*active-study-player__difficulty/);
  assert.match(styles, /prefers-reduced-motion/);
});
