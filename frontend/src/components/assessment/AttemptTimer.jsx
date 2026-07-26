import { useEffect, useState } from "react";
import { formatDuration } from "../../lib/utils.js";

function secondsRemaining(deadlineAt, serverTime) {
  const deadline = Date.parse(deadlineAt || "");
  const serverNow = Date.parse(serverTime || "");
  if (!Number.isFinite(deadline) || !Number.isFinite(serverNow)) return null;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

/** Calculates a countdown from the last server timestamp, never a client-owned duration. */
export function AttemptTimer({ deadlineAt, serverTime, onDeadline }) {
  const initial = secondsRemaining(deadlineAt, serverTime);
  const [remaining, setRemaining] = useState(initial);

  useEffect(() => {
    const fromServer = secondsRemaining(deadlineAt, serverTime);
    setRemaining(fromServer);
    if (fromServer == null || fromServer <= 0) return undefined;
    const localStartedAt = Date.now();
    const tick = () => setRemaining(Math.max(0, fromServer - Math.floor((Date.now() - localStartedAt) / 1000)));
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt, serverTime]);

  useEffect(() => {
    if (remaining === 0) onDeadline?.();
  }, [remaining, onDeadline]);

  if (remaining == null) return <span><strong>Untimed</strong> server window</span>;
  return <span className="session-timer"><strong>{formatDuration(remaining)}</strong> remaining</span>;
}
