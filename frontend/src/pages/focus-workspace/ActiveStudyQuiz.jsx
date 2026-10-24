/** The Active Study checkpoint quiz shown over the Focus reader. */
import { useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Sparkles, X, Trophy } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { PomodoroResultDetails } from "../../components/shared/PomodoroStudy.jsx";
import { CheckpointExitDialog, CheckpointRestartDialog } from "../../components/shared/CheckpointExitDialog.jsx";
import { QuestionExplanation } from "../../components/shared/QuestionExplanation.jsx";
import { useExitGuard } from "../../hooks/useExitGuard.js";
import { moveWithinRadioGroup, useDialogFocus } from "./studyDialogs.jsx";
import { readActiveStudyDraft, writeActiveStudyDraft } from "./activeStudyStorage.js";

export function ActiveStudyQuiz({ quiz, answers, setAnswers, locked = {}, result, busy, onSubmit, onDismiss, onRetake, onContinue, onDiscard, onRestart, explainLinks = [], explainAvailability = "", onExplain, onOpenPage }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(() => {
    const saved = Number(readActiveStudyDraft(quiz.attempt_id)?.index);
    return Number.isInteger(saved) && saved >= 0 && saved < quiz.questions.length ? saved : 0;
  });
  const [questionDirection, setQuestionDirection] = useState("next");
  const [confirming, setConfirming] = useState(/** @type {"" | "exit" | "restart"} */ (""));
  const inQuiz = !result;
  // An unfinished test is never closed by accident: the close button, Escape
  // and the browser's Back all ask first.
  const requestExit = () => { if (inQuiz) setConfirming("exit"); else onDismiss(); };
  const dialogRef = useDialogFocus(requestExit);
  // Held for the dialog's whole life: Back asks during questions and simply
  // closes a result.
  useExitGuard({ active: true, onRequestExit: requestExit });
  const question = quiz.questions[index];
  const answered = Object.keys(answers).length;
  const isFinal = quiz.kind === "final";

  function exitAndSave() {
    writeActiveStudyDraft(quiz.attempt_id, { answers, index });
    setConfirming("");
    onDismiss();
  }

  if (result) {
    const passed = result.outcome === "passed";
    const advisory = result.outcome === "advisory";
    // As in the normal question results: explanations for the misses.
    const missed = (result.review || []).filter((item) => !item.correct);
    return <div className="workspace-v2-quiz-backdrop"><section ref={dialogRef} className={`workspace-v2-quiz-result is-${result.outcome}`} role="dialog" aria-modal="true" aria-labelledby="active-result-title" tabIndex={-1}>
      <span className="workspace-v2-result-icon">{passed ? <Trophy size={30} /> : advisory ? <Sparkles size={30} /> : <RotateCcw size={30} />}</span>
      <p>{t(isFinal ? "activeStudy.finalAssessment" : "activeStudy.checkpointResult")}</p>
      <h2 id="active-result-title" dir="ltr">{result.total ? `${result.score} / ${result.total}` : result.score}</h2>
      <strong>{t(passed ? (isFinal ? "activeStudy.sheetCompleted" : "activeStudy.nextUnlocked") : advisory ? "activeStudy.advisory" : "activeStudy.reviewPages")}</strong>
      {result.xp_awarded > 0 && <span className="workspace-v2-xp-award">+{result.xp_awarded} XP</span>}
      <PomodoroResultDetails review={result.review} summary={result.pomodoro_summary} final={isFinal} busy={busy} onOpenPage={onOpenPage} />
      {missed.length > 0 && <h3 className="workspace-v9-review-heading">{t("question.reviewMissed")}</h3>}
      {missed.length > 0 && <ol className="workspace-v2-result-review" aria-label={t("question.reviewMissed")}>
        {missed.map((item) => <li key={item.position}>
          <span className="workspace-v2-result-review-prompt" dir="auto">{item.prompt}</span>
          {item.explanation && <QuestionExplanation explanation={item.explanation} />}
          {explainLinks.some((link) => link.position === item.position) && <button type="button" disabled={busy} onClick={() => onExplain(explainLinks.find((link) => link.position === item.position))}>{t("knowledge.explainConcept")}</button>}
        </li>)}
      </ol>}
      {missed.length === 0 && explainLinks.length > 0 && <div className="workspace-v2-result-actions">{explainLinks.map((link) => <button type="button" key={link.position} disabled={busy} onClick={() => onExplain(link)}>{t("knowledge.explainConcept")} · {link.position}</button>)}</div>}
      {(missed.length > 0 || String(quiz.attempt_id).startsWith("result:")) && ["unprepared", "stale", "unavailable"].includes(explainAvailability) && <p>{t(`knowledge.mcq_${explainAvailability}`)}</p>}
      <div className="workspace-v2-result-actions">
        {passed && <button type="button" className="is-primary" onClick={onDismiss}>{t(isFinal ? "activeStudy.finish" : "activeStudy.continueStudying")}</button>}
        {advisory && <button type="button" className="is-primary" onClick={onContinue} disabled={busy}>{t("activeStudy.continueAnyway")}</button>}
        {!passed && <button type="button" onClick={onRetake} disabled={busy}><RotateCcw size={16} />{t(isFinal ? "activeStudy.retryFinal" : "activeStudy.studyPartAgain")}</button>}
        {!passed && <button type="button" onClick={onDismiss}>{t("activeStudy.returnToPages")}</button>}
      </div>
    </section></div>;
  }
  return (
    <div className="workspace-v2-quiz-backdrop">
      <section ref={dialogRef} className="workspace-v2-quiz-dialog" role="dialog" aria-modal="true" aria-labelledby="active-question-title" tabIndex={-1}>
        <header><div><span>{isFinal ? t("activeStudy.finalAssessment") : t("activeStudy.pageRange", { start: quiz.run.current_page_range.start_page, end: quiz.run.current_page_range.end_page })}</span><strong>{t("activeStudy.answeredOf", { answered, total: quiz.questions.length })}</strong></div><button type="button" className="workspace-v2-quiz-restart" onClick={() => setConfirming("restart")} disabled={busy}><RotateCcw size={15} />{t("checkpoint.restart")}</button><button type="button" onClick={requestExit} aria-label={t("activeStudy.closeTest")}><X size={19} /></button></header>
        <div className="workspace-v2-quiz-progress"><span style={{ width: `${((index + 1) / quiz.questions.length) * 100}%` }} /></div>
        <main key={index} data-question-direction={questionDirection}>
          <span className="workspace-v2-question-number">{t("activeStudy.questionOf", { index: index + 1, total: quiz.questions.length })}</span>
          <h2 id="active-question-title">{question.prompt}</h2>
          <div className="workspace-v2-answer-list" role="radiogroup" aria-label={t("activeStudy.answersFor", { index: index + 1 })}>
            {question.options.map((option, optionIndex) => <button key={option.id} type="button" role="radio" aria-checked={answers[question.id] === option.id} tabIndex={answers[question.id] === option.id || (!answers[question.id] && optionIndex === 0) ? 0 : -1} onKeyDown={moveWithinRadioGroup} className={answers[question.id] === option.id ? "is-selected" : ""} aria-disabled={Boolean(locked[question.id]) && locked[question.id] !== option.id} onClick={() => { if (!locked[question.id]) setAnswers((current) => ({ ...current, [question.id]: option.id })); }}><span>{String.fromCharCode(65 + optionIndex)}</span>{option.text}{answers[question.id] === option.id && <CheckCircle2 size={18} />}</button>)}
          </div>
        </main>
        <footer>
          <button type="button" onClick={() => { setQuestionDirection("previous"); setIndex((value) => Math.max(0, value - 1)); }} disabled={index === 0}><ChevronLeft size={17} />{t("activeStudy.previous")}</button>
          {index < quiz.questions.length - 1 ? <button type="button" className="is-primary" onClick={() => { setQuestionDirection("next"); setIndex((value) => value + 1); }} disabled={!answers[question.id]}>{t("activeStudy.next")}<ChevronRight size={17} /></button> : <button type="button" className="is-primary" onClick={onSubmit} disabled={busy || answered !== quiz.questions.length}>{t(busy ? "activeStudy.checking" : "activeStudy.submitTest")}</button>}
        </footer>
      </section>
      <CheckpointExitDialog open={confirming === "exit"} busy={busy} onSave={exitAndSave} onDiscard={() => onDiscard(() => setConfirming(""))} onCancel={() => setConfirming("")} />
      <CheckpointRestartDialog open={confirming === "restart"} busy={busy} onConfirm={() => onRestart(() => setConfirming(""))} onCancel={() => setConfirming("")} />
    </div>
  );
}
