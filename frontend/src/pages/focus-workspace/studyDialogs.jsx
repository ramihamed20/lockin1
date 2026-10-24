/** Dialog focus handling and the study mode chooser of the Focus workspace. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Brain, Check, ChevronRight, Timer } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { ActiveStudyCustomization, PomodoroPreferences, validStudyCustomization, changesSavedCustomization } from "../../components/shared/ActiveStudyCustomization.jsx";

/**
 * Arrow keys move between the radios of one group and choose as they go, as a
 * native radio group does. Left and right follow the reading direction.
 */
export function moveWithinRadioGroup(event) {
  const steps = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 };
  let step = steps[event.key];
  if (!step) return;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && window.getComputedStyle(group).direction === "rtl") step = -step;
  const radios = [...group.querySelectorAll('[role="radio"]:not(:disabled):not([aria-disabled="true"])')];
  const index = radios.indexOf(document.activeElement);
  if (index < 0 || radios.length < 2) return;
  event.preventDefault();
  const next = radios[(index + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

export function useDialogFocus(onEscape = null) {
  const dialogRef = useRef(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    const backdrop = dialog.parentElement;
    const workspace = dialog.closest(".workspace-v2");
    const hiddenSiblings = [];
    workspace?.querySelectorAll(":scope > *").forEach((element) => {
      if (element === backdrop) return;
      const htmlElement = /** @type {HTMLElement} */ (element);
      hiddenSiblings.push({ element: htmlElement, ariaHidden: htmlElement.getAttribute("aria-hidden"), inert: htmlElement.inert });
      htmlElement.setAttribute("aria-hidden", "true");
      htmlElement.inert = true;
    });
    const focusableSelector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";
    const focusFirst = () => {
      const first = dialog.querySelector(focusableSelector);
      if (first instanceof HTMLElement) first.focus();
      else dialog.focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        // The dialog answers this Escape. Letting it bubble on would hand the
        // same keypress to a confirmation this handler has just opened, whose
        // listener is already on the document by then, and it would close again.
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)].filter((element) => !element.hidden && element.getClientRects().length);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      dialog.removeEventListener("keydown", handleKeyDown);
      hiddenSiblings.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        element.inert = inert;
      });
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return dialogRef;
}

export const ACTIVE_DIFFICULTIES = [
  ["easy", "questions.difficulty.easy", "materials.activeDifficulty.easy"],
  ["medium", "questions.difficulty.medium", "materials.activeDifficulty.medium"],
  ["hard", "questions.difficulty.hard", "materials.activeDifficulty.hard"]
];

export function StudyModeDialog({ customization, setCustomization, availability, difficulty, setDifficulty, activeAvailable, restartProgress, completed = [], busy, checking = false, error, onNormal, onActive, onRestart, activeOnly = false }) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmCustom, setConfirmCustom] = useState(false);
  // Active Study and Pomodoro are separate choices. Once Pomodoro is offered the
  // student picks one from a list and can step back out of either panel.
  const [view, setView] = useState(customization.studyMode === "pomodoro" ? "pomodoro" : "choose");
  const picker = Boolean(availability?.pomodoro_available) || view !== "choose";
  const pomodoroView = picker && view === "pomodoro";
  function chooseStyle(next) {
    setView(next);
    setConfirmCustom(false);
    setCustomization(next === "pomodoro"
      ? { ...customization, studyMode: "pomodoro" }
      : { ...customization, studyMode: customization.studyMode === "pomodoro" ? "standard" : customization.studyMode });
  }
  function backToStyles() {
    setView("choose");
    setConfirmCustom(false);
    setConfirmRestart(false);
    setCustomization({ ...customization, studyMode: "standard" });
  }
  const showCards = !picker || view === "choose";
  return (
    <div className="workspace-v2-mode-backdrop">
      <section ref={dialogRef} className={`workspace-v2-mode-dialog${customization.studyMode !== "standard" ? " has-customization" : ""}`} role="dialog" aria-modal="true" aria-labelledby="study-mode-title" aria-describedby="study-mode-hint" tabIndex={-1}>
        <h1 id="study-mode-title">{t(activeOnly ? "materials.startActiveStudy" : "materials.chooseStudyMode")}</h1>
        <p id="study-mode-hint" dir="auto">{t(activeOnly ? "materials.chooseDifficulty" : "materials.switchModesLater")}</p>
        {picker && view !== "choose" && <button type="button" className="workspace-v2-mode-back" onClick={backToStyles} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />{t("pomodoro.backToStyles")}</button>}
        <div className="workspace-v2-mode-grid">
          {!activeOnly && showCards && <button type="button" className="workspace-v2-mode-card" onClick={onNormal} disabled={busy}>
            <span className="workspace-v2-mode-icon"><BookOpen size={20} /></span>
            <span className="workspace-v2-mode-copy"><strong>{t("materials.normalStudy")}</strong><small>{t("materials.readSheetDescription")}</small></span>
            <ChevronRight className="workspace-v2-mode-chevron" size={18} aria-hidden="true" />
          </button>}
          {picker && view === "choose" && <>
            <button type="button" className="workspace-v2-mode-card" onClick={() => chooseStyle("active")} disabled={busy}>
              <span className="workspace-v2-mode-icon"><Brain size={20} /></span>
              <span className="workspace-v2-mode-copy"><strong>{t("materials.activeStudy")}</strong><small>{t(availability?.customization_available ? "activeStudy.pagesDescription" : "materials.activeStudyDescription")}</small></span>
              <ChevronRight className="workspace-v2-mode-chevron" size={18} aria-hidden="true" />
            </button>
            <button type="button" className="workspace-v2-mode-card" onClick={() => chooseStyle("pomodoro")} disabled={busy}>
              <span className="workspace-v2-mode-icon"><Timer size={20} /></span>
              <span className="workspace-v2-mode-copy"><strong>{t("pomodoro.style")}</strong><small>{t("pomodoro.description")}</small></span>
              <ChevronRight className="workspace-v2-mode-chevron" size={18} aria-hidden="true" />
            </button>
          </>}
          {(!picker || view !== "choose") && <div className="workspace-v2-mode-card is-active-study">
            <div className="workspace-v2-mode-heading">
              <span className="workspace-v2-mode-icon">{pomodoroView ? <Timer size={20} /> : <Brain size={20} />}</span>
              <span className="workspace-v2-mode-copy"><strong>{t(pomodoroView ? "pomodoro.style" : "materials.activeStudy")}</strong><small>{pomodoroView ? t("pomodoro.description") : t(availability?.customization_available ? "activeStudy.pagesDescription" : "materials.activeStudyDescription")}</small></span>
            </div>
            <div className="workspace-v2-difficulty" role="radiogroup" aria-label={t("materials.activeDifficultyGroup")}>
              {ACTIVE_DIFFICULTIES.map(([id, labelKey, detailKey]) => { const done = completed.includes(id); return <button key={id} type="button" role="radio" aria-label={`${t(labelKey)}: ${t(detailKey)}${done ? ` · ${t("materials.activeDifficultyDone")}` : ""}`} title={t(detailKey)} aria-checked={difficulty === id} tabIndex={difficulty === id ? 0 : -1} onKeyDown={moveWithinRadioGroup} className={difficulty === id ? "is-selected" : ""} onClick={() => { setDifficulty(id); setConfirmRestart(false); }}>{t(labelKey)}{done && <Check className="workspace-v2-difficulty-done" size={13} strokeWidth={2.6} aria-hidden="true" />}</button>; })}
            </div>
            {pomodoroView ? <div className="active-study-customization"><PomodoroPreferences disabled={busy} /></div>
              : <ActiveStudyCustomization availability={availability} value={customization} onChange={(value) => { setCustomization(value); setConfirmCustom(false); }} disabled={busy} />}
            {confirmCustom && <div className="workspace-v2-study-restart"><p>{t("activeStudy.replaceCustom")}</p><button type="button" onClick={() => setConfirmCustom(false)}>{t("common.cancel")}</button><button type="button" onClick={() => onActive(true)} disabled={busy}>{t("activeStudy.newCustom")}</button></div>}
            <button type="button" className="workspace-v2-active-start" onClick={() => changesSavedCustomization(customization, availability) ? setConfirmCustom(true) : onActive(false)} disabled={busy || !activeAvailable || !validStudyCustomization(customization, availability)}>{t(checking ? "materials.activeStudyChecking" : busy ? "materials.activeStudyStarting" : activeAvailable ? "materials.startActiveStudy" : "materials.activeStudyUnavailable")}<ChevronRight size={16} /></button>
            {restartProgress && <div className="workspace-v2-study-restart">
              {!confirmRestart ? <button type="button" onClick={() => setConfirmRestart(true)} disabled={busy}>{t("materials.restartSavedStudy", { difficulty: t(`questions.difficulty.${difficulty}`) })}</button> : <>
                <p>{t("materials.restartStudyConfirm")}</p>
                <div><button type="button" onClick={() => setConfirmRestart(false)} disabled={busy}>{t("common.cancel")}</button><button type="button" className="is-confirm" onClick={onRestart} disabled={busy}>{t(busy ? "materials.restartingStudy" : "materials.restartStudyNow")}</button></div>
              </>}
            </div>}
          </div>}
        </div>
        {error && <p className="workspace-v2-mode-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
