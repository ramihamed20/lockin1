/** Active Study state this device keeps between visits: answer drafts, resume pages and entries. */


/*
 * Focus Active Study keeps the chosen answers on this device until the test is
 * submitted. "Exit & Save" leaves them here as a draft, scoped to the one
 * server attempt, so reopening the checkpoint resumes the same question.
 */
export const ACTIVE_DRAFT_PREFIX = "lock-in.active-study.draft.";

// A result the student left without choosing (Return to pages, a reload) keeps
// the run in one of these stages until they continue or study the part again.
export const ACTIVE_RESULT_STAGES = new Set(["checkpoint_result", "final_result"]);

export function readActiveStudyDraft(attemptId) {
  if (!attemptId) return null;
  try {
    const draft = JSON.parse(window.localStorage.getItem(ACTIVE_DRAFT_PREFIX + attemptId) || "null");
    return draft && typeof draft === "object" && draft.answers && typeof draft.answers === "object" ? draft : null;
  } catch {
    return null;
  }
}

export function writeActiveStudyDraft(attemptId, draft) {
  try { window.localStorage.setItem(ACTIVE_DRAFT_PREFIX + attemptId, JSON.stringify(draft)); } catch { /* storage unavailable */ }
}

export function clearActiveStudyDraft(attemptId) {
  try { window.localStorage.removeItem(ACTIVE_DRAFT_PREFIX + attemptId); } catch { /* storage unavailable */ }
}

/*
 * The answer to "Save your progress?" when leaving a sheet, per run: the page
 * a saved run reopens at, or null for a fresh run that opens at its first page.
 * It outranks the "resume where I left off" setting because the student chose.
 */
export const ACTIVE_RESUME_PREFIX = "lock-in.active-study.resume.";

export function readActiveStudyResume(runId) {
  if (!runId) return undefined;
  try {
    const saved = JSON.parse(window.localStorage.getItem(ACTIVE_RESUME_PREFIX + runId) || "null");
    return saved && typeof saved === "object" && "page" in saved ? saved.page : undefined;
  } catch {
    return undefined;
  }
}

export function writeActiveStudyResume(runId, page) {
  try { window.localStorage.setItem(ACTIVE_RESUME_PREFIX + runId, JSON.stringify({ page })); } catch { /* storage unavailable */ }
}

export function clearActiveStudyResume(runId) {
  try { window.localStorage.removeItem(ACTIVE_RESUME_PREFIX + runId); } catch { /* storage unavailable */ }
}

/*
 * A sheet opens in Normal Study until the student leaves an Active Study run
 * with "Save": then it reopens straight into that difficulty's run. Choosing
 * Normal Study or "Don't Save" returns the sheet to opening in Normal Study.
 */
export const ACTIVE_ENTRY_PREFIX = "lock-in.active-study.entry.";

export function readActiveStudyEntry(key) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ACTIVE_ENTRY_PREFIX + key) || "null");
    return saved && typeof saved.difficulty === "string" ? saved : null;
  } catch {
    return "";
  }
}

export function writeActiveStudyEntry(key, run) {
  try { window.localStorage.setItem(ACTIVE_ENTRY_PREFIX + key, JSON.stringify({ difficulty: run.difficulty, studyMode: run.study_mode || "standard", pagesPerCheckpoint: run.pages_per_checkpoint, questionsPerCheckpoint: run.questions_per_checkpoint })); } catch { /* storage unavailable */ }
}

export function clearActiveStudyEntry(key) {
  try { window.localStorage.removeItem(ACTIVE_ENTRY_PREFIX + key); } catch { /* storage unavailable */ }
}
