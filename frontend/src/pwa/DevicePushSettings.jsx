import { useEffect, useRef, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { pushState, pushSupport, enableDevicePush, disableDevicePush, testDevicePush } from "./devicePush.js";

export default function DevicePushSettings({ userId }) {
  const { t } = useI18n();
  const [state, setState] = useState({ loading: true, enabled: false, config: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const live = useRef("");
  useEffect(() => {
    live.current = String(userId);
    let active = true;
    pushState(userId).then((next) => { if (active) setState({ loading: false, ...next }); })
      .catch(() => { if (active) { setState((next) => ({ ...next, loading: false })); setError(t("push.loadFailed")); } });
    return () => { active = false; live.current = ""; };
  }, [userId, t]);
  const support = pushSupport();
  const reason = support !== "supported" ? support : !state.config?.enabled ? "unconfigured" : "ready";
  const assertCurrent = () => { if (live.current !== String(userId)) throw new Error("push.accountChanged"); };
  async function toggle() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (state.enabled) await disableDevicePush(userId);
      else await enableDevicePush(userId, state.config.public_key, assertCurrent);
      assertCurrent();
      setState((next) => ({ ...next, enabled: !next.enabled }));
    } catch (failure) {
      if (live.current) setError(t(failure.message?.startsWith("push.") ? failure.message : "push.saveFailed"));
      if (state.enabled) setState((next) => ({ ...next, enabled: false }));
    } finally { if (live.current) setBusy(false); }
  }
  async function sendTest() {
    setBusy(true); setMessage(""); setError("");
    try { await testDevicePush(userId); if (live.current) setMessage(t("push.testQueued")); }
    catch { if (live.current) setError(t("push.saveFailed")); }
    finally { if (live.current) setBusy(false); }
  }
  return <div className="ui-group-block settings-v2-block" id="settings-device-push">
    <h3 className="ui-group-title">{t("push.title")}</h3>
    <div className="ui-group">
      <div className="ui-row"><span className="ui-row-body"><strong>{t(state.enabled ? "push.enabled" : "push.disabled")}</strong></span>
        <button className="btn btn-soft compact" type="button" onClick={toggle} disabled={busy || state.loading || (!state.enabled && reason !== "ready")} aria-busy={busy || undefined}>{t(state.enabled ? "push.turnOff" : "push.turnOn")}</button>
      </div>
      {state.enabled && <button className="ui-row settings-v2-action" type="button" onClick={sendTest} disabled={busy}><span className="ui-row-body">{t("push.test")}</span></button>}
    </div>
    <p className="ui-group-footer">{t(reason === "ready" ? "push.hint" : `push.${reason}`)}</p>
    {message && <p className="ui-group-footer" role="status">{message}</p>}
    {error && <p className="ui-group-footer" role="alert">{error}</p>}
  </div>;
}
