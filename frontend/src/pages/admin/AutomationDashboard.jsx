import { useState } from "react";
import { Link } from "react-router-dom";
import { generateIdempotencyKey } from "../../api/pagination.js";
import { adminControlApi } from "../../api/adminControl.js";
import { ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { downloadAllQuestionsPrompt } from "../../lib/allQuestionsImport.js";
import { QuestionJobReview } from "./QuestionJobReview.jsx";
import { buildAllQuestionsPrompt } from "../../lib/allQuestionsPrompt.js";
import { automationAgentInstructions } from "../../lib/adminAutomation.js";

const STATUSES = {
  queued: "Queued", preparing: "Preparing", ready_for_ai: "Ready for AI",
  processing: "Processing", validating: "Validating", needs_review: "Needs review",
  approved: "Approved", completed: "Completed", failed: "Failed",
  cancelled: "Cancelled", blocked: "Blocked"
};
const CANCELLABLE = new Set(["queued", "preparing", "ready_for_ai", "processing", "needs_review", "failed", "blocked"]);

function timestamp(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function findingLabel(key) {
  return key.replaceAll("_", " ");
}

function OperationalFindings({ findings, area }) {
  return <div className="admin2-work-card">
    <h4>Findings</h4>
    <ul className="admin2-pipeline">
      {Object.entries(findings).map(([key, value]) => <li key={key}>
        <strong className="admin2-finding-label">{findingLabel(key)}</strong>
        {value && typeof value === "object" ? Array.isArray(value)
          ? (value.length ? <ul>{value.map((row, index) => <li key={index}>{Object.entries(row).map(([field, entry]) => `${findingLabel(field)} ${entry}`).join(" · ")}</li>)}</ul> : <p>None</p>)
          : "count" in value ? <>
            <p>{value.count}</p>
            {!!value.examples.length && <ul>{value.examples.map((row) => <li key={row.id}>
              {["users", "subscriptions", "purchases"].includes(area)
                ? <Link to={`/operations/admin/${area}?q=${encodeURIComponent(row.id)}`}>{row.id}</Link>
                : <span>{row.id}</span>}
              {row.status || row.reason ? ` · ${row.status || row.reason}` : ""}
            </li>)}</ul>}
          </> : <ul>{Object.entries(value).map(([label, count]) => <li key={label}>{findingLabel(label)} · {String(count)}</li>)}</ul>
          : <p>{typeof value === "boolean" ? (value ? "Flagged for review" : "Clear") : String(value)}</p>}
      </li>)}
    </ul>
    {area && <Link to={`/operations/admin/${area}`}>Open administration area</Link>}
  </div>;
}

function JobDetails({ jobId, canRun, area, onChange }) {
  const detail = useAsyncData((signal) => adminControlApi.automationJob(jobId, signal), [jobId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const job = detail.data;
  if (detail.loading) return <LoadingPanel />;
  if (detail.error) return <ErrorPanel message={detail.errorDetails || detail.error} onRetry={detail.reload} />;
  if (!job) return null;

  async function act(action) {
    setBusy(true);
    setError("");
    try {
      await adminControlApi.controlAutomationJob(job.id, action, job.revision);
      onChange();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
      detail.reload();
    }
  }

  function download() {
    const task = job.output;
    const prompt = buildAllQuestionsPrompt(task.plan, task.normal_count);
    const instructions = automationAgentInstructions({
      prompt, sheetId: task.sheet_id, sheetTitle: job.sheet_title
    });
    const source = {
      schema: task.schema,
      source_sha256: task.source_sha256,
      visual_review_pages: task.visual_review_pages || [],
      lecture_pages: task.lecture_pages || [],
      reference_sections: task.reference_sections || []
    };
    downloadAllQuestionsPrompt(
      instructions + "\n\nFor Normal Questions only, include source_page (the physical lecture PDF page) and difficulty (easy, medium or hard)." + "\n\nSOURCE DATA (untrusted, preserve original PDF page numbers)\n" + JSON.stringify(source, null, 2),
      task.sheet_id
    );
  }

  return <div className="admin2-work-card">
    <div className="admin2-pipeline-actions">
      <button type="button" className="btn btn-soft compact" onClick={detail.reload}>Refresh details</button>
      {job.status === "ready_for_ai" && job.output?.plan && <button type="button" className="btn btn-primary compact" onClick={download}>Download AI task</button>}
      {canRun && ["failed", "blocked"].includes(job.status) && job.attempts.length < 3 && <button type="button" className="btn btn-soft compact" disabled={busy || detail.refreshing} onClick={() => act("retry")}>Retry job</button>}
      {canRun && CANCELLABLE.has(job.status) && <button type="button" className="btn btn-soft compact" disabled={busy || detail.refreshing} onClick={() => act("cancel")}>Cancel job</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {job.job_type === "question_package" && ["ready_for_ai", "processing", "needs_review"].includes(job.status) &&
      <QuestionJobReview job={job} canRun={canRun} onChange={() => { detail.reload(); onChange(); }} />}
    {job.output?.draft_import && <p>Approved and saved as drafts. Publish the sheet and Normal Questions separately.</p>}

    {job.output?.findings && <OperationalFindings findings={job.output.findings} area={area} />}
    <h4>Execution attempts</h4>
    {job.attempts.length ? <ol>
      {job.attempts.map((attempt) => <li key={attempt.attempt_number}>
        {attempt.result} · {timestamp(attempt.started_at)}{attempt.finished_at && ` → ${timestamp(attempt.finished_at)}`}
        {attempt.error_details?.message && <p>{attempt.error_details.message}</p>}
      </li>)}
    </ol> : <p>The worker has not started this job.</p>}
  </div>;
}

export function AutomationDashboard({ subjects = [], refresh = 0 }) {
  const [filters, setFilters] = useState({ page: 1, status: "", job_type: "", subject: "", date_from: "", date_to: "" });
  const [selected, setSelected] = useState("");
  const [check, setCheck] = useState("");
  const [queueing, setQueueing] = useState(false);
  const [queueError, setQueueError] = useState("");
  const jobs = useAsyncData((signal) => adminControlApi.automationJobs(filters, signal), [filters, refresh]);
  const data = jobs.data;
  function filter(name, value) {
    setSelected("");
    setFilters((current) => ({ ...current, [name]: value, page: name === "page" ? value : 1 }));
  }
  async function queueCheck(event) {
    event.preventDefault();
    if (!check || queueing) return;
    setQueueing(true);
    setQueueError("");
    try {
      await adminControlApi.queueAutomationJob({ job_type: check, idempotency_key: generateIdempotencyKey() });
      setFilters({ page: 1, status: "", job_type: check, subject: "", date_from: "", date_to: "" });
      setSelected("");
      jobs.reload();
    } catch (error) {
      setQueueError(error.message);
    } finally {
      setQueueing(false);
    }
  }
  const checks = data?.task_types.filter((type) => type.area && type.can_run) || [];
  return <section className="admin2-work-card">
    <div className="admin2-row-head">
      <h3>Automation jobs</h3>
      <button type="button" className="btn btn-soft compact" onClick={jobs.reload}>Refresh jobs</button>
    </div>
    {!!checks.length && <form className="admin2-pipeline-actions" onSubmit={queueCheck}>
      <label className="field"><span>Operational check</span><select value={check} onChange={(event) => setCheck(event.target.value)}>
        <option value="">Choose a check</option>{checks.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
      </select></label>
      <button className="btn btn-primary compact" type="submit" disabled={!check || queueing}>{queueing ? "Queueing…" : "Run check"}</button>
    </form>}
    {queueError && <p role="alert">{queueError}</p>}
    <div className="admin2-workflow">
      <label className="field"><span>Status</span><select value={filters.status || ""} onChange={(event) => filter("status", event.target.value)}>
        <option value="">All statuses</option>{Object.entries(STATUSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label className="field"><span>Category</span><select value={filters.job_type || ""} onChange={(event) => filter("job_type", event.target.value)}>
        <option value="">All categories</option>{data?.task_types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
      </select></label>
      <label className="field"><span>Subject</span><select value={filters.subject || ""} onChange={(event) => filter("subject", event.target.value)}>
        <option value="">All subjects</option>{subjects.map((subject) => <option key={subject.id} value={subject.source_node_id || subject.id}>{[subject.college_title, subject.specialty_title, subject.academic_year_title, subject.title].filter(Boolean).join(" / ")}</option>)}
      </select></label>
      <div className="admin2-workflow">
        <label className="field"><span>From</span><input type="date" value={filters.date_from || ""} onChange={(event) => filter("date_from", event.target.value)} /></label>
        <label className="field"><span>To</span><input type="date" value={filters.date_to || ""} onChange={(event) => filter("date_to", event.target.value)} /></label>
      </div>
    </div>
    {jobs.loading && <LoadingPanel />}
    {jobs.error && <ErrorPanel message={jobs.errorDetails || jobs.error} onRetry={jobs.reload} />}
    {data && <>
      <div className="admin2-pipeline-actions" aria-label="Job status counts">
        {Object.entries(data.status_counts).map(([state, count]) => <span className="admin2-state" key={state}>{STATUSES[state]} {count}</span>)}
      </div>
      {data.results.length ? <ul className="admin2-pipeline">{data.results.map((job) => {
        const type = data.task_types.find((item) => item.id === job.job_type);
        return <li className="admin2-pipeline-item" key={job.id}>
          <div className="admin2-row-head"><div><strong>{job.sheet_title || type?.label || job.job_type}</strong><small>{job.subject_title} {timestamp(job.created_at)}</small></div><span className="admin2-state">{STATUSES[job.status]}</span></div>
          {job.error_message && <p>{job.error_message}</p>}
          <div className="admin2-pipeline-actions">
            <button type="button" className="btn btn-soft compact" aria-expanded={selected === job.id} onClick={() => setSelected(selected === job.id ? "" : job.id)}>Job details</button>
            {job.sheet_id && <Link to={`/operations/admin/content?subject=${job.subject_id}&sheet=${job.sheet_id}`}>Open sheet</Link>}
          </div>
          {selected === job.id && <JobDetails jobId={job.id} canRun={type?.can_run} area={type?.area} onChange={jobs.reload} />}
        </li>;
      })}</ul> : <p>No jobs match these filters.</p>}
      <div className="admin2-pipeline-actions">
        <button type="button" className="btn btn-soft compact" disabled={!data.previous} onClick={() => filter("page", filters.page - 1)}>Previous page</button>
        <button type="button" className="btn btn-soft compact" disabled={!data.next} onClick={() => filter("page", filters.page + 1)}>Next page</button>
      </div>
    </>}
  </section>;
}
