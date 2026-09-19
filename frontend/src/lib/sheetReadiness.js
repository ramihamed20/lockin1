// What a sheet still needs before a student gets the full experience, said as
// the thing to do rather than as a state. Everything here is read from the
// admin sheet list the server already returns -- no extra requests -- and the
// server remains the authority: publishing and Active Study still validate on
// save. Active Study's per-part question counts need the sheet's own plan, so
// they are reported inside its Active Study panel, not here.

/**
 * @typedef {{ code: string, tone: "blocker" | "warning" | "info", label: string, detail: string }} ReadinessIssue
 * @typedef {{ state: "ready" | "attention" | "draft" | "blocked", label: string, issues: ReadinessIssue[] }} SheetReadiness
 */

/** @param {number} count @param {string} one @param {string} many */
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * @param {Record<string, any>} sheet a row from the admin sheet list
 * @returns {SheetReadiness}
 */
export function sheetReadiness(sheet) {
  /** @type {ReadinessIssue[]} */
  const issues = [];
  const status = String(sheet?.workflow_status || "");
  const published = status === "published";
  const archived = status === "archived";
  const questions = Number(sheet?.question_count) || 0;
  const liveQuestions = Number(sheet?.published_question_count) || 0;

  if (archived) {
    return { state: "draft", label: "Archived", issues: [] };
  }
  if (!sheet?.pdf) {
    issues.push({ code: "missing-pdf", tone: "blocker", label: "Missing PDF", detail: "Upload the University Sheet PDF before this sheet can be published." });
  }
  if (published && sheet?.student_visible === false) {
    issues.push({ code: "unreachable", tone: "blocker", label: "Not reachable by students", detail: "It is published, but no cohort's catalog includes this subject, so no student can open it." });
  }
  if (questions === 0) {
    issues.push({ code: "no-questions", tone: "warning", label: "Needs questions", detail: "Import a question batch so students can practise this sheet." });
  } else if (liveQuestions === 0) {
    issues.push({ code: "questions-unpublished", tone: "warning", label: "Questions not published", detail: `${plural(questions, "question is", "questions are")} saved as drafts; students see none of them yet.` });
  } else if (liveQuestions < questions) {
    issues.push({ code: "questions-partly-published", tone: "info", label: `${liveQuestions} of ${questions} questions live`, detail: `${plural(questions - liveQuestions, "question is", "questions are")} still a draft.` });
  }
  const summary = sheet?.summary_pdf;
  if (summary && summary.deliverable === false) {
    issues.push({ code: "summary-scanning", tone: "warning", label: "Summary not deliverable yet", detail: "The Sheet Summary PDF is still being validated or scanned; students see it as unavailable." });
  } else if (summary && published && summary.student_visible === false) {
    issues.push({ code: "summary-draft", tone: "warning", label: "Summary only on the draft", detail: "Publish the sheet again to release its Sheet Summary to students." });
  }

  if (issues.some((issue) => issue.tone === "blocker")) {
    return { state: "blocked", label: issues.find((issue) => issue.tone === "blocker")?.label || "Blocked", issues };
  }
  if (!published) {
    return { state: "draft", label: "Draft · hidden from students", issues };
  }
  if (issues.some((issue) => issue.tone === "warning")) {
    return { state: "attention", label: "Needs attention", issues };
  }
  return { state: "ready", label: "Ready", issues };
}

/**
 * Counts for a list header: how many sheets are ready, and how many need work.
 * @param {Record<string, any>[]} sheets
 */
export function readinessSummary(sheets) {
  const summary = { ready: 0, attention: 0, blocked: 0, draft: 0 };
  for (const sheet of sheets || []) summary[sheetReadiness(sheet).state] += 1;
  return summary;
}
