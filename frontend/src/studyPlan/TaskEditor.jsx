import { useEffect, useRef, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { QUICK_MINUTES, QUICK_TITLES, hasSubject, mergeSubjects, rebaseTaskDraft } from "./model.js";

export default function TaskEditor({ item, day, subjects = [], onSave, onCancel, onDelete, busy }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({ title: item?.title || "", subject: item?.subject || "", scheduledDate: item?.scheduled_date || day, durationMinutes: item?.duration_minutes || 25 }));
  const previous = useRef(item);
  useEffect(() => {
    if (item && previous.current && item.revision !== previous.current.revision) {
      const original = previous.current;
      setDraft(current => rebaseTaskDraft(current, original, item));
    }
    previous.current = item;
  }, [item]);
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const subjectChoices = mergeSubjects(subjects);
  return <section className="plan-editor" aria-labelledby="plan-editor-title">
    <h2 id="plan-editor-title">{t(item ? "plan.edit" : "plan.add")}</h2>
    <form onSubmit={event => { event.preventDefault(); void onSave({ ...draft, durationMinutes: Number(draft.durationMinutes) }); }}>
      <fieldset disabled={busy} className="plan-editor-fields">
        <legend className="visually-hidden">{t("plan.edit")}</legend>
        {subjectChoices.length > 0 && <div className="plan-chips" role="group" aria-label={t("plan.yourSubjects")}>
          {subjectChoices.map(subject => {
            const on = hasSubject([draft.subject], subject);
            return <button key={subject} type="button" className="plan-chip" aria-pressed={on} onClick={() => change("subject", on ? "" : subject)}><span dir="auto">{subject}</span></button>;
          })}
        </div>}
        <label>{t("plan.title")}<input required autoComplete="off" maxLength={180} value={draft.title} onChange={event => change("title", event.target.value)} placeholder={t("plan.taskHint")} /></label>
        <div className="plan-chips" role="group" aria-label={t("plan.quickTitles")}>
          {QUICK_TITLES.map(key => <button key={key} type="button" className="plan-chip" aria-pressed={draft.title === t(key)} onClick={() => change("title", t(key))}>{t(key)}</button>)}
        </div>
        <label>{t("plan.subjects")}<input maxLength={120} value={draft.subject} onChange={event => change("subject", event.target.value)} /></label>
        <div className="plan-field-grid">
          <label>{t("plan.date")}<input type="date" required value={draft.scheduledDate} onChange={event => change("scheduledDate", event.target.value)} /></label>
          <div className="plan-minutes-field">
            <label>{t("plan.minutes")}<input type="number" min="5" max="480" required value={draft.durationMinutes} onChange={event => change("durationMinutes", event.target.value)} /></label>
            <div className="plan-chips" role="group" aria-label={t("plan.quickMinutes")}>
              {QUICK_MINUTES.map(minutes => <button key={minutes} type="button" className="plan-chip" aria-pressed={Number(draft.durationMinutes) === minutes} onClick={() => change("durationMinutes", minutes)}>{t("studyPlan.minutesValue", { count: minutes })}</button>)}
            </div>
          </div>
        </div>
      </fieldset>
      <div className="plan-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{t("plan.update")}</button><button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>{t("plan.cancel")}</button>{item && <button type="button" className="plan-delete" disabled={busy} onClick={onDelete}>{t("plan.delete")}</button>}</div>
    </form>
  </section>;
}
