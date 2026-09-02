import { useEffect, useState } from "react";
import { moderationApi } from "../api/community.js";
import { Icon } from "../lib/icons.jsx";
import { formatDateTime } from "../lib/i18n.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page, SelectableRow } from "../components/ui/index.jsx";

const REPORT_STATUSES = ["open", "triaged", "in_progress", "resolved", "rejected", "duplicate"];
const ACTION_STATUSES = ["triaged", "in_progress", "resolved", "rejected"];

function humanize(value, fallback = "Unavailable") {
  return typeof value === "string" && value ? value.replaceAll("_", " ") : fallback;
}

function mergeReports(current, incoming) {
  const byId = new Map(current.map((report) => [report.id, report]));
  incoming.forEach((report) => byId.set(report.id, report));
  return [...byId.values()];
}

function ReportDetail({ report, user, onClose, onUpdated }) {
  const [status, setStatus] = useState("triaged");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const needsResolution = ["resolved", "rejected"].includes(status);

  async function assignToMe() {
    setPending("assign");
    setError("");
    try {
      const updated = await moderationApi.assignReport(report.id, { expectedRevision: report.revision, assigneeId: user.id });
      onUpdated(updated);
    } catch (requestError) {
      setError(requestError.message || "The report could not be assigned.");
    } finally {
      setPending("");
    }
  }

  async function transition(event) {
    event.preventDefault();
    if (needsResolution && notes.trim().length < 8) return;
    setPending("transition");
    setError("");
    try {
      const updated = await moderationApi.transitionReport(report.id, {
        expectedRevision: report.revision,
        status,
        resolutionNotes: notes
      });
      setNotes("");
      onUpdated(updated);
    } catch (requestError) {
      setError(requestError.message || "The moderation decision could not be applied.");
    } finally {
      setPending("");
    }
  }

  return (
    <aside className="panel moderation-detail" aria-label="Selected report details">
      <div className="panel-title"><div><p className="eyebrow">Selected report</p><h2>{report.target_label || humanize(report.target_type)}</h2></div><button className="icon-btn" type="button" onClick={onClose} aria-label="Close report details"><Icon name="x" /></button></div>
      <div className="post-meta"><span className="pill">{humanize(report.status)}</span><span>{humanize(report.priority)}</span><span>Revision {report.revision}</span></div>
      <p>{report.description}</p>
      <dl className="moderation-metadata"><div><dt>Reason</dt><dd>{humanize(report.reason)}</dd></div><div><dt>Reporter</dt><dd>{report.reporter_name || "Account member"}</dd></div><div><dt>Created</dt><dd>{report.created_at ? formatDateTime(report.created_at) : "Unavailable"}</dd></div><div><dt>Assigned to</dt><dd>{report.assigned_to_name || "Unassigned"}</dd></div></dl>
      {report.resolution_notes && <div className="subscription-confirm"><strong>Recorded resolution</strong><p>{report.resolution_notes}</p></div>}
      {error && <ErrorPanel message={error} onRetry={() => setError("")} />}
      {report.can_manage && <>
        {!report.assigned_to_id && <button className="btn btn-soft" type="button" disabled={Boolean(pending)} onClick={() => { void assignToMe(); }}>{pending === "assign" ? "Assigning…" : "Assign to me"}</button>}
        {!(["resolved", "rejected", "duplicate"].includes(report.status)) && <form className="operations-form moderation-form" onSubmit={transition}>
          <label className="field"><span>Next status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{ACTION_STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
          <label className="field"><span>Decision notes {needsResolution ? "(required)" : "(optional)"}</span><textarea value={notes} minLength={needsResolution ? 8 : undefined} maxLength={4000} required={needsResolution} onChange={(event) => setNotes(event.target.value)} placeholder="Record the verified moderation reason and evidence considered." /></label>
          <button className="btn btn-primary" type="submit" disabled={Boolean(pending) || (needsResolution && notes.trim().length < 8)}>{pending === "transition" ? "Applying…" : "Apply decision"}</button>
        </form>}
      </>}
    </aside>
  );
}

export default function Moderation({ user }) {
  const [status, setStatus] = useState("open");
  const [assignment, setAssignment] = useState("");
  const queue = useAsyncData(() => moderationApi.listReports({ status: status || null, assignment: assignment || null }), [status, assignment]);
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!queue.data) return;
    setReports(queue.data.results);
    setNextCursor(queue.data.nextCursor);
    setSelected(null);
  }, [queue.data]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setActionError("");
    try {
      const page = await moderationApi.listReports({ status: status || null, assignment: assignment || null, cursor: nextCursor });
      setReports((current) => mergeReports(current, page.results));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setActionError(error.message || "More reports could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  function updateReport(updated) {
    setReports((current) => current.map((report) => report.id === updated.id ? updated : report));
    setSelected(updated);
  }

  if (queue.loading) return <LoadingPanel />;
  if (queue.error) return <ErrorPanel message={queue.error} onRetry={queue.reload} />;

  return (
    <Page title="Moderation" subtitle="Review the reports authorized for your account.">
      {actionError && <ErrorPanel message={actionError} onRetry={() => setActionError("")} />}
      <section className={`moderation-workspace ${selected ? "has-detail" : ""}`}>
        <div className="moderation-queue">
          <section className="panel moderation-filters" aria-label="Report filters">
            <label className="field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{REPORT_STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
            <label className="field"><span>Assignment</span><select value={assignment} onChange={(event) => setAssignment(event.target.value)}><option value="">All visible</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option></select></label>
          </section>
          <section className="panel list-panel">
            <div className="panel-title"><div><p className="eyebrow">Authorized queue</p><h2>Reports</h2></div><span>{reports.length}</span></div>
            {reports.length ? reports.map((report) => <SelectableRow className="operations-row" key={report.id} selected={selected?.id === report.id} onClick={() => setSelected(report)}><span className="stat-icon"><Icon name="shield-alert" /></span><span><b>{report.target_label || humanize(report.target_type)}</b><small>{humanize(report.reason)} · {humanize(report.status)} · {report.assigned_to_name || "Unassigned"}</small></span><Icon name="chevron-right" /></SelectableRow>) : <EmptyState title="No reports found" text="No report matches these server-side filters." />}
            {nextCursor && <button className="btn btn-soft moderation-load-more" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more"}</button>}
          </section>
        </div>
        {selected && <ReportDetail report={selected} user={user} onClose={() => setSelected(null)} onUpdated={updateReport} />}
      </section>
    </Page>
  );
}
