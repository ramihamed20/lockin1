import { useState } from "react";
import { adminControlApi } from "../../api/adminControl.js";
import { ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { readAllQuestionsFile } from "../../lib/allQuestionsImport.js";
import { parseAllQuestionsJson } from "../../lib/allQuestionsPrompt.js";
import { AllQuestionsPreview } from "./AllQuestionsPreview.jsx";

export function QuestionJobReview({ job, canRun, onChange }) {
  const saved = useAsyncData(
    (signal) => job.status === "needs_review" ? adminControlApi.automationCandidate(job.id, signal) : Promise.resolve(null),
    [job.id, job.status, job.revision]
  );
  const [edit, setEdit] = useState(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [flags, setFlags] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const candidate = saved.data?.revision === job.revision ? saved.data.payload : null;
  const ready = job.status === "ready_for_ai" || job.status === "processing" || job.status === "needs_review";

  async function run(action, payload = null) {
    setPending(action);
    setError("");
    setFlags([]);
    try {
      if (action === "validate") {
        await adminControlApi.validateAutomationCandidate(job.id, payload, job.revision);
      } else {
        await adminControlApi.reviewAutomationCandidate(job.id, action, job.revision);
      }
      setEdit(null);
      setConfirmed(false);
      onChange();
    } catch (failure) {
      setError(failure.message);
      setFlags(failure.payload?.errors || []);
    } finally {
      setPending("");
    }
  }

  async function load(file) {
    if (!file) return;
    setPending("reading");
    try {
      const text = await readAllQuestionsFile(file);
      setEdit(text);
      setConfirmed(false);
      setError("");
      setFlags([]);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending("");
    }
  }

  function validate() {
    try {
      void run("validate", parseAllQuestionsJson(edit));
    } catch (failure) {
      setError(failure.message);
    }
  }

  return <section className="admin2-work-card">
    <h4>Question review</h4>
    {!!job.output?.visual_review_pages?.length && <p>Inspect these PDF pages visually before approval. {job.output.visual_review_pages.join(", ")}.</p>}
    {!!job.output?.reference_sections?.length && <details><summary>Reference sections supplied to the operator</summary><ul>
      {job.output.reference_sections.map((row) => <li key={`${row.reference_id}-${row.page}`}>{row.title} · page {row.page} · revision {row.revision}</li>)}
    </ul></details>}
    {job.status === "needs_review" && saved.loading && <LoadingPanel />}
    {saved.error && <ErrorPanel message={saved.errorDetails || saved.error} onRetry={saved.reload} />}
    {candidate && <AllQuestionsPreview payload={candidate} />}
    {canRun && ready && <>
      {job.status === "ready_for_ai" && <button type="button" className="btn btn-soft compact" disabled={Boolean(pending)} onClick={() => run("start")}>Mark Antigravity started</button>}
      <label className="field"><span>AI question JSON</span><input type="file" accept=".json,.txt,application/json,text/plain" disabled={Boolean(pending)} onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        void load(file);
      }} /></label>
      {candidate && edit === null && <button type="button" className="btn btn-soft compact" disabled={Boolean(pending)} onClick={() => {
        setEdit(JSON.stringify(candidate, null, 2));
        setConfirmed(false);
      }}>Edit question JSON</button>}
      {edit !== null && <>
        <label className="field"><span>Review and correct the question document</span><textarea rows={12} dir="ltr" spellCheck={false} value={edit} onChange={(event) => setEdit(event.target.value)} /></label>
        <button type="button" className="btn btn-soft compact" disabled={Boolean(pending) || !edit.trim()} onClick={validate}>Validate edits</button>
      </>}
      {candidate && edit === null && <>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed the questions and any flagged pages against the original PDF.</label>
        <div className="admin2-pipeline-actions">
          <button type="button" className="btn btn-primary compact" disabled={Boolean(pending) || !confirmed || saved.refreshing} onClick={() => run("approve")}>Approve draft import</button>
          <button type="button" className="btn btn-soft compact" disabled={Boolean(pending) || saved.refreshing} onClick={() => run("reject")}>Reject candidate</button>
        </div>
      </>}
    </>}
    {error && <p role="alert">{error}</p>}
    {!!flags.length && <ul>{flags.map((flag, index) => <li key={`${flag.path}-${index}`}>{flag.path} · {flag.message}</li>)}</ul>}
  </section>;
}
