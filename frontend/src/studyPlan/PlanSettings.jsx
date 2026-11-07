import { useEffect, useRef, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { Icon } from "../lib/icons.jsx";
import { MAX_SUBJECTS, hasSubject, mergeSubjects, parseSubjects, profileDraft, profileRequest, toggleSubject } from "./model.js";

export default function PlanSettings({ profile, materials = [], onSave, onCancel, busy, initialMode }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({ ...profileDraft(profile), ...(initialMode ? { mode: initialMode } : {}) }));
  const [invalidDays, setInvalidDays] = useState(false);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const formRef = useRef(null);
  const settingsRef = useRef(null);
  const stepHeadingRef = useRef(null);
  const hasNavigated = useRef(false);
  const steps = draft.mode === "normal" ? ["mode", "pace", "schedule", "review"] :
    draft.mode === "beginning" ? ["mode", "schedule", "review"] : ["mode", "manual", "review"];
  const activeIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[activeIndex];
  useEffect(() => {
    if (!hasNavigated.current) return;
    stepHeadingRef.current?.focus({ preventScroll: true });
    settingsRef.current?.scrollIntoView({ block: "start" });
  }, [activeIndex]);
  function nextStep() {
    if (currentStep === "schedule" && draft.mode !== "custom" && !draft.weekdays.length) {
      setInvalidDays(true);
      return;
    }
    setInvalidDays(false);
    if (!formRef.current?.reportValidity()) return;
    hasNavigated.current = true;
    setStepIndex(index => Math.min(index + 1, steps.length - 1));
  }
  function goBack() { setInvalidDays(false); hasNavigated.current = true; setStepIndex(index => Math.max(0, index - 1)); }
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const chosen = draft.subjectList;
  const full = chosen.length >= MAX_SUBJECTS;
  const own = chosen.filter(subject => !materials.some(material => hasSubject([material.title], subject)));
  const searchTerm = subjectSearch.trim().toLocaleLowerCase();
  const visibleMaterials = materials.filter((material, index) =>
    searchTerm ? material.title?.toLocaleLowerCase().includes(searchTerm) :
      showAllSubjects || index < 6 || hasSubject(chosen, material.title)
  );
  function addTyped() {
    const typed = parseSubjects(draft.subjects);
    if (!typed.length) return;
    setDraft(current => ({ ...current, subjectList: mergeSubjects(current.subjectList, typed), subjects: "" }));
  }
  return <section ref={settingsRef} className="plan-settings" aria-labelledby="plan-settings-title">
    <h2 id="plan-settings-title">{t(profile.configured ? "plan.settings" : "plan.choose")}</h2>
    <nav className="plan-wizard-progress" aria-label={t("plan.wizard.progress")}>
      <span aria-live="polite">{t("plan.wizard.count", { current: activeIndex + 1, total: steps.length })}</span>
      <div className="plan-wizard-steps">{steps.map((name, index) => <button key={name} type="button" disabled={busy || index > activeIndex} aria-current={index === activeIndex ? "step" : undefined} onClick={() => { setInvalidDays(false); hasNavigated.current = true; setStepIndex(index); }}>
        <span className="plan-wizard-number">{index < activeIndex ? <Icon name="check" size={13} /> : index + 1}</span>
        <span>{t("plan.wizard." + name)}</span>
      </button>)}</div>
    </nav>
    <h3 className="plan-wizard-current" ref={stepHeadingRef} tabIndex={-1}>{t("plan.wizard." + currentStep)}</h3>
    <form ref={formRef} onSubmit={event => {
      event.preventDefault();
      if (currentStep !== "review") { nextStep(); return; }
      void onSave(profileRequest({ ...draft, weekdays: draft.weekdays.length ? draft.weekdays : [0, 1, 2, 3, 4] }));
    }}>
      {currentStep === "mode" && <>
      <fieldset className="plan-modes" disabled={busy}>
        <legend className="visually-hidden">{t("plan.choose")}</legend>
        {["beginning", "normal", "custom"].map(mode => <label key={mode} aria-label={t(`plan.${mode}`)} className={draft.mode === mode ? "is-selected" : ""}>
          <input type="radio" name="plan-mode" value={mode} checked={draft.mode === mode} onChange={() => change("mode", mode)} />
          <span><Icon name={{ beginning: "book-open", normal: "target", custom: "settings" }[mode]} size={20} /><strong>{t(`plan.${mode}`)}</strong></span>
        </label>)}
      </fieldset>
      <p className="plan-mode-description">{t(`plan.${draft.mode}Hint`)}</p>
      </>}
      <fieldset className="plan-settings-fields" disabled={busy}>
        <legend className="visually-hidden">{t("plan.settings")}</legend>
        {currentStep === "schedule" && draft.mode === "beginning" && <p className="plan-note">{t("plan.beginnerRule")}</p>}
        {currentStep === "pace" && draft.mode === "normal" && <section className="plan-habit-assessment" aria-label={t("smart.habitTitle")}>
          <p className="plan-note">{t("plan.wizard.paceHint")}</p>
          <div className="plan-field-grid">
            <label>{t("smart.habitBaseline")}<input type="number" min="10" max="240" placeholder="60" value={draft.habit_baseline_minutes} onChange={event => change("habit_baseline_minutes", event.target.value)} /></label>
            <label>{t("plan.daily")}<input type="number" min="10" max="240" required value={draft.daily_minutes} onChange={event => change("daily_minutes", event.target.value)} /></label>
          </div>
          <label>{t("smart.habitRhythm")}<select value={draft.study_rhythm} onChange={event => change("study_rhythm", event.target.value)}>
            {["mixed", "fragmented", "continuous"].map(value => <option key={value} value={value}>{t("smart.rhythm." + value)}</option>)}
          </select></label>
          <details className="plan-advanced plan-wizard-options"><summary>{t("plan.wizard.advanced")}</summary>
            <div className="plan-field-grid">
              <label>{t("plan.session")}<input type="number" min="10" max="120" required value={draft.session_minutes} onChange={event => change("session_minutes", event.target.value)} /></label>
              <label>{t("smart.habitBlock")}<input type="number" min="10" max="120" placeholder="25" value={draft.habit_block_minutes} onChange={event => change("habit_block_minutes", event.target.value)} /></label>
            </div>
            <label className="plan-habit-growth"><input type="checkbox" checked={draft.gradual_growth} onChange={event => change("gradual_growth", event.target.checked)} />{t("smart.habitGrowth")}</label>
          </details>
        </section>}
        {currentStep === "schedule" && draft.mode !== "custom" && <>
          <fieldset className="plan-weekdays"><legend>{t("plan.days")}</legend>
            {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day, index) => <label key={day}>
              <input type="checkbox" checked={draft.weekdays.includes(index)} onChange={event => { change("weekdays", event.target.checked ? [...draft.weekdays, index].sort() : draft.weekdays.filter(value => value !== index)); }} />
              <span>{t(`plan.${day}`)}</span>
            </label>)}
          </fieldset>
          {invalidDays && <p role="alert" className="plan-error">{t("plan.noDay")}</p>}

          {draft.mode === "normal" && materials.length > 0 && <details className="plan-advanced">
            <summary>{t("smart.readiness")}</summary>
            <p>{t("smart.readinessHint")}</p>
            {materials.map(material => <label className="field" key={material.slug}>
              <span dir="auto">{material.title}</span>
              <select value={draft.subject_readiness[material.slug] || ""} onChange={event => {
                const values = { ...draft.subject_readiness };
                if (event.target.value) values[material.slug] = event.target.value;
                else delete values[material.slug];
                change("subject_readiness", values);
              }}>
                <option value="">{t("smart.readiness.unset")}</option>
                {["not_started", "started", "needs_practice", "ready_review"].map(level =>
                  <option key={level} value={level}>{t("smart.readiness." + level)}</option>
                )}
              </select>
            </label>)}
          </details>}
          <div className="plan-subjects">
            <div className="plan-subjects-heading"><strong>{t("plan.yourSubjects")}</strong><small>{t("plan.subjectCount", { count: chosen.length, limit: MAX_SUBJECTS })}</small></div>
            {materials.length > 6 && <label className="plan-material-search">{t("plan.wizard.findSubject")}
              <input type="search" value={subjectSearch} onChange={event => setSubjectSearch(event.target.value)} placeholder={t("plan.wizard.findSubjectHint")} />
            </label>}
            {(visibleMaterials.length > 0 || own.length > 0) && <div className="plan-chips" role="group" aria-label={t("plan.yourSubjects")}>
              {visibleMaterials.map(material => {
                const on = hasSubject(chosen, material.title);
                return <button key={material.slug} type="button" className="plan-chip" aria-pressed={on} disabled={!on && full} onClick={() => change("subjectList", toggleSubject(chosen, material.title))}>
                  {on && <Icon name="check" size={16} />}<span dir="auto">{material.title}</span>
                </button>;
              })}
              {own.map(subject => <button key={subject} type="button" className="plan-chip" aria-pressed="true" aria-label={t("plan.removeSubject", { name: subject })} onClick={() => change("subjectList", toggleSubject(chosen, subject))}>
                <span dir="auto">{subject}</span><Icon name="x" size={16} />
              </button>)}
            </div>}
            {materials.length > 6 && !searchTerm && <button className="plan-show-subjects" type="button" aria-expanded={showAllSubjects} onClick={() => setShowAllSubjects(value => !value)}>{t(showAllSubjects ? "plan.wizard.showLess" : "plan.wizard.showMore", { count: materials.length })}<Icon name={showAllSubjects ? "chevron-up" : "chevron-down"} size={15} /></button>}
            {chosen.length > 1 && <details className="plan-advanced"><summary>{t("smart.subjectOrder")}</summary><ol className="plan-subject-order">{chosen.map((subject, index) => <li key={subject}><span dir="auto">{subject}</span>{[-1, 1].map(direction => <button key={direction} type="button" className="btn btn-soft" disabled={index + direction < 0 || index + direction >= chosen.length} aria-label={t(direction < 0 ? "smart.moveEarlier" : "smart.moveLater", { subject })} onClick={() => { const ordered = [...chosen]; [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]]; change("subjectList", ordered); }}>{direction < 0 ? "↑" : "↓"}</button>)}</li>)}</ol></details>}
            <div className="plan-subject-add">
              <label htmlFor="plan-subjects">{t("plan.subjects")}<input id="plan-subjects" value={draft.subjects} maxLength={1452} placeholder={t("plan.otherSubject")} disabled={full} onChange={event => change("subjects", event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTyped(); } }} aria-describedby="plan-subject-hint" /></label>
              <button type="button" className="btn btn-soft" disabled={full || !draft.subjects.trim()} onClick={addTyped}>{t("plan.addSubject")}</button>
            </div>
            <small id="plan-subject-hint">{t("plan.subjectsHint")}</small>
          </div>
        </>}
        {currentStep === "manual" && <div className="plan-wizard-manual"><Icon name="calendar" size={24} /><p>{t("plan.wizard.manualCopy")}</p></div>}
        {currentStep === "review" && <div className="plan-wizard-review">
          <h3>{t("plan.wizard.summary")}</h3>
          <dl>
            <div><dt>{t("plan.wizard.mode")}</dt><dd>{t("plan." + draft.mode)}</dd></div>
            {draft.mode === "normal" && <div><dt>{t("plan.daily")}</dt><dd>{t("studyPlan.minutesValue", { count: Number(draft.daily_minutes) || 0 })}</dd></div>}
            {draft.mode !== "custom" && <div><dt>{t("plan.days")}</dt><dd>{t("plan.wizard.studyDays", { count: draft.weekdays.length })}</dd></div>}
            {draft.mode !== "custom" && <div><dt>{t("plan.subjects")}</dt><dd dir="auto">{mergeSubjects(chosen, parseSubjects(draft.subjects)).join(" · ") || t("plan.wizard.unsetSubjects")}</dd></div>}
          </dl>
          <details className="plan-advanced plan-wizard-options"><summary>{t("plan.wizard.advanced")}</summary>
            {draft.mode === "normal" && <div className="plan-advanced plan-wizard-weekly"><strong>{t("smart.weeklyTime")}</strong><div className="plan-weekly-time">
            {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((key, index) => <label key={key}>{t(`plan.${key}`)}<input type="number" min="0" max="240" placeholder={String(draft.weekdays.includes(index) ? draft.daily_minutes : 0)} value={draft.weekly_minutes[index] ?? ""} onChange={event => change("weekly_minutes", { ...draft.weekly_minutes, [index]: event.target.value })} /></label>)}
          </div><label>{t("smart.reviewMinutes")}<input type="number" min="1" max="15" required value={draft.review_minutes} onChange={event => change("review_minutes", event.target.value)} /></label><small>{t("smart.weeklyTimeHint")}</small></div>}
          </details>
          <p className="plan-note">{t("plan.preserve")}</p>
        </div>}
      </fieldset>
      <div className="plan-actions plan-wizard-actions">
        {activeIndex > 0 && <button className="btn btn-soft" type="button" disabled={busy} onClick={goBack}><Icon name="chevron-left" size={16} />{t("plan.wizard.back")}</button>}
        <button className="btn btn-primary plan-wizard-next" type="submit" disabled={busy}>{t(currentStep === "review" ? "plan.save" : "plan.wizard.next")}<Icon name={currentStep === "review" ? "check" : "chevron-right"} size={16} /></button>
        {profile.configured && <button className="btn btn-soft" type="button" disabled={busy} onClick={onCancel}>{t("plan.cancel")}</button>}
      </div>
    </form>
  </section>;
}
