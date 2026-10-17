import "./active-study-customization.css";
import { useI18n } from "../I18nProvider.jsx";

/** The same settings UI in Focus and Paper Workspace. The server owns eligibility. */
export function ActiveStudyCustomization({ availability, value, onChange, disabled = false, allowPomodoro = false }) {
  const { t } = useI18n();
  if (!availability?.customization_available) return null;
  const custom = value.studyMode === "custom";
  const pomodoro = value.studyMode === "pomodoro";
  function toggle() {
    const saved = availability.custom_progress;
    onChange(value.studyMode !== "standard" ? { ...value, studyMode: "standard" } : {
      studyMode: "custom", pagesPerCheckpoint: saved?.pages_per_checkpoint || 3,
      questionsPerCheckpoint: saved?.questions_per_checkpoint || 5
    });
  }
  return <div className="active-study-customization">
    <div className="active-study-style-actions"><button type="button" className="btn btn-soft compact" aria-pressed={custom} onClick={toggle} disabled={disabled}>{t(custom || pomodoro ? "activeStudy.standardStyle" : "activeStudy.customize")}</button>
      {allowPomodoro && availability.pomodoro_available && <button type="button" className="btn btn-soft compact" aria-pressed={pomodoro} onClick={() => onChange({ ...value, studyMode: pomodoro ? "standard" : "pomodoro" })} disabled={disabled}>{t("pomodoro.style")}</button>}
    </div>
    {pomodoro && <small>{t("pomodoro.hint")}</small>}
    {custom && <div className="active-study-custom-fields">
      <label className="field"><span>{t("activeStudy.pagesPerTest")}</span><input type="number" min="1" max={availability.eligible_study_pages} step="1" value={value.pagesPerCheckpoint} disabled={disabled} onChange={(event) => onChange({ ...value, pagesPerCheckpoint: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
      <label className="field"><span>{t("activeStudy.questionsPerTest")}</span><input type="number" min="1" max="20" step="1" value={value.questionsPerCheckpoint} disabled={disabled} onChange={(event) => onChange({ ...value, questionsPerCheckpoint: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
      <small>{t("activeStudy.customHint")}</small>
    </div>}
  </div>;
}

export function validStudyCustomization(value, availability) {
  if (value.studyMode === "pomodoro") return Boolean(availability?.pomodoro_available);
  return value.studyMode !== "custom" || Boolean(availability?.customization_available
    && Number.isInteger(value.pagesPerCheckpoint) && value.pagesPerCheckpoint >= 1 && value.pagesPerCheckpoint <= availability.eligible_study_pages
    && Number.isInteger(value.questionsPerCheckpoint) && value.questionsPerCheckpoint >= 1 && value.questionsPerCheckpoint <= 20);
}

export function savedStudyProgress(value, availability) {
  return value.studyMode === "pomodoro" ? availability?.pomodoro_progress : value.studyMode === "custom" ? availability?.custom_progress : availability?.progress;
}

export function changesSavedCustomization(value, availability) {
  const saved = availability?.custom_progress;
  return value.studyMode === "custom" && saved && (saved.pages_per_checkpoint !== value.pagesPerCheckpoint || saved.questions_per_checkpoint !== value.questionsPerCheckpoint);
}
