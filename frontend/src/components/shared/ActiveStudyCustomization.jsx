import "./active-study-customization.css";
import { useState } from "react";
import { useI18n } from "../I18nProvider.jsx";
import { maxCustomPages, maxCustomQuestions } from "../../lib/activeStudyPages.js";
import { POMODORO_PRESETS, readPomodoroPreferences, writePomodoroPreferences } from "../../lib/pomodoroStudy.js";

/** Timer length and sound live on this device; a running clock keeps its length. */
export function PomodoroPreferences({ disabled }) {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState(readPomodoroPreferences);
  function change(next) { const value = { ...preferences, ...next }; setPreferences(value); writePomodoroPreferences(value); }
  return <div className="active-study-pomodoro-preferences">
    <fieldset disabled={disabled}>
      <legend>{t("pomodoro.length")}</legend>
      <div className="active-study-pomodoro-presets">
        {Object.entries(POMODORO_PRESETS).map(([name, item]) => <label key={name} className={preferences.preset === name ? "is-selected" : ""}>
          <input type="radio" name="pomodoro-preset" value={name} checked={preferences.preset === name} onChange={() => change({ preset: name })} />
          <span dir="ltr">{item.focus} / {item.break}</span>
        </label>)}
      </div>
    </fieldset>
    <label className="active-study-pomodoro-sound"><input type="checkbox" checked={preferences.sound} disabled={disabled} onChange={(event) => change({ sound: event.target.checked })} /><span>{t("pomodoro.sound")}</span></label>
  </div>;
}

/** The same settings UI in Focus and Paper Workspace. The server owns eligibility. */
export function ActiveStudyCustomization({ availability, value, onChange, disabled = false }) {
  const { t } = useI18n();
  if (!availability?.customization_available) return null;
  const custom = value.studyMode === "custom";
  const pagesMax = maxCustomPages(availability.eligible_study_pages);
  const questionsMax = maxCustomQuestions(availability.eligible_study_pages, value.pagesPerCheckpoint, availability.page_question_counts);
  const hasRealInventory = Array.isArray(availability.page_question_counts)
    && availability.page_question_counts.length === availability.eligible_study_pages;
  function toggle() {
    const saved = availability.custom_progress;
    onChange(value.studyMode !== "standard" ? { ...value, studyMode: "standard" } : {
      studyMode: "custom", pagesPerCheckpoint: saved?.pages_per_checkpoint || 3,
      questionsPerCheckpoint: saved?.status === "active" ? saved.questions_per_checkpoint : Math.min(saved?.questions_per_checkpoint || 5,
        maxCustomQuestions(availability.eligible_study_pages, saved?.pages_per_checkpoint || 3, availability.page_question_counts))
    });
  }
  return <div className="active-study-customization">
    <div className="active-study-style-actions"><button type="button" className="btn btn-soft compact" aria-pressed={custom} onClick={toggle} disabled={disabled}>{t(custom ? "activeStudy.standardStyle" : "activeStudy.customize")}</button>
    </div>
    {custom && <div className="active-study-custom-fields">
      <label className="field"><span>{t("activeStudy.pagesPerTest", { max: pagesMax })}</span><input type="number" min="1" max={pagesMax} step="1" value={value.pagesPerCheckpoint} disabled={disabled} onChange={(event) => {
        const pages = event.target.value === "" ? "" : Number(event.target.value);
        const limit = maxCustomQuestions(availability.eligible_study_pages, pages, availability.page_question_counts);
        onChange({ ...value, pagesPerCheckpoint: pages, questionsPerCheckpoint: Number.isInteger(value.questionsPerCheckpoint) ? Math.min(value.questionsPerCheckpoint, limit) : value.questionsPerCheckpoint });
      }} /></label>
      <label className="field"><span>{t("activeStudy.questionsPerTest", { max: questionsMax })}</span><input type="number" min="1" max={questionsMax} step="1" value={value.questionsPerCheckpoint} disabled={disabled} onChange={(event) => onChange({ ...value, questionsPerCheckpoint: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
      {hasRealInventory && <small role="status">{t("activeStudy.actualQuestionsAvailable", { max: questionsMax })}</small>}
      {availability.custom_progress?.status === "active" && availability.custom_progress.questions_per_checkpoint > questionsMax
        && <small>{t("activeStudy.savedQuestionLimit", { saved: availability.custom_progress.questions_per_checkpoint, max: questionsMax })}</small>}
      <small>{t("activeStudy.customHint")}</small>
    </div>}
  </div>;
}

export function validStudyCustomization(value, availability) {
  if (value.studyMode === "pomodoro") return Boolean(availability?.pomodoro_available);
  const saved = availability?.custom_progress;
  const resumingExisting = saved?.status === "active"
    && saved.pages_per_checkpoint === value.pagesPerCheckpoint
    && saved.questions_per_checkpoint === value.questionsPerCheckpoint;
  return value.studyMode !== "custom" || Boolean(availability?.customization_available
    && Number.isInteger(value.pagesPerCheckpoint) && value.pagesPerCheckpoint >= 1 && value.pagesPerCheckpoint <= maxCustomPages(availability.eligible_study_pages)
    && Number.isInteger(value.questionsPerCheckpoint) && value.questionsPerCheckpoint >= 1
    && (resumingExisting || value.questionsPerCheckpoint <= maxCustomQuestions(availability.eligible_study_pages, value.pagesPerCheckpoint, availability.page_question_counts)));
}

export function savedStudyProgress(value, availability) {
  return value.studyMode === "pomodoro" ? availability?.pomodoro_progress : value.studyMode === "custom" ? availability?.custom_progress : availability?.progress;
}

export function changesSavedCustomization(value, availability) {
  const saved = availability?.custom_progress;
  return value.studyMode === "custom" && saved && (saved.pages_per_checkpoint !== value.pagesPerCheckpoint || saved.questions_per_checkpoint !== value.questionsPerCheckpoint);
}
