import { useEffect, useRef } from "react";

/** Presence describes the application, never the student's attention. */
export function useLiveConnection({ payload, onRefresh, onPresence, enabled = true }) {
  const presenceRef = useRef(payload.self_presence);
  const sendingRef = useRef(false);
  useEffect(() => { presenceRef.current = payload.self_presence; }, [payload.self_presence]);
  useEffect(() => {
    if (!enabled || !["active", "paused", "on_break"].includes(payload.session.status)) return undefined;
    let alive = true;
    let refreshing = false;
    const refresh = async () => {
      if (!alive || refreshing || document.hidden) return;
      refreshing = true;
      try { await onRefresh(); } finally { refreshing = false; }
    };
    const heartbeat = async () => {
      if (!payload.session.team_id || payload.session.status !== "active" || sendingRef.current || !alive) return;
      const next = presenceRef.current === "break" ? "break" : document.hidden ? "away" : "focused";
      sendingRef.current = true;
      try { await onPresence(next); } catch { /* Refresh exposes connection errors; retry on next heartbeat. */ }
      finally { sendingRef.current = false; }
    };
    const visible = () => { void heartbeat(); void refresh(); };
    const refreshTimer = window.setInterval(() => { void refresh(); }, 10000);
    const heartbeatTimer = window.setInterval(() => { if (!document.hidden) void heartbeat(); }, 25000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    void heartbeat();
    return () => {
      alive = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [payload.session.id, payload.session.status, payload.session.team_id, onRefresh, onPresence, enabled]);
}
