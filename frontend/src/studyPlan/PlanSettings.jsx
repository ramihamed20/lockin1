import { useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { profileDraft, profileRequest } from "./model.js";

export default function PlanSettings({ profile, onSave, onCancel, busy, initialMode }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({ ...profileDraft(profile), ...(initialMode ? { mode: initialMode } : {}) }));
  const [invalidDays, setInvalidDays] = useState(false);
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  return <section className="plan-settings" aria-labelledby="plan-settings-title">
    <h2 id="plan-settings-title">{t(profile.configured ? "plan.settings" : "plan.choose")}</h2>
    <form onSubmit={event => { event.preventDefault(); const invalid = draft.mode !== "custom" && !draft.weekdays.length; setInvalidDays(invalid); if (!invalid) void onSave(profileRequest({ ...draft, weekdays: draft.weekdays.length ? draft.weekdays : [0, 1, 2, 3, 4] })); }}>
      <fieldset className="plan-modes" disabled={busy}>
        <legend className="visually-hidden">{t("plan.choose")}</legend>
        {["beginning", "normal", "custom"].map(mode => <label key={mode} aria-label={t(`plan.${mode}`)} className={draft.mode === mode ? "is-selected" : ""}>
          <input type="radio" name="plan-mode" value={mode} checked={draft.mode === mode} onChange={() => change("mode", mode)} />
          <span><strong>{t(`plan.${mode}`)}</strong><small>{t(`plan.${mode}Hint`)}</small></span>
        </label>)}
      </fieldset>
      <fieldset className="plan-settings-fields" disabled={busy}>
        <legend className="visually-hidden">{t("plan.settings")}</legend>
        {draft.mode === "beginning" && <p className="plan-note">{t("plan.beginnerRule")}</p>}
        {draft.mode === "normal" && <div className="plan-field-grid">
          <label>{t("plan.daily")}<input type="number" min="10" max="240" required value={draft.daily_minutes} onChange={event => change("daily_minutes", event.target.value)} /></label>
          <label>{t("plan.session")}<input type="number" min="10" max="120" required value={draft.session_minutes} onChange={event => change("session_minutes", event.target.value)} /></label>
        </div>}
        {draft.mode !== "custom" && <>
          <fieldset className="plan-weekdays"><legend>{t("plan.days")}</legend>
            {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day, index) => <label key={day}>
              <input type="checkbox" checked={draft.weekdays.includes(index)} onChange={event => { change("weekdays", event.target.checked ? [...draft.weekdays, index].sort() : draft.weekdays.filter(value => value !== index)); }} />
              <span>{t(`plan.${day}`)}</span>
            </label>)}
          </fieldset>
          {invalidDays && <p role="alert" className="plan-error">{t("plan.noDay")}</p>}
          <label htmlFor="plan-subjects">{t("plan.subjects")}<input id="plan-subjects" value={draft.subjects} maxLength={1452} onChange={event => change("subjects", event.target.value)} aria-describedby="plan-subject-hint" /></label>
          <small id="plan-subject-hint">{t("plan.subjectsHint")}</small>
        </>}
        <details className="plan-advanced"><summary>{t("plan.timezone")}</summary><label>{t("plan.timezone")}<input required maxLength={80} dir="ltr" value={draft.timezone} onChange={event => change("timezone", event.target.value)} /></label></details>
        <p className="plan-note">{t("plan.preserve")}</p>
      </fieldset>
      <div className="plan-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{t("plan.save")}</button>{profile.configured && <button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>{t("plan.cancel")}</button>}</div>
    </form>
  </section>;
}
