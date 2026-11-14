import { useState } from "react";
import { adminControlApi } from "../../api/adminControl.js";
import { generateIdempotencyKey } from "../../api/pagination.js";
import { ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";

const TYPES = {
  past_exam: "Previous-year exam", professor_sample: "Professor sample", textbook: "Textbook",
  supplement: "Lecture supplement", question_bank: "Question bank", answer_key: "Answer key",
  instructions: "Exam instructions"
};

function pdfUrl(subjectId, referenceId) {
  return `/api/v1/operations/admin/automation/subjects/${subjectId}/references/${referenceId}/pdf`;
}

function ReferenceHistory({ subjectId, referenceId }) {
  const history = useAsyncData((signal) => adminControlApi.automationReferenceHistory(subjectId, referenceId, signal), [subjectId, referenceId]);
  if (history.loading) return <LoadingPanel />;
  if (history.error) return <ErrorPanel message={history.errorDetails || history.error} onRetry={history.reload} />;
  return <ul>{history.data.results.map((row) => <li key={row.id}>
    Revision {row.revision} · {row.title} {row.pdf_available && <a href={pdfUrl(subjectId, row.id)}>Download PDF</a>}
  </li>)}</ul>;
}

export function ReferenceLibrary({ subjectId, canManage, onQueued }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ page: 1, q: "", kind: "", tag: "" });
  const [previous, setPrevious] = useState(null);
  const [historyId, setHistoryId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const references = useAsyncData((signal) => adminControlApi.automationReferences(subjectId, filters, signal), [subjectId, filters]);
  const data = references.data;
  function filter(name, value) {
    setFilters((current) => ({ ...current, [name]: value, page: name === "page" ? value : 1 }));
  }

  async function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set("idempotency_key", generateIdempotencyKey());
    if (previous) {
      body.set("previous_id", previous.id);
      body.set("expected_revision", String(previous.revision));
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await adminControlApi.uploadAutomationReference(subjectId, body);
      form.reset();
      setPrevious(null);
      setMessage("Reference saved. Track text extraction in Automation jobs.");
      references.reload();
      onQueued();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="admin2-work-card">
    <h3>Subject reference library</h3>
    <form className="admin2-pipeline-actions" onSubmit={(event) => { event.preventDefault(); filter("q", query.trim()); }}>
      <label className="field"><span>Find reference text</span><input type="search" maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="field"><span>Document type</span><select value={filters.kind} onChange={(event) => filter("kind", event.target.value)}>
        <option value="">All types</option>{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="field"><span>Topic tag</span><input type="search" maxLength={60} value={filters.tag} onChange={(event) => filter("tag", event.target.value)} /></label>
      <button type="submit" className="btn btn-soft compact">Search references</button>
      <button type="button" className="btn btn-soft compact" onClick={references.reload}>Refresh references</button>
    </form>
    {canManage && <details open={previous ? true : undefined}>
      <summary>{previous ? `Replace revision ${previous.revision} of ${previous.title}` : "Upload reference"}</summary>
      <form key={previous?.id || "new"} className="admin2-work-card" onSubmit={upload}>
        <label className="field"><span>Reference title</span><input name="title" required maxLength={220} defaultValue={previous?.title || ""} /></label>
        <label className="field"><span>Reference type</span><select name="kind" defaultValue={previous?.kind || "past_exam"}>
          {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="field"><span>Topic tags, separated by commas</span><input name="tags" maxLength={600} defaultValue={previous?.tags.join(", ") || ""} /></label>
        <label className="field"><span>Reference PDF</span><input type="file" name="pdf" required accept=".pdf,application/pdf" /></label>
        <div className="admin2-pipeline-actions">
          <button className="btn btn-primary compact" disabled={saving} type="submit">{saving ? "Uploading…" : "Save reference"}</button>
          {previous && <button type="button" className="btn btn-soft compact" disabled={saving} onClick={() => setPrevious(null)}>Cancel replacement</button>}
        </div>
      </form>
    </details>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {references.loading && <LoadingPanel />}
    {references.error && <ErrorPanel message={references.errorDetails || references.error} onRetry={references.reload} />}
    {data && <>
      {data.results.length ? <ul className="admin2-pipeline">{data.results.map((reference) => <li className="admin2-pipeline-item" key={reference.id}>
        <strong dir="auto">{reference.title}</strong>
        <p>{TYPES[reference.kind]} · Revision {reference.revision} · {reference.page_count} pages · {reference.indexed_at ? "Indexed" : "Text index unavailable"}</p>
        {!!reference.tags.length && <small dir="auto">{reference.tags.join(" · ")}</small>}
        <div className="admin2-pipeline-actions">
          {reference.pdf_available && <a href={pdfUrl(subjectId, reference.id)}>Download PDF</a>}
          {canManage && <button type="button" className="btn btn-soft compact" disabled={saving} onClick={() => setPrevious(reference)}>Upload revision</button>}
          <button type="button" className="btn btn-soft compact" aria-expanded={historyId === reference.id} onClick={() => setHistoryId(historyId === reference.id ? "" : reference.id)}>Revision history</button>
        </div>
        {historyId === reference.id && <ReferenceHistory subjectId={subjectId} referenceId={reference.id} />}
      </li>)}</ul> : <p>No references match this subject and filters.</p>}
      {!!data.matches.length && <ul className="admin2-pipeline">{data.matches.map((match) => <li key={`${match.reference_id}-${match.page}`}>
        <strong>{match.title} · page {match.page}</strong><p dir="auto">{match.excerpt}</p>
      </li>)}</ul>}
      <div className="admin2-pipeline-actions">
        <button type="button" className="btn btn-soft compact" disabled={!data.previous} onClick={() => filter("page", filters.page - 1)}>Previous page</button>
        <button type="button" className="btn btn-soft compact" disabled={!data.next} onClick={() => filter("page", filters.page + 1)}>Next page</button>
      </div>
    </>}
  </section>;
}
