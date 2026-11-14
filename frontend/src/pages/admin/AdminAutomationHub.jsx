import { useState } from "react";
import { Link } from "react-router-dom";
import { adminControlApi } from "../../api/adminControl.js";
import { generateIdempotencyKey } from "../../api/pagination.js";
import { ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { sheetTitleFromFilename, validateAutomationFiles } from "../../lib/adminAutomation.js";
import { hasOperationalCapability } from "../../lib/authz.js";
import { AutomationDashboard } from "./AutomationDashboard.jsx";
import { ReferenceLibrary } from "./ReferenceLibrary.jsx";
import "./admin-automation.css";

function pathLabel(item) {
  return [item.college_title, item.specialty_title, item.academic_year_title, item.title].filter(Boolean).join(" / ");
}

export default function AdminAutomationHub({ operationsSession }) {
  const canViewContent = hasOperationalCapability(operationsSession, "content.view");
  const canManage = hasOperationalCapability(operationsSession, "content.manage");
  const canQueue = canManage && hasOperationalCapability(operationsSession, "assessments.view")
    && hasOperationalCapability(operationsSession, "assessments.manage");
  const subjectsData = useAsyncData(
    () => canViewContent ? adminControlApi.contentSubjects({}) : Promise.resolve({ results: [] }),
    [canViewContent]
  );
  const [query, setQuery] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [rows, setRows] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [normal, setNormal] = useState("30");
  const [jobRefresh, setJobRefresh] = useState(0);
  const [queueing, setQueueing] = useState("");
  const [draftPage, setDraftPage] = useState(1);
  const drafts = useAsyncData(
    () => subjectId ? adminControlApi.subjectSheets(subjectId, { status: "draft", page: draftPage }) : Promise.resolve(null),
    [subjectId, draftPage]
  );
  const subjects = subjectsData.data?.results || [];
  const matches = subjects.filter((entry) => pathLabel(entry).toLowerCase().includes(query.trim().toLowerCase()));
  const selected = subjects.find((entry) => entry.id === subjectId);

  function patch(id, change) {
    setRows((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  function chooseSubject(value) {
    setSubjectId(value);
    setDraftPage(1);
    setRows([]);
    setError("");
    setMessage("");
  }

  async function queue(sheet) {
    if (queueing) return;
    setQueueing(sheet.id);
    setError("");
    setMessage("");
    try {
      await adminControlApi.queueAutomationJob({
        job_type: "question_package",
        sheet_id: sheet.id,
        normal_count: Number(normal),
        idempotency_key: generateIdempotencyKey()
      });
      setJobRefresh((value) => value + 1);
      setMessage(`${sheet.title} queued. Open Automation jobs to continue.`);
    } catch (failure) {
      setError(failure.message || "Could not queue this sheet.");
    } finally {
      setQueueing("");
    }
  }

  function chooseFiles(event) {
    setError("");
    try {
      const files = validateAutomationFiles(event.target.files);
      setRows(files.map((file, id) => ({
        id, file, title: sheetTitleFromFilename(file.name), sheetId: "", error: "", status: "queued"
      })));
    } catch (failure) {
      setError(failure.message || "Files could not be selected.");
    }
    event.target.value = "";
  }

  async function uploadDrafts() {
    if (!canManage || !subjectId || uploading) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      for (const item of rows) {
        if (item.sheetId || item.status === "duplicate") continue;
        patch(item.id, { status: "uploading", error: "" });
        try {
          const sheet = await adminControlApi.uploadAutomationDraft(subjectId, item.title, item.file);
          patch(item.id, { status: "draft", sheetId: sheet.id });
        } catch (failure) {
          patch(item.id, {
            status: failure.status === 409 ? "duplicate" : "error",
            error: failure.message || "Could not upload this PDF."
          });
        }
      }
    } finally {
      setUploading(false);
      drafts.reload();
    }
  }

  if (!canViewContent) return <AutomationDashboard />;
  return <div className="admin2-automation">
    <div className="admin2-workflow">
      <section className="admin2-work-card">
        <h3>Academic destination</h3>
        {subjectsData.loading && <LoadingPanel />}
        {subjectsData.error && <ErrorPanel message={subjectsData.errorDetails || subjectsData.error} onRetry={subjectsData.reload} />}
        <label className="field"><span>Find a subject</span><input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="field"><label htmlFor="automation-subject">Destination</label><select id="automation-subject" value={subjectId} disabled={uploading} onChange={(event) => chooseSubject(event.target.value)}>
          <option value="">Choose an existing subject</option>
          {selected && !matches.includes(selected) && <option value={selected.id}>{pathLabel(selected)}</option>}
          {matches.map((subject) => <option key={subject.id} value={subject.id}>{pathLabel(subject)}</option>)}
        </select></div>
        {canQueue && <label className="field"><span>Normal Questions for the next task</span><input type="number" min="0" max="200" step="1" value={normal} onChange={(event) => setNormal(event.target.value)} /></label>}
      </section>
      {canManage && <section className="admin2-work-card">
        <h3>Upload lecture drafts</h3>
        <label className="field"><span>PDF files (20 at a time, up to 50 MB each)</span><input type="file" accept=".pdf,application/pdf" multiple disabled={uploading || !subjectId} onChange={chooseFiles} /></label>
        <button className="btn btn-primary" type="button" disabled={!subjectId || uploading || !rows.some((row) => !row.sheetId && row.status !== "duplicate")} onClick={uploadDrafts}>{uploading ? "Uploading…" : "Upload drafts"}</button>
        {!!rows.length && <ul className="admin2-pipeline">{rows.map((item) => <li className="admin2-pipeline-item" key={item.id}>
          <div className="admin2-row-head"><strong dir="auto">{item.title}</strong><span className="admin2-state">{item.status}</span></div>
          {item.error && <small role="alert" className="admin2-error">{item.error}</small>}
        </li>)}</ul>}
      </section>}
    </div>
    {error && <p role="alert" className="admin2-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {selected && <section className="admin2-work-card">
      <h3>Saved draft sheets</h3>
      {drafts.loading ? <LoadingPanel /> : drafts.error ? <ErrorPanel message={drafts.errorDetails || drafts.error} onRetry={drafts.reload} /> :
        drafts.data?.results.length ? <>
          <ul className="admin2-drafts">{drafts.data.results.map((sheet) => <li key={sheet.id}>
            <span dir="auto">{sheet.title}</span>
            <div className="admin2-pipeline-actions">
              {canQueue && <button className="btn btn-soft compact" type="button" onClick={() => queue(sheet)} disabled={Boolean(queueing) || normal === "" || !Number.isInteger(Number(normal)) || Number(normal) < 0 || Number(normal) > 200}>{queueing === sheet.id ? "Queueing…" : "Queue AI task"}</button>}
              <Link to={`/operations/admin/content?subject=${encodeURIComponent(subjectId)}&sheet=${encodeURIComponent(sheet.id)}`}>Open sheet</Link>
            </div>
          </li>)}</ul>
          <div className="admin2-pipeline-actions">
            <button type="button" className="btn btn-soft compact" disabled={!drafts.data.previous} onClick={() => setDraftPage(draftPage - 1)}>Previous drafts</button>
            <button type="button" className="btn btn-soft compact" disabled={!drafts.data.next} onClick={() => setDraftPage(draftPage + 1)}>Next drafts</button>
          </div>
        </> : <p>No draft sheets for this subject.</p>}
    </section>}
    <AutomationDashboard subjects={subjects} refresh={jobRefresh} />
    {selected && <ReferenceLibrary key={selected.id} subjectId={selected.source_node_id || selected.id} canManage={canManage} onQueued={() => setJobRefresh((value) => value + 1)} />}
  </div>;
}
