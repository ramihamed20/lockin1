import { useEffect, useRef, useState } from "react";
import { accountsApi } from "../../api/accounts.js";
import { Icon } from "../../lib/icons.jsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.jsx";
import { formatDateTime } from "../../lib/i18n.js";
import { sessionDeviceType } from "../../lib/devicePresentation.js";
import { DeviceArtwork } from "../settings/DeviceArtwork.jsx";
import { useI18n } from "../I18nProvider.jsx";

export function SessionList({ onCurrentSessionRevoked, refreshKey = 0 }) {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const requestVersion = useRef(0);
  const mutating = useRef(false);

  function lastActive(value) {
    const formatted = value ? formatDateTime(value, {}, locale) : "—";
    return formatted === "—" ? t("settings.sessionUnknownActivity") : t("settings.sessionLastActive", { date: formatted });
  }

  async function load() {
    const version = ++requestVersion.current;
    setLoading(true); setError(null);
    try {
      const loaded = await accountsApi.listSessions();
      if (version !== requestVersion.current) return;
      setSessions([...loaded].sort((a, b) => Number(b.is_current) - Number(a.is_current) || (Date.parse(b.last_seen_at) || 0) - (Date.parse(a.last_seen_at) || 0)));
      setExpanded(false);
    } catch (failure) { if (version === requestVersion.current) setError(failure); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [refreshKey]);

  async function revoke(session) {
    if (mutating.current) return;
    mutating.current = true;
    // An older refresh must never restore a session after its deletion.
    requestVersion.current += 1;
    setLoading(false); setPending(session.id); setError(null);
    try {
      if (session.id === "all") await accountsApi.logoutAll();
      else await accountsApi.revokeSession(session.id);
      if (session.is_current || session.id === "all") {
        onCurrentSessionRevoked?.();
        return;
      }
      setSessions(current => current.filter(item => item.id !== session.id));
    } catch (failure) { setError(failure); }
    finally { mutating.current = false; setPending(null); setConfirming(null); }
  }

  const visibleSessions = expanded ? sessions : sessions.slice(0, 4);
  const all = confirming?.id === "all";
  return <div className="ui-group-block settings-v2-block account-security-panel">
    <div className="settings-v2-group-head">
      <h3 className="ui-group-title">{t("settings.sessions")}{!loading && !error && <span className="settings-device-count"> · {sessions.length}</span>}</h3>
      <button className="icon-btn" type="button" onClick={() => void load()} disabled={loading || Boolean(pending)} aria-label={t("settings.sessionsRefresh")}><Icon name="reset" size={18} /></button>
    </div>
    {error && <p className="form-alert error" role="alert">{error.message}</p>}
    <ul className="ui-group settings-device-list" aria-busy={loading || undefined}>
      {loading && !sessions.length && <li className="ui-row"><span className="ui-row-body"><small role="status">{t("settings.sessionsLoading")}</small></span></li>}
      {!loading && !error && !sessions.length && <li className="ui-row"><span className="ui-row-body"><small>{t("settings.sessionsEmpty")}</small></span></li>}
      {visibleSessions.map(session => {
        const type = sessionDeviceType(session, typeof navigator === "undefined" ? null : navigator);
        return <li className={`settings-device ${session.is_current ? "is-current" : ""}`} key={session.id}>
          <div className="settings-device-summary"><DeviceArtwork type={type} />
            <div className="settings-device-body"><strong>{t(`settings.device.${type}`)}</strong><span dir="auto">{session.device_label}</span>
              {session.is_current && <span className="settings-device-current"><span aria-hidden="true" />{t("settings.sessionThisDevice")}</span>}
              <small>{lastActive(session.last_seen_at)}</small>
            </div>
          </div>
          <details className="settings-device-details"><summary>{t("settings.device.details")}<Icon name="chevron-down" size={15} /></summary>
            <dl>{[["settings.device.signedIn", session.created_at], ["settings.device.expires", session.expires_at]].map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value ? formatDateTime(value, {}, locale) : "—"}</dd></div>)}</dl>
            <button className="btn btn-soft compact" type="button" aria-busy={pending === session.id || undefined} disabled={Boolean(pending)} onClick={() => setConfirming(session)}>{pending === session.id ? t("settings.sessionRevoking") : session.is_current ? t("settings.sessionSignOut") : t("settings.sessionRevoke")}</button>
          </details>
        </li>;
      })}
      {visibleSessions.length < sessions.length && <li><button className="ui-row settings-v2-action" type="button" onClick={() => setExpanded(true)}><span className="ui-row-body">{t("settings.sessionShowAll", { count: sessions.length })}</span></button></li>}
    </ul>
    <details className="settings-info"><summary>{t("settings.device.about")}</summary><p className="ui-group-footer">{t("settings.device.hint")}</p></details>
    {!loading && sessions.length > 0 && <div className="ui-group"><button type="button" className="ui-row is-danger" disabled={Boolean(pending)} onClick={() => setConfirming({ id: "all" })}><span className="ui-row-icon"><Icon name="logout" size={18} /></span><span className="ui-row-body">{t("settings.device.signOutAll")}</span></button></div>}
    <ConfirmDialog open={Boolean(confirming)} busy={Boolean(pending)}
      title={t(all ? "settings.device.signOutAllTitle" : confirming?.is_current ? "settings.sessionSignOutTitle" : "settings.sessionRevokeTitle")}
      message={t(all ? "settings.device.signOutAllMessage" : confirming?.is_current ? "settings.sessionSignOutMessage" : "settings.sessionRevokeMessage")}
      confirmLabel={t(all ? "settings.device.signOutAll" : confirming?.is_current ? "settings.sessionSignOut" : "settings.sessionRevoke")}
      onCancel={() => setConfirming(null)} onConfirm={() => confirming && void revoke(confirming)} />
  </div>;
}
