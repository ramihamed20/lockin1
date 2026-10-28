import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { SessionRoomPanel } from "./SessionRoomPanel.jsx";
import { Timer, Users } from "lucide-react";
import { focusApi } from "../../api/focus.js";
import { useI18n } from "../I18nProvider.jsx";
import { useVisibleNow } from "../../hooks/useVisibleNow.js";
import { acceptsLiveResponse, clock, liveClock } from "./liveSession.js";
import { useLiveConnection } from "./useLiveConnection.js";
import "../../pages/lock-in-live.css";

export function StudyDock({ payload, onChange, active, portalRef }) {
  const location = useLocation();
  const [roomOpen, setRoomOpen] = useState(location.state?.lockInPanelOpen === true);
  const roomRef = useRef(null);
  const toggleRef = useRef(null);
  const closeRoom = useCallback(() => { setRoomOpen(false); toggleRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (!active) setRoomOpen(false); }, [active]);
  useEffect(() => {
    if (!active || !roomOpen) return undefined;
    const escape = (event) => {
      if (event.key !== "Escape" || !roomRef.current?.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation(); closeRoom();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [active, roomOpen, closeRoom]);
  // iPad split view and phone keyboards change the visible viewport before
  // they change the reader's layout viewport. Keep the composer reachable.
  useEffect(() => {
    if (!active || !roomOpen) return undefined;
    const panel = roomRef.current;
    if (!panel) return undefined;
    const viewport = window.visualViewport;
    const measure = () => {
      const visibleBottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
      panel.style.setProperty("--lm-room-max-height", `${Math.max(120, visibleBottom - panel.getBoundingClientRect().top - 12)}px`);
    };
    measure();
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [active, roomOpen]);
  const { t } = useI18n();
  useVisibleNow(active);
  const snapshot = useMemo(() => ({ ...payload, received_at_monotonic_ms: window.performance.now() }), [payload]);
  const replace = useCallback((next) => onChange((current) => acceptsLiveResponse(current, next) ? next : current), [onChange]);
  const refresh = useCallback(async () => {
    try { replace(await focusApi.getLockInSession(payload.session.id)); }
    catch (error) {
      if ([401, 403, 404].includes(error?.status)) onChange((current) => current?.session?.id === payload.session.id ? null : current);
    }
  }, [payload.session.id, replace, onChange]);
  const presence = useCallback(async (value) => { replace(await focusApi.setLockInPresence(payload.session.id, value)); }, [payload.session.id, replace]);
  useLiveConnection({ payload, onRefresh: refresh, onPresence: presence, enabled: active });
  const timing = liveClock(snapshot, window.performance.now());
  const dock = <Link className="lm-study-dock" to={`/lock-in/${payload.session.id}`} aria-label={t("lockIn.returnToSession")}>
    <Timer size={18} aria-hidden="true" /><span dir="ltr">{clock(timing.remaining ?? timing.personal)}</span>
  </Link>;
  return <div className="lm-study-dock-group">
    {dock}
    {payload.team && <button ref={toggleRef} className="lm-study-dock lm-study-team-toggle" type="button" aria-label={t("lockIn.discussion")} aria-expanded={active && roomOpen} onClick={() => setRoomOpen((value) => !value)}><Users size={16} aria-hidden="true" /><span>{t("lockIn.team")}</span></button>}
    {active && roomOpen && payload.team && portalRef?.current && createPortal(<div ref={roomRef} className="lm-focus-room"><SessionRoomPanel payload={payload} onClose={closeRoom} /></div>, portalRef.current)}
  </div>;
}
