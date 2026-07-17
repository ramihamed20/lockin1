import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../../i18n/I18nProvider";
import { formatDuration } from "./formatDuration";

export function AttemptTimer({
  deadline,
  serverTime,
  onExpired
}: {
  deadline: string | null;
  serverTime: string;
  onExpired: () => void;
}) {
  const { t } = useI18n();
  const expired = useRef(false);
  const [remaining, setRemaining] = useState(() => {
    if (!deadline) return null;
    return Math.max(0, Math.ceil((new Date(deadline).getTime() - new Date(serverTime).getTime()) / 1000));
  });
  const [announcement, setAnnouncement] = useState("");
  const lastThreshold = useRef<number | null>(null);

  useEffect(() => {
    if (!deadline) return;
    const deadlineMs = new Date(deadline).getTime();
    const mountedClientTime = Date.now();
    const mountedServerTime = new Date(serverTime).getTime();
    const update = () => {
      const estimatedServerNow = mountedServerTime + (Date.now() - mountedClientTime);
      const next = Math.max(0, Math.ceil((deadlineMs - estimatedServerNow) / 1000));
      setRemaining(next);
      const threshold = next <= 60 ? 60 : next <= 300 ? 300 : null;
      if (threshold && lastThreshold.current !== threshold) {
        lastThreshold.current = threshold;
        setAnnouncement(threshold === 60 ? t("oneMinuteRemaining") : t("fiveMinutesRemaining"));
      }
      if (next === 0 && !expired.current) {
        expired.current = true;
        onExpired();
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, onExpired, serverTime, t]);

  if (remaining === null) return <span className="attempt-timer attempt-timer--untimed">{t("untimed")}</span>;
  return (
    <div className={`attempt-timer${remaining <= 60 ? " attempt-timer--urgent" : ""}`}>
      <span>{t("timeRemaining")}</span>
      <time aria-label={`${t("timeRemaining")} ${formatDuration(remaining)}`}>
        {formatDuration(remaining)}
      </time>
      <span className="sr-only" aria-live="assertive">{announcement}</span>
    </div>
  );
}
