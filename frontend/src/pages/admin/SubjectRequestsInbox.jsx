import { useState } from "react";
import { catalogWorkspaceApi } from "../../api/catalogWorkspace.js";
import { EmptyState, ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { formatDateTime } from "../../lib/i18n.js";

const STATUSES = ["pending", "approved", "declined"];
const label = (value) => value.charAt(0).toUpperCase() + value.slice(1);

function RequestRow({ item, canManage, onChanged }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision) {
    setPending(true);
    setError("");
    try {
      await catalogWorkspaceApi.decideSubjectRequest(item.id, { decision, adminNote: note });
      onChanged();
    } catch (requestError) {
      setError(requestError?.message || "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="operations-campaign">
      <div>
        <h3 dir="auto">{item.remove.title} → {item.add.title}</h3>
        <p>
          {item.user.name || "Student"} ({item.user.email}) · {formatDateTime(item.created_at)} · {label(item.status)}
        </p>
        {item.note && <p dir="auto">“{item.note}”</p>}
        {item.admin_note && <p dir="auto">Note: {item.admin_note}</p>}
      </div>
      {canManage && item.status === "pending" && (
        <div>
          <input aria-label="Note to the student" maxLength={500} value={note} placeholder="Note to the student (optional)" onChange={(event) => setNote(event.target.value)} />
          <button type="button" className="btn btn-primary compact" disabled={pending} onClick={() => decide("approve")}>Approve and apply</button>
          <button type="button" className="btn btn-soft compact" disabled={pending} onClick={() => decide("decline")}>Decline</button>
          {error && <div className="form-alert error" role="alert">{error}</div>}
        </div>
      )}
    </article>
  );
}

/** Second Year students' requests to swap an added First Year subject. */
export default function SubjectRequestsInbox({ canManage }) {
  const [status, setStatus] = useState("pending");
  const data = useAsyncData(() => catalogWorkspaceApi.adminSubjectRequests({ status }), [status]);

  return (
    <section className="operations-workspace">
      <label className="field">
        <span>Subject change requests</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All</option>
          {STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </label>
      {data.loading ? <LoadingPanel />
        : data.error ? <ErrorPanel message={data.error} onRetry={data.reload} />
        : (
          <section className="panel list-panel">
            <div className="panel-title"><h2>Subject change requests</h2><span>{data.data.count}</span></div>
            {data.data.results.length
              ? data.data.results.map((item) => <RequestRow key={item.id} item={item} canManage={canManage} onChanged={data.reload} />)
              : <EmptyState title="No requests" text="Nothing matches this status." />}
          </section>
        )}
    </section>
  );
}
