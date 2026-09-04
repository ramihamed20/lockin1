import { useRef, useEffect } from "react";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

// `busy` is opt-in: a caller that runs an asynchronous action passes it while
// the action is in flight, and the dialog then refuses every way out of itself
// -- both buttons, Escape and the backdrop -- so the action cannot be started
// twice or abandoned half-way. Callers that omit it are unaffected.
export function ConfirmDialog({ open, title, message, confirmLabel = "", onConfirm, onCancel, busy = false }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const triggerRef = useRef(null);
  // Read through a ref so the key handler always sees the current state without
  // re-registering the listener (and re-running the focus setup) on each change.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();

    function onKey(e) {
      if (e.key === "Escape" && !busyRef.current) onCancel();
      if (e.key !== "Tab") return;
      const focusable = Array.from(ref.current?.querySelectorAll("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") || []);
      if (!focusable.length) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === ref.current || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      triggerRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-backdrop">
      <button className="confirm-backdrop-dismiss" type="button" tabIndex={-1} aria-label={t("confirm.close")} disabled={busy} onClick={onCancel} />
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-busy={busy} aria-labelledby="confirm-title" aria-describedby="confirm-desc" ref={ref} tabIndex={-1}>
        <div className="confirm-icon">
          <Icon name="help" size={24} />
        </div>
        <h3 id="confirm-title" dir="auto">{title || t("confirm.title")}</h3>
        <p id="confirm-desc" dir="auto">{message || t("confirm.message")}</p>
        <div className="confirm-actions">
          <button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
          <button className="btn btn-danger" type="button" disabled={busy} onClick={onConfirm}>{confirmLabel || t("common.delete")}</button>
        </div>
      </div>
    </div>
  );
}
