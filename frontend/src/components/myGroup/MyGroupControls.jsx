import { useState } from "react";
import { useI18n } from "../I18nProvider.jsx";
import { PRACTICAL_GROUPS, THEORY_GROUPS } from "../../lib/myGroup.js";
import { myGroupApi } from "../../api/myGroup.js";
import "./my-group.css";

/** A row of radio chips. Group codes are never translated, so they render LTR. */
export function GroupChoice({ label, name, options, value, onChange, disabled = false }) {
  return (
    <fieldset className="mg-choice" disabled={disabled}>
      <legend>{label}</legend>
      <div className="mg-choice-options">
        {options.map((option) => (
          <label key={option} className={`mg-chip${value === option ? " is-selected" : ""}`}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            <span dir="ltr">{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "Theory A" / "نظري A" — the label follows the language, the code does not. */
export function GroupBadge({ labelKey, code }) {
  const { t } = useI18n();
  return <span className="mg-badge"><span>{t(labelKey)}</span><strong dir="ltr">{code}</strong></span>;
}

/** First-time setup, shown inline wherever My Group has not been chosen yet. */
export function MyGroupSetup({ onSaved, idPrefix = "my-group-setup" }) {
  const { t } = useI18n();
  const [theoryGroup, setTheoryGroup] = useState("");
  const [practicalGroup, setPracticalGroup] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ready = Boolean(theoryGroup && practicalGroup);

  async function submit(event) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    try {
      onSaved(await myGroupApi.save({ theoryGroup, defaultPracticalGroup: practicalGroup }));
    } catch {
      setError(t("myGroup.saveError"));
      setSaving(false);
    }
  }

  return (
    <form className="mg-setup" onSubmit={submit} aria-labelledby={`${idPrefix}-title`}>
      <h2 id={`${idPrefix}-title`} className="mg-title">{t("myGroup.title")}</h2>
      <GroupChoice label={t("myGroup.selectTheory")} name={`${idPrefix}-theory`} options={THEORY_GROUPS} value={theoryGroup} onChange={setTheoryGroup} disabled={saving} />
      <GroupChoice label={t("myGroup.selectPractical")} name={`${idPrefix}-practical`} options={PRACTICAL_GROUPS} value={practicalGroup} onChange={setPracticalGroup} disabled={saving} />
      <div className="mg-actions">
        {error && <p className="mg-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary compact" disabled={!ready || saving}>{saving ? t("myGroup.saving") : t("myGroup.save")}</button>
      </div>
    </form>
  );
}
