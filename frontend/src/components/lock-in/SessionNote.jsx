import { useEffect, useState } from "react";
import { focusApi } from "../../api/focus.js";
import { useI18n } from "../I18nProvider.jsx";

export function SessionNote({ payload, onDirtyChange = undefined }) {
  const { t } = useI18n();
  const [body, setBody] = useState(payload.note?.body || "");
  const [saved, setSaved] = useState({ body: payload.note?.body || "", revision: payload.note?.revision || 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = body !== saved.body;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const result = await focusApi.updateLockInNote(payload.session.id, { body, expectedRevision: saved.revision });
      const note = /** @type {any} */ (result.note);
      setSaved({ body, revision: note.revision });
    } catch (failure) { setError(failure.message || t("lockIn.updateFailed")); }
    finally { setBusy(false); }
  }
  return <details className="lm-private-note">
    <summary>{t("lockIn.privateNote")}</summary>
    <form onSubmit={save}>
      <label className="visually-hidden" htmlFor="lm-note">{t("lockIn.privateNote")}</label>
      <textarea id="lm-note" rows={3} maxLength={10000} value={body} onChange={(event) => setBody(event.target.value)} />
      <button className="btn btn-soft compact" type="submit" disabled={busy || body === saved.body}>{body === saved.body ? t("lockIn.saved") : t("lockIn.save")}</button>
      {error && <p className="lm-error" role="alert">{error}</p>}
    </form>
  </details>;
}
