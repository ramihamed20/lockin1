import { useEffect, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { offlineAccessStatus } from "./lease.js";
import { getConnectionSnapshot, subscribeConnection } from "../lib/connectionState.js";

export default function OfflineIndicator({ userId }) {
  const { t } = useI18n();
  const [online, setOnline] = useState(() => navigator.onLine && getConnectionSnapshot().status === "connected");
  const [state, setState] = useState("");
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    let active = true;
    const update = async () => {
      const connected = navigator.onLine && getConnectionSnapshot().status === "connected";
      setOnline(connected);
      if (!connected) {
        const status = await offlineAccessStatus(userId).catch(() => /** @type {{available: boolean, claims?: {exp: number}}} */ ({ available: false }));
        if (active) setRemaining(status.claims ? Math.max(0, status.claims.exp * 1000 - Date.now()) : 0);
      }
    };
    const sync = (event) => { if (event.detail?.userId === userId) setState(event.detail.state); };
    void update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("lock-in:offline-sync", sync);
    const unsubscribe = subscribeConnection(() => { void update(); });
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("online", update); window.removeEventListener("offline", update); window.removeEventListener("lock-in:offline-sync", sync); unsubscribe(); };
  }, [userId]);

  // Sync outcomes are transient notices while online. A failed background sync
  // ("connection") retries on its own, so it fades too instead of sitting on
  // screen for the rest of the session; being genuinely offline stays visible.
  useEffect(() => {
    // "signin" and "access" need the student, so they stay until the next run.
    if (!online || !["synced", "partial", "connection"].includes(state)) return undefined;
    const timer = window.setTimeout(() => setState(""), state === "connection" ? 6000 : 3000);
    return () => window.clearTimeout(timer);
  }, [online, state]);

  // Background work is silent: checking access, downloading and a successful
  // sync happen on every launch and are shown where they are managed
  // (Settings > Offline Mode). The pill speaks only when the student is offline
  // or something needs them.
  const label = !online
    ? remaining > 0 ? `${t("offline.offline")} · ${t("offline.hoursLeft", { count: Math.floor(remaining / 3_600_000) })}` : t("offline.offline")
    : ["connection", "signin", "access"].includes(state) ? t(`offline.sync.${state}`) : "";
  const tone = !online ? "offline" : "warning";
  return label ? <span className="offline-indicator" data-tone={tone} role="status">{label}</span> : null;
}
