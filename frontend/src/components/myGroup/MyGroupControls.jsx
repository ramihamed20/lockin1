import { useEffect, useRef, useState } from "react";
import { useI18n } from "../I18nProvider.jsx";
import { myGroupApi } from "../../api/myGroup.js";
import "./my-group.css";

/** A row of radio chips. Group codes are never translated, so they render LTR. */
export function GroupChoice({ label, name, options, value, onChange, disabled = false, hint = "" }) {
  return (
    <fieldset className="mg-choice" disabled={disabled}>
      <legend>{label}</legend>
      {hint && <p className="mg-choice-hint">{hint}</p>}
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

const STEPS = ["theory", "practical", "review"];

/**
 * Choosing (or changing) My Group: Theory group, then Practical group, then a
 * review that must be confirmed. Nothing is preselected for a first choice; a
 * change starts from the current groups. The groups offered are the student's
 * own year's, as the server reports them in `options`.
 *
 * Saving writes the account's choice on the server, which is the only thing a
 * group change touches. `initial.practicalOverrides` (Year 2) are kept.
 */
export function MyGroupFlow({ options, initial = null, mode = "setup", idPrefix = "my-group-flow", onSaved, onCancel = null, onSkip = null, headingLevel = 2 }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [theoryGroup, setTheoryGroup] = useState(initial?.theoryGroup || "");
  const [practicalGroup, setPracticalGroup] = useState(initial?.practicalGroup || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef(null);
  const firstRender = useRef(true);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const current = STEPS[step];
  const ready = current === "theory" ? Boolean(theoryGroup) : current === "practical" ? Boolean(practicalGroup) : true;
  const unchanged = mode === "change" && initial && theoryGroup === initial.theoryGroup && practicalGroup === initial.practicalGroup;

  // Each step announces itself to screen readers and keyboard users.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      // Year 2's per-subject choices name their own schedule, so they survive a
      // change of default group; the server drops any that now equal it.
      onSaved(await myGroupApi.save({ theoryGroup, defaultPracticalGroup: practicalGroup, practicalOverrides: initial?.practicalOverrides || {} }));
    } catch {
      setError(t("myGroup.saveError"));
      setSaving(false);
    }
  }

  function next(event) {
    event.preventDefault();
    if (!ready) return;
    if (current === "review") void confirm();
    else setStep(step + 1);
  }

  const stepTitle = current === "theory" ? t("myGroup.selectTheory") : current === "practical" ? t("myGroup.selectPractical") : t("myGroup.review");
  return (
    <form className={`mg-flow mg-flow--${mode}`} onSubmit={next} aria-labelledby={`${idPrefix}-title`}>
      <div className="mg-flow-head">
        <p className="mg-flow-step">{t("myGroup.step", { current: step + 1, total: STEPS.length })}</p>
        <Heading id={`${idPrefix}-title`} className="mg-title" ref={headingRef} tabIndex={-1}>{mode === "change" ? t("myGroup.changeGroup") : t("myGroup.title")}</Heading>
        <div className="mg-flow-progress" aria-hidden="true">{STEPS.map((name, index) => <i key={name} className={index <= step ? "is-done" : ""} />)}</div>
      </div>

      {current === "theory" && (
        <GroupChoice label={stepTitle} name={`${idPrefix}-theory`} options={options.theory_groups} value={theoryGroup} onChange={(group) => { setTheoryGroup(group); setPracticalGroup(initial && group === initial.theoryGroup ? initial.practicalGroup : ""); }} disabled={saving} />
      )}
      {current === "practical" && (
        <GroupChoice
          label={stepTitle}
          hint={t("myGroup.practicalInside", { group: theoryGroup })}
          name={`${idPrefix}-practical`}
          options={options.practical_groups}
          value={practicalGroup}
          onChange={setPracticalGroup}
          disabled={saving}
        />
      )}
      {current === "review" && (
        <div className="mg-review">
          <p className="mg-review-label">{stepTitle}</p>
          <dl className="mg-review-card">
            <div><dt>{t("myGroup.theoryGroup")}</dt><dd dir="ltr">{theoryGroup}</dd></div>
            <div><dt>{t("myGroup.practicalGroup")}</dt><dd dir="ltr">{practicalGroup}</dd></div>
          </dl>
          <p className="mg-muted">{mode === "change" ? t("myGroup.changeNote") : t("myGroup.setupNote")}</p>
        </div>
      )}

      <div className="mg-actions mg-flow-actions">
        {error && <p className="mg-error" role="alert">{error}</p>}
        {step === 0 && onSkip && <button type="button" className="mg-link-button" onClick={onSkip} disabled={saving}>{t("myGroup.later")}</button>}
        {step === 0 && onCancel && <button type="button" className="btn btn-soft compact" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>}
        {step > 0 && <button type="button" className="btn btn-soft compact" onClick={() => setStep(step - 1)} disabled={saving}>{t("myGroup.back")}</button>}
        <button type="submit" className="btn btn-primary compact" disabled={!ready || saving || (current === "review" && unchanged)}>
          {current === "review" ? (saving ? t("myGroup.saving") : t("myGroup.confirm")) : t("myGroup.next")}
        </button>
      </div>
    </form>
  );
}
