import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff, LoaderCircle } from "lucide-react";
import { getConnectionSnapshot, subscribeConnection } from "../../lib/connectionState.js";

export function ConnectionStatus() {
  const [connection, setConnection] = useState(getConnectionSnapshot);
  const [restored, setRestored] = useState(false);
  const previousRef = useRef(connection.status);
  const restoredTimerRef = useRef(null);
  useEffect(() => {
    const unsubscribe = subscribeConnection((next) => {
    setConnection(next);
    if (next.status === "connected" && previousRef.current !== "connected") {
      setRestored(true);
      if (restoredTimerRef.current !== null) window.clearTimeout(restoredTimerRef.current);
      restoredTimerRef.current = window.setTimeout(() => { setRestored(false); restoredTimerRef.current = null; }, 3500);
    }
    if (next.status !== "connected") setRestored(false);
    previousRef.current = next.status;
    });
    return () => {
      unsubscribe();
      if (restoredTimerRef.current !== null) window.clearTimeout(restoredTimerRef.current);
    };
  }, []);
  const state = connection.status === "connected" ? (restored ? "restored" : "hidden") : connection.status;
  if (state === "hidden") return null;
  const copy = state === "reconnecting" ? "Reconnecting…" : state === "offline"
    ? "You’re offline — changes will sync when connection returns" : "Connection restored";
  const Icon = state === "reconnecting" ? LoaderCircle : state === "offline" ? WifiOff : Wifi;
  return <div className={`connection-status connection-status--${state}`} role="status" aria-live="polite"><Icon size={16} aria-hidden="true" /><span>{copy}</span></div>;
}
