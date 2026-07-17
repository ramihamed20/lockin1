import { useEffect } from "react";

import { recordActivity } from "./api";

export function useIntegritySignals(attemptId: string | undefined, active: boolean) {
  useEffect(() => {
    if (!attemptId || !active) return;
    const record = (type: string, metadata: Record<string, string> = {}) => {
      void recordActivity(attemptId, type, metadata).catch(() => undefined);
    };
    record("workspace_entered");
    const visibility = () => record(document.hidden ? "page_hidden" : "page_visible");
    const offline = () => record("connection_lost", { connection: "offline" });
    const online = () => record("connection_restored", { connection: "online" });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      record("workspace_exited");
    };
  }, [active, attemptId]);
}
