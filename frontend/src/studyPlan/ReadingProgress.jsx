import { useRef, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { studyPlanApi } from "../api/studyPlan.js";

/** Range confirmation is explicit; reading position is never inferred as coverage. */
export default function ReadingProgress({ userId, task = null, issue = null, periodId = null, onSaved, onCancel }) {
  const { t } = useI18n();
  const first = task ? Math.max(task.page_start, (task.completed_page_end || 0) + 1) : 1;
  const last = task?.page_end || issue?.page_count || first;
  const [from, setFrom] = useState(String(first)), [to, setTo] = useState(String(last)), [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const intent = useRef({ key: "", id: "" });
  const lock = useRef(false);
  async function save(event) {
    event.preventDefault();
    if (lock.current || Number(from) > Number(to)) return;
    const fields = { page_end: Number(to), minutes: minutes === "" ? 0 : Number(minutes) };
    const key = JSON.stringify([task?.id, issue?.version_id, from, fields]);
    if (intent.current.key !== key) intent.current = { key, id: globalThis.crypto.randomUUID() };
    const body = { ...fields, client_request_id: intent.current.id };
    lock.current = true; setBusy(true); setError("");
    try {
      const result = task ? await studyPlanApi.reportTaskProgress(userId, task.id, { ...body, expected_revision: task.revision })
        : await studyPlanApi.reportReading(userId, periodId, { ...body, page_start: Number(from), version_id: issue.version_id, file_id: issue.file_id, edition: issue.edition });
      await onSaved(result);
    } catch (failure) { setError(t(failure.code === "plan_progress_pending" ? "smart.pending" : failure.status === 409 ? "plan.stale" : "plan.saveFailed")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="plan-reading-progress" onSubmit={save}>
    <strong>{t("smart.readingProgress")}</strong>
    <div className="plan-field-grid">
      {!task && <label>{t("smart.firstPage")}<input type="number" required min={1} max={last} value={from} disabled={busy} onChange={event => setFrom(event.target.value)} /></label>}
      <label>{t("smart.lastPage")}<input type="number" required min={Number(from)} max={last} value={to} disabled={busy} onChange={event => setTo(event.target.value)} /></label>
      <label>{t("smart.actualMinutes")}<input type="number" min={1} max={480} value={minutes} disabled={busy} onChange={event => setMinutes(event.target.value)} /></label>
    </div>
    <small>{t("smart.readingNote")}</small>
    {error && <p role="alert">{error}</p>}
    <div className="plan-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{t("plan.save")}</button><button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>{t("plan.cancel")}</button></div>
  </form>;
}
