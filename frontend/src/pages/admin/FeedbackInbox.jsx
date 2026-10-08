import { useState } from "react";
import { feedbackApi } from "../../api/feedback.js";
import { EmptyState, ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { formatDateTime } from "../../lib/i18n.js";

const STATUSES = ["new", "planned", "done", "declined"];
const label = (value) => value.charAt(0).toUpperCase() + value.slice(1);

function SuggestionRow({ item, canManage, onChanged }) {
  const [note, setNote] = useState(item.admin_note || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save(changes) {
    setPending(true);
    setError("");
    try {
      await feedbackApi.adminUpdate(item.id, changes);
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
        <h3 dir="auto">{item.message}</h3>
        <p>
          {label(item.category)} · {item.user ? `${item.user.name || "Student"} (${item.user.email})` : "Deleted account"} · {formatDateTime(item.created_at)}
        </p>
      </div>
      {canManage && (
        <div>
          <select aria-label="Status" value={item.status} disabled={pending} onChange={(event) => save({ status: event.target.value })}>
            {STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
          </select>
          <input
            aria-label="Internal note"
            maxLength={500}
            value={note}
            placeholder="Internal note"
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => { if (note !== (item.admin_note || "")) save({ admin_note: note }); }}
          />
          {error && <div className="form-alert error" role="alert">{error}</div>}
        </div>
      )}
    </article>
  );
}

export default function FeedbackInbox({ canManage }) {
  const [status, setStatus] = useState("new");
  const data = useAsyncData(() => feedbackApi.adminList({ status }), [status]);

  return (
    <section className="operations-workspace">
      <label className="field">
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All</option>
          {STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </label>
      {data.loading ? <LoadingPanel />
        : data.error ? <ErrorPanel message={data.error} onRetry={data.reload} />
        : (
          <section className="panel list-panel">
            <div className="panel-title"><h2>Student suggestions</h2><span>{data.data.count}</span></div>
            {data.data.results.length
              ? data.data.results.map((item) => <SuggestionRow key={item.id} item={item} canManage={canManage} onChanged={data.reload} />)
              : <EmptyState title="No suggestions" text="Nothing matches this status." />}
          </section>
        )}
    </section>
  );
}
