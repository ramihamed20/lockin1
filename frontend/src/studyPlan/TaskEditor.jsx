import { useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";

export default function TaskEditor({ item, day, onSave, onCancel, onDelete, busy }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({ title: item?.title || "", subject: item?.subject || "", scheduledDate: item?.scheduled_date || day, durationMinutes: item?.duration_minutes || 25 }));
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  return <section className="plan-editor" aria-labelledby="plan-editor-title">
    <h2 id="plan-editor-title">{t(item ? "plan.edit" : "plan.add")}</h2>
    <form onSubmit={event => { event.preventDefault(); void onSave({ ...draft, durationMinutes: Number(draft.durationMinutes) }); }}>
      <fieldset disabled={busy} className="plan-editor-fields">
        <legend className="visually-hidden">{t("plan.edit")}</legend>
        <label>{t("plan.title")}<input required autoComplete="off" maxLength={180} value={draft.title} onChange={event => change("title", event.target.value)} placeholder={t("plan.taskHint")} /></label>
        <label>{t("plan.subjects")}<input maxLength={120} value={draft.subject} onChange={event => change("subject", event.target.value)} /></label>
        <div className="plan-field-grid">
          <label>{t("plan.date")}<input type="date" required value={draft.scheduledDate} onChange={event => change("scheduledDate", event.target.value)} /></label>
          <label>{t("plan.minutes")}<input type="number" min="5" max="480" required value={draft.durationMinutes} onChange={event => change("durationMinutes", event.target.value)} /></label>
        </div>
      </fieldset>
      <div className="plan-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{t("plan.update")}</button><button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>{t("plan.cancel")}</button>{item && <button type="button" className="plan-delete" disabled={busy} onClick={onDelete}>{t("plan.delete")}</button>}</div>
    </form>
  </section>;
}
