import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { focusApi } from "../api/focus.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel, LoadingPanel } from "../components/ui/index.jsx";
import LockInMode from "./LockInMode.jsx";

export default function LockInEntry({ user }) {
  const { t } = useI18n();
  const { sessionId } = useParams();
  const [state, setState] = useState({ loading: true, enabled: false, error: "", activeSessionId: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true, enabled: false, error: "", activeSessionId: "" });
    focusApi.getLockInAvailability().then((result) => {
      if (active) setState({ loading: false, enabled: result.enabled === true, activeSessionId: typeof result.active_session_id === "string" ? result.active_session_id : "", error: "" });
    }).catch((error) => {
      if (active) setState({ loading: false, enabled: false, activeSessionId: "", error: error.message || t("lockIn.openFailed") });
    });
    return () => { active = false; };
  }, [user.id, retry, t]);
  if (state.loading) return <LoadingPanel />;
  if (state.error) return <ErrorPanel message={state.error} onRetry={() => setRetry((value) => value + 1)} />;
  // Saved sessions remain recoverable during a rollout pause.
  if (!state.enabled && !sessionId) return <section className="feature-coming-soon" data-feature-id="lock-in">
    <h1>{t("lockIn.comingSoon")}</h1>
    <p>{t("lockIn.comingSoonBody")}</p>
    {state.activeSessionId && <Link className="btn btn-primary" to={`/lock-in/${state.activeSessionId}`}>{t("lockIn.resume")}</Link>}
    <Link className="btn btn-soft" to="/dashboard">{t("features.returnDashboard")}</Link>
  </section>;
  return <LockInMode user={user} />;
}
