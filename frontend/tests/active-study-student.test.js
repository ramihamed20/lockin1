import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { visiblePdfPages } from "../src/workspace/catalog/visiblePdfPages.js";

const [workspace, continuousPdf, api, study, profile] = await Promise.all([
  readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/workspace/catalog/ContinuousA4Pdf.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/api/focus.js", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/LearningObjectStudy.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Profile.jsx", import.meta.url), "utf8")
]);

test("Active Study keeps previously unlocked pages in the primary PDF reader", () => {
  assert.deepEqual(visiblePdfPages(20, 1, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(visiblePdfPages(20, 18, 40), [18, 19, 20]);
  assert.match(workspace, /const accessiblePageStart = 1/);
  assert.match(workspace, /const accessiblePageCount = activePageRange\?\.end_page \|\| pageCount/);
  assert.match(workspace, /visiblePageStart=\{accessiblePageStart\}/);
  assert.match(workspace, /visiblePageCount=\{accessiblePageCount\}/);
  assert.match(workspace, /Math\.max\(accessiblePageStart, Number\(nextPage\)/);
  assert.match(continuousPdf, /visiblePdfPages\(pageCount, visiblePageStart, visiblePageCount\)/);
});

test("managed Active Study is unified with the old one-question quiz experience", () => {
  for (const name of [
    "startManagedActiveStudy",
    "getManagedActiveStudyQuestions",
    "answerManagedActiveStudyQuestion",
    "submitManagedActiveStudy"
  ]) assert.match(workspace, new RegExp(`focusApi\\.${name}`));
  assert.match(workspace, /function ActiveStudyQuiz/);
  assert.match(workspace, /Question \{index \+ 1\} of \{quiz\.questions\.length\}/);
  assert.match(workspace, />Previous</);
  assert.match(workspace, />Next/);
  assert.match(workspace, /workspace-v2-quiz-progress/);
  assert.match(workspace, /managedActiveStudyAction\(activeStudy\.id, "complete-reading"\)/);
  assert.match(workspace, /result\.passed/);
  assert.match(workspace, /run\?\.stage === "final"/);
});

test("Active Study has one reader and no iframe or parallel legacy client", () => {
  assert.equal((workspace.match(/<ContinuousA4Pdf\b/g) || []).length, 1);
  assert.doesNotMatch(workspace, /ActiveStudyPlayer|<iframe/);
  assert.doesNotMatch(study, /ActiveStudyPlayer|<iframe/);
  for (const legacyName of ["startActiveStudy", "getActiveStudyQuiz", "submitActiveStudyQuiz", "continueActiveStudy"]) {
    assert.doesNotMatch(api, new RegExp(legacyName));
  }
});

test("Profile hides future customization, companion, and wallet surfaces without disturbing core account areas", () => {
  for (const hiddenKey of ["profile.yourWorkspace", "profile.studyCompanion", "profile.storeWallet"]) {
    assert.doesNotMatch(profile, new RegExp(hiddenKey.replace(".", "\\.")));
  }
  assert.match(profile, /ProfilePictureEditor/);
  assert.match(profile, /College, specialty and year/);
  assert.match(profile, /Change specialty \/ study path/);
  assert.match(profile, /AccountFieldErrors/);
});
