import { useEffect, useRef } from "react";

/** Opening a record should bring its detail into view even after a long queue. */
export function QueueDetail({ label, children }) {
  const panel = useRef(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);
  return <section ref={panel} className="panel ops-detail" aria-label={label} tabIndex={-1}>{children}</section>;
}
