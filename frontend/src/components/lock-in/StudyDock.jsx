import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Timer } from "lucide-react";
import { focusApi } from "../../api/focus.js";
import { useI18n } from "../I18nProvider.jsx";
import { useVisibleNow } from "../../hooks/useVisibleNow.js";
import { acceptsLiveResponse, clock, liveClock } from "./liveSession.js";
import { useLiveConnection } from "./useLiveConnection.js";
import "../../pages/lock-in-live.css";

export function StudyDock({ payload, onChange, active }) {
  const { t } = useI18n();
  useVisibleNow(active);
  const snapshot = useMemo(() => ({ ...payload, received_at_monotonic_ms: window.performance.now() }), [payload]);
  const replace = useCallback((next) => onChange((current) => acceptsLiveResponse(current, next) ? next : current), [onChange]);
  const refresh = useCallback(async () => {
    try { replace(await focusApi.getLockInSession(payload.session.id)); } catch { /* The room exposes retry and access errors. */ }
  }, [payload.session.id, replace]);
  const presence = useCallback(async (value) => { replace(await focusApi.setLockInPresence(payload.session.id, value)); }, [payload.session.id, replace]);
  useLiveConnection({ payload, onRefresh: refresh, onPresence: presence, enabled: active });
  const timing = liveClock(snapshot, window.performance.now());
  return <Link className="lm-study-dock" to={`/lock-in/${payload.session.id}`} aria-label={t("lockIn.returnToSession")}>
    <Timer size={18} aria-hidden="true" /><span dir="ltr">{clock(timing.remaining ?? timing.personal)}</span>
  </Link>;
}
