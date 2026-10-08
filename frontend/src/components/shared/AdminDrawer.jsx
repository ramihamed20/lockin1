import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { acquireBodyScrollLock } from "../../lib/bodyScrollLock.js";

/** Keeps an administrative detail panel modal across loading and error states. */
export function AdminDrawer({ children, onClose, busy = false, labelledBy }) {
  const ref = useRef(null);
  const current = useRef({ onClose, busy });
  current.current = { onClose, busy };
  useEffect(() => {
    const trigger = document.activeElement;
    const root = document.getElementById("root");
    const wasInert = root?.inert;
    if (root) root.inert = true;
    const release = acquireBodyScrollLock();
    ref.current?.focus();
    function onKey(event) {
      if (event.target.closest?.('[role="alertdialog"]')) return;
      if (event.key === "Escape" && !current.current.busy) {
        event.preventDefault();
        current.current.onClose();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(ref.current.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter((node) => node.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); ref.current.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      release();
      if (root) root.inert = wasInert;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return createPortal(<>
    <button className="creator-detail-backdrop" type="button" tabIndex={-1} aria-label="Close student detail" disabled={busy} onClick={onClose} />
    <aside className="operations-detail creator-detail-drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-busy={busy || undefined} tabIndex={-1} ref={ref}>{children}</aside>
  </>, document.body);
}
