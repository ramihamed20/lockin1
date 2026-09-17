import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { visiblePdfPages } from "../src/workspace/catalog/visiblePdfPages.js";

const [workspace, workspaceStyles, continuousPdf, api, study, profile] = await Promise.all([
  readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/catalog-focus-workspace.css", import.meta.url), "utf8"),
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
  assert.match(workspace, /activeStudy\.stage === "checkpoint" \|\| activeStudy\.stage === "final"/);
  assert.match(workspace, /result\.passed/);
  assert.doesNotMatch(workspace, /if \(run\?\.stage === "final"\)[\s\S]*loadManagedQuestions/);
});

test("Active Study starts the selected difficulty in reading, then opens its checkpoint only from the dock", () => {
  // A run belongs to the edition being read, so its page numbers match the PDF.
  assert.match(workspace, /startManagedActiveStudy\(\{ sheetId: sheet\.learningObjectId, difficulty: activeDifficulty, edition: sheetEdition\?\.edition \}\)/);
  assert.match(workspace, /getManagedActiveStudyAvailability\(sheet\.learningObjectId, sheetEdition\?\.edition\)/);
  assert.match(workspace, /selectedActiveStudyAvailability\?\.status === "ready"/);
  assert.doesNotMatch(workspace, /inProgress\?\.difficulty \|\| activeDifficulty/);
  assert.match(workspace, /setPage\(1\);[\s\S]*resetReaderToPageOne\(\)/);
  assert.doesNotMatch(workspace, /if \(run\.stage === "checkpoint" \|\| run\.stage === "final"\) await loadManagedQuestions\(run\)/);
  assert.match(workspace, /const activeStudyButtonReady = studyMode === "active"/);
  assert.match(workspace, /\["reading", "checkpoint", "final"\]\.includes\(activeStudy\.stage\)/);
  assert.match(workspace, /disabled=\{activeStudyBusy \|\| !activeStudyButtonReady\}/);
  assert.match(workspace, /managedActiveStudyAction\(activeStudy\.id, "complete-reading"\)/);
  assert.match(workspace, /activeStudy\.stage === "final" \? "Final Exam" : "Checkpoint"/);
  assert.match(workspace, /const \[page, setPage\] = useState\(1\)/);
  assert.doesNotMatch(workspace, /setPage\(Math\.max\(1, view\.page\)\)/);
  assert.match(workspaceStyles, /\.workspace-v2-checkpoint-dock \{[^}]+right: 0;[^}]+left: auto;/);
});

test("Active Study quiz surfaces inherit the current application theme", () => {
  const themedQuiz = workspaceStyles.slice(
    workspaceStyles.indexOf(".workspace-v2-mode-backdrop"),
    workspaceStyles.indexOf("@keyframes workspace-options-in")
  );
  assert.match(themedQuiz, /workspace-v2-quiz-backdrop[^}]+var\(--workspace-overlay/);
  assert.match(themedQuiz, /workspace-v2-quiz-dialog,[\s\S]+background: var\(--workspace-panel\)/);
  assert.match(themedQuiz, /workspace-v2-quiz-dialog > main[^}]+background: var\(--workspace-panel-2\)/);
  assert.match(themedQuiz, /workspace-v2-answer-list button[^}]+color: var\(--workspace-chrome-text\)[^}]+background: var\(--workspace-control-bg\)/);
  assert.match(themedQuiz, /workspace-v2-answer-list button\.is-selected[^}]+var\(--workspace-gold\)/);
  assert.match(themedQuiz, /workspace-v2-quiz-progress span[^}]+background: var\(--workspace-gold\)/);
  assert.match(themedQuiz, /workspace-v2-result-actions button\.is-primary[^}]+color: var\(--workspace-on-accent\)/);
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
