import { useEffect, useState } from "react";

export function useVisibleNow(enabled = true, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    const sync = () => {
      window.clearInterval(timer);
      if (document.hidden) return;
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled, intervalMs]);

  return now;
}
