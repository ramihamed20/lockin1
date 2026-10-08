import { useEffect, useState } from "react";
import { accountsApi } from "../../api/accounts.js";
import { Icon } from "../../lib/icons.jsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.jsx";
import { formatDateTime } from "../../lib/i18n.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { useI18n } from "../I18nProvider.jsx";

export function SessionList({ onCurrentSessionRevoked, refreshKey = 0 }) {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const compactSessions = useMediaQuery("(max-width: 1199px)");
  const phoneSessions = useMediaQuery("(max-width: 639px)");

  function lastActive(value) {
    const formatted = value ? formatDateTime(value, {}, locale) : "—";
    return formatted === "—" ? t("settings.sessionUnknownActivity") : t("settings.sessionLastActive", { date: formatted });
  }

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
    if (pending) return;
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
    <div className="ui-group-block settings-v2-block account-security-panel">
      <div className="settings-v2-group-head">
        <h3 className="ui-group-title">{t("settings.sessions")}</h3>
        <button className="icon-btn" type="button" onClick={() => void load()} disabled={loading} aria-label={t("settings.sessionsRefresh")}><Icon name="reset" size={16} /></button>
      </div>
      {error && <p className="form-alert error" role="alert">{error.message}</p>}
      <ul className="ui-group" aria-busy={loading || undefined}>
        {loading && !sessions.length && <li className="ui-row"><span className="ui-row-body"><small>{t("settings.sessionsLoading")}</small></span></li>}
        {!loading && !error && !sessions.length && <li className="ui-row"><span className="ui-row-body"><small>{t("settings.sessionsEmpty")}</small></span></li>}
        {visibleSessions.map((session) => <li className="ui-row" key={session.id}>
          <span className="ui-row-body">
            <strong dir="auto">{session.device_label}</strong>
            <small>{session.is_current ? t("settings.sessionThisDevice") : lastActive(session.last_seen_at)}</small>
          </span>
          <button className="btn btn-soft compact" type="button" aria-busy={pending === session.id || undefined} disabled={pending === session.id} onClick={() => setConfirming(session)}>
            {pending === session.id ? t("settings.sessionRevoking") : session.is_current ? t("settings.sessionSignOut") : t("settings.sessionRevoke")}
          </button>
        </li>)}
        {visibleSessions.length < sessions.length && <li>
          <button className="ui-row settings-v2-action" type="button" onClick={() => setExpanded(true)}>
            <span className="ui-row-body"><span>{t("settings.sessionShowAll", { count: sessions.length })}</span></span>
          </button>
        </li>}
      </ul>
      <ConfirmDialog
        open={Boolean(confirming)}
        busy={Boolean(pending)}
        title={confirming?.is_current ? t("settings.sessionSignOutTitle") : t("settings.sessionRevokeTitle")}
        message={confirming?.is_current ? t("settings.sessionSignOutMessage") : t("settings.sessionRevokeMessage")}
        confirmLabel={confirming?.is_current ? t("settings.sessionSignOut") : t("settings.sessionRevoke")}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && void revoke(confirming)}
      />
    </div>
  );
}
