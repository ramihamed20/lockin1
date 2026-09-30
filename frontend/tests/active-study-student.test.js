import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeStudyResumePage, visiblePdfPages } from "../src/workspace/catalog/visiblePdfPages.js";

const [workspace, workspaceStyles, continuousPdf, api, study, profile, catalogue] = await Promise.all([
  readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/catalog-focus-workspace.css", import.meta.url), "utf8"),
  readFile(new URL("../src/workspace/catalog/ContinuousA4Pdf.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/api/focus.js", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/LearningObjectStudy.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Profile.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8")
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

test("unlocking a part keeps the reader in place and resume lands on the latest part", () => {
  const part2 = { part: 2, start_page: 7, end_page: 12 };
  assert.equal(activeStudyResumePage(part2), 7);
  assert.equal(activeStudyResumePage(part2, { savedPage: 9 }), 9);
  assert.equal(activeStudyResumePage(part2, { savedPage: 3 }), 7);
  assert.equal(activeStudyResumePage(part2, { savedPage: 13 }), 7);
  assert.equal(activeStudyResumePage(part2, { stage: "checkpoint" }), 12);
  assert.equal(activeStudyResumePage(null), 1);
  // Opening a test remembers the reading position; closing it or unlocking
  // the next part returns there instead of resetting to page one.
  assert.match(workspace, /quizReaderAnchorRef\.current = captureReaderAnchor\(\)/);
  assert.match(workspace, /if \(run\?\.stage === "reading" \|\| run\?\.stage === "final"\) returnReaderFromQuiz\(\)/);
  const continueAnyway = workspace.slice(workspace.indexOf("async function continueActiveStudyAnyway"), workspace.indexOf("async function retakeActiveQuiz"));
  assert.match(continueAnyway, /returnReaderFromQuiz\(\)/);
  assert.doesNotMatch(continueAnyway, /resetReaderToPageOne/);
});

test("managed Active Study is unified with the old one-question quiz experience", () => {
  for (const name of [
    "startManagedActiveStudy",
    "getManagedActiveStudyQuestions",
    "answerManagedActiveStudyQuestion",
    "submitManagedActiveStudy"
  ]) assert.match(workspace, new RegExp(`focusApi\\.${name}`));
  assert.match(workspace, /function ActiveStudyQuiz/);
  // The checkpoint reads in the interface language; the English copy is
  // unchanged, so it is asserted in the catalogue rather than the source.
  assert.match(workspace, /t\("activeStudy\.questionOf", \{ index: index \+ 1, total: quiz\.questions\.length \}\)/);
  assert.match(workspace, /t\("activeStudy\.previous"\)/);
  assert.match(workspace, /t\("activeStudy\.next"\)/);
  assert.match(catalogue, /"activeStudy\.questionOf": "Question \{index\} of \{total\}"/);
  assert.match(catalogue, /"activeStudy\.previous": "Previous"/);
  assert.match(catalogue, /"activeStudy\.next": "Next"/);
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
  // A resumed run returns to its latest unlocked part rather than page one.
  assert.match(workspace, /placeReaderAt\(payload\.resumed\s*\? activeStudyResumePage\(run\.current_page_range/);
  assert.doesNotMatch(workspace, /if \(run\.stage === "checkpoint" \|\| run\.stage === "final"\) await loadManagedQuestions\(run\)/);
  assert.match(workspace, /const activeStudyButtonReady = studyMode === "active"/);
  assert.match(workspace, /\["reading", "checkpoint", "final"\]\.includes\(activeStudy\.stage\)/);
  assert.match(workspace, /disabled=\{activeStudyBusy \|\| !activeStudyButtonReady\}/);
  assert.match(workspace, /managedActiveStudyAction\(activeStudy\.id, "complete-reading"\)/);
  // The final exam and a final result left open both read "Final Exam".
  assert.match(workspace, /t\(activeStudy\.stage\.startsWith\("final"\) \? "activeStudy\.finalExam" : "activeStudy\.checkpoint"\)/);
  // A result the student left without choosing keeps the dock and reopens that result.
  assert.match(workspace, /const ACTIVE_RESULT_STAGES = new Set\(\["checkpoint_result", "final_result"\]\)/);
  assert.match(workspace, /if \(ACTIVE_RESULT_STAGES\.has\(activeStudy\.stage\)\) \{[\s\S]*?setActiveResult\(/);
  // Answers the server holds stay fixed, and a failed submit resyncs from the server.
  assert.match(workspace, /if \(!locked\[question\.id\]\) setAnswers/);
  assert.match(workspace, /getManagedActiveStudyQuestions\(activeStudy\.id\)\.catch\(\(\) => null\)/);
  assert.match(catalogue, /"activeStudy\.finalExam": "Final Exam"/);
  assert.match(catalogue, /"activeStudy\.checkpoint": "Checkpoint"/);
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
  // The study path controls are localised: the words live in the catalogue in
  // both languages, and the page reads them through t().
  assert.match(profile, /t\("profile\.studyPathTitle"\)/);
  assert.match(profile, /t\("profile\.changeStudyPath"\)/);
  assert.match(catalogue, /"profile\.studyPathTitle": "College, specialty and year"/);
  assert.match(catalogue, /"profile\.changeStudyPath": "Change specialty \/ study path"/);
  assert.equal(catalogue.split('"profile.changePathMessage":').length - 1, 2, "the progress-reset warning exists in English and Arabic");
  assert.match(profile, /AccountFieldErrors/);
});
