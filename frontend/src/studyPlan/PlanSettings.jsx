import { useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { Icon } from "../lib/icons.jsx";
import { MAX_SUBJECTS, hasSubject, mergeSubjects, parseSubjects, profileDraft, profileRequest, toggleSubject } from "./model.js";

export default function PlanSettings({ profile, materials = [], onSave, onCancel, busy, initialMode }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({ ...profileDraft(profile), ...(initialMode ? { mode: initialMode } : {}) }));
  const [invalidDays, setInvalidDays] = useState(false);
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const chosen = draft.subjectList;
  const full = chosen.length >= MAX_SUBJECTS;
  const own = chosen.filter(subject => !materials.some(material => hasSubject([material.title], subject)));
  function addTyped() {
    const typed = parseSubjects(draft.subjects);
    if (!typed.length) return;
    setDraft(current => ({ ...current, subjectList: mergeSubjects(current.subjectList, typed), subjects: "" }));
  }
  return <section className="plan-settings" aria-labelledby="plan-settings-title">
    <h2 id="plan-settings-title">{t(profile.configured ? "plan.settings" : "plan.choose")}</h2>
    <form onSubmit={event => { event.preventDefault(); const invalid = draft.mode !== "custom" && !draft.weekdays.length; setInvalidDays(invalid); if (!invalid) void onSave(profileRequest({ ...draft, weekdays: draft.weekdays.length ? draft.weekdays : [0, 1, 2, 3, 4] })); }}>
      <fieldset className="plan-modes" disabled={busy}>
        <legend className="visually-hidden">{t("plan.choose")}</legend>
        {["beginning", "normal", "custom"].map(mode => <label key={mode} aria-label={t(`plan.${mode}`)} className={draft.mode === mode ? "is-selected" : ""}>
          <input type="radio" name="plan-mode" value={mode} checked={draft.mode === mode} onChange={() => change("mode", mode)} />
          <span><Icon name={{ beginning: "book-open", normal: "target", custom: "settings" }[mode]} size={20} /><strong>{t(`plan.${mode}`)}</strong></span>
        </label>)}
      </fieldset>
      <p className="plan-mode-description">{t(`plan.${draft.mode}Hint`)}</p>
      <fieldset className="plan-settings-fields" disabled={busy}>
        <legend className="visually-hidden">{t("plan.settings")}</legend>
        {draft.mode === "beginning" && <p className="plan-note">{t("plan.beginnerRule")}</p>}
        {draft.mode === "normal" && <section className="plan-advanced plan-habit-assessment" aria-label={t("smart.habitTitle")}>
          <strong>{t("smart.habitTitle")}</strong>
          <p className="plan-note">{t("smart.habitIntro")}</p>
          <div className="plan-field-grid">
            <label>{t("smart.habitBaseline")}<input type="number" min="10" max="240" placeholder="60" value={draft.habit_baseline_minutes} onChange={event => change("habit_baseline_minutes", event.target.value)} /></label>
            <label>{t("smart.habitBlock")}<input type="number" min="10" max="120" placeholder="25" value={draft.habit_block_minutes} onChange={event => change("habit_block_minutes", event.target.value)} /></label>
            <label>{t("smart.habitRhythm")}<select value={draft.study_rhythm} onChange={event => change("study_rhythm", event.target.value)}>
              {["mixed", "fragmented", "continuous"].map(value => <option key={value} value={value}>{t("smart.rhythm." + value)}</option>)}
            </select></label>
          </div>
          <label><input type="checkbox" checked={draft.gradual_growth} onChange={event => change("gradual_growth", event.target.checked)} />{t("smart.habitGrowth")}</label>
        </section>}
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
          {draft.mode === "normal" && <details className="plan-advanced"><summary>{t("smart.weeklyTime")}</summary><div className="plan-weekly-time">
            {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((key, index) => <label key={key}>{t(`plan.${key}`)}<input type="number" min="0" max="240" placeholder={String(draft.weekdays.includes(index) ? draft.daily_minutes : 0)} value={draft.weekly_minutes[index] ?? ""} onChange={event => change("weekly_minutes", { ...draft.weekly_minutes, [index]: event.target.value })} /></label>)}
          </div><label>{t("smart.reviewMinutes")}<input type="number" min="1" max="15" required value={draft.review_minutes} onChange={event => change("review_minutes", event.target.value)} /></label><small>{t("smart.weeklyTimeHint")}</small></details>}
          <div className="plan-subjects">
            <div className="plan-subjects-heading"><strong>{t("plan.yourSubjects")}</strong><small>{t("plan.subjectCount", { count: chosen.length, limit: MAX_SUBJECTS })}</small></div>
            {(materials.length > 0 || own.length > 0) && <div className="plan-chips" role="group" aria-label={t("plan.yourSubjects")}>
              {materials.map(material => {
                const on = hasSubject(chosen, material.title);
                return <button key={material.slug} type="button" className="plan-chip" aria-pressed={on} disabled={!on && full} onClick={() => change("subjectList", toggleSubject(chosen, material.title))}>
                  {on && <Icon name="check" size={16} />}<span dir="auto">{material.title}</span>
                </button>;
              })}
              {own.map(subject => <button key={subject} type="button" className="plan-chip" aria-pressed="true" aria-label={t("plan.removeSubject", { name: subject })} onClick={() => change("subjectList", toggleSubject(chosen, subject))}>
                <span dir="auto">{subject}</span><Icon name="x" size={16} />
              </button>)}
            </div>}
            {chosen.length > 1 && <details className="plan-advanced"><summary>{t("smart.subjectOrder")}</summary><ol className="plan-subject-order">{chosen.map((subject, index) => <li key={subject}><span dir="auto">{subject}</span>{[-1, 1].map(direction => <button key={direction} type="button" className="btn btn-soft" disabled={index + direction < 0 || index + direction >= chosen.length} aria-label={t(direction < 0 ? "smart.moveEarlier" : "smart.moveLater", { subject })} onClick={() => { const ordered = [...chosen]; [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]]; change("subjectList", ordered); }}>{direction < 0 ? "↑" : "↓"}</button>)}</li>)}</ol></details>}
            <div className="plan-subject-add">
              <label htmlFor="plan-subjects">{t("plan.subjects")}<input id="plan-subjects" value={draft.subjects} maxLength={1452} placeholder={t("plan.otherSubject")} disabled={full} onChange={event => change("subjects", event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTyped(); } }} aria-describedby="plan-subject-hint" /></label>
              <button type="button" className="btn btn-soft" disabled={full || !draft.subjects.trim()} onClick={addTyped}>{t("plan.addSubject")}</button>
            </div>
            <small id="plan-subject-hint">{t("plan.subjectsHint")}</small>
          </div>
        </>}
        <details className="plan-advanced"><summary>{t("plan.timezone")}</summary><label>{t("plan.timezone")}<input required maxLength={80} dir="ltr" value={draft.timezone} onChange={event => change("timezone", event.target.value)} /></label></details>
        <p className="plan-note">{t("plan.preserve")}</p>
      </fieldset>
      <div className="plan-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{t("plan.save")}</button>{profile.configured && <button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>{t("plan.cancel")}</button>}</div>
    </form>
  </section>;
}
