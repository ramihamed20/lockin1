import { useEffect, useState } from "react";
import { accountsApi } from "../../api/accounts.js";
import { Icon } from "../../lib/icons.jsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.jsx";
import { formatDateTime } from "../../lib/i18n.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";

function formatSessionDate(value) {
  if (!value) return "Unknown activity";
  const formatted = formatDateTime(value);
  return formatted === "—" ? "Unknown activity" : formatted;
}

export function SessionList({ onCurrentSessionRevoked, refreshKey = 0 }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const compactSessions = useMediaQuery("(max-width: 1199px)");
  const phoneSessions = useMediaQuery("(max-width: 639px)");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSessions(await accountsApi.listSessions());
      setExpanded(false);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  async function revoke(session) {
    setPending(session.id);
    setError(null);
    try {
      await accountsApi.revokeSession(session.id);
      if (session.is_current) {
        onCurrentSessionRevoked?.();
        return;
      }
      setSessions((current) => current.filter((item) => item.id !== session.id));
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(null);
      setConfirming(null);
    }
  }

  const visibleSessions = compactSessions && !expanded ? sessions.slice(0, phoneSessions ? 3 : 4) : sessions;

  return (
    <article className="panel account-security-panel">
      <div className="panel-title"><div><p className="eyebrow">Account security</p><h2>Active sessions</h2></div><button className="icon-btn" type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh active sessions"><Icon name="reset" size={17} /></button></div>
      {loading && <p className="muted">Loading active sessions…</p>}
      {error && <p className="form-alert error" role="alert">{error.message}</p>}
      {!loading && !error && !sessions.length && <p className="muted">No active sessions were returned by the server.</p>}
      {!loading && sessions.length > 0 && <div className="settings-panel compact">
        {visibleSessions.map((session) => <div className="settings-row" key={session.id}>
          <div><h2>{session.device_label}</h2><p>Last active {formatSessionDate(session.last_seen_at)}</p></div>
          <div className="badge-row"><span className={session.is_current ? "pill success" : "pill"}>{session.is_current ? "This device" : "Active"}</span><button className="btn btn-soft" type="button" disabled={pending === session.id} onClick={() => setConfirming(session)}>{pending === session.id ? "Revoking…" : "Revoke"}</button></div>
        </div>)}
        {visibleSessions.length < sessions.length && <button className="btn btn-soft" type="button" onClick={() => setExpanded(true)}>Show all {sessions.length} sessions</button>}
      </div>}
      <ConfirmDialog
        open={Boolean(confirming)}
        title={confirming?.is_current ? "Sign out this device?" : "Revoke this session?"}
        message={confirming?.is_current ? "This will sign this browser out of your account." : "This device will need to sign in again."}
        confirmLabel={confirming?.is_current ? "Sign out" : "Revoke"}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && void revoke(confirming)}
      />
    </article>
  );
}
