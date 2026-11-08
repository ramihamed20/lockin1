import { useEffect, useRef, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { gradeRecoveryAnswer } from "./session.js";

/** Practice uses the first pass's revealed key and never calls an answer API. */
export function RecoveryPass({ questions, QuestionCard, onFinish }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState([]);
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(false);
  const region = useRef(null);
  const current = questions[index];
  useEffect(() => { region.current?.focus(); }, [index, done]);
  const correct = Object.values(answers).filter(answer => answer.was_correct).length;
  if (!current) return null;
  function answer() {
    if (!selected.length || answers[current.item.id]) return;
    setAnswers(previous => ({ ...previous, [current.item.id]: {
      was_correct: gradeRecoveryAnswer(selected, current.correctIds),
      review_item: { correct_option_ids: current.correctIds, explanation: current.explanation }
    } }));
  }
  function next() {
    if (index === questions.length - 1) setDone(true);
    else { setIndex(value => value + 1); setSelected([]); }
  }
  return <section className="review-recovery-pass" ref={region} tabIndex={-1} aria-label={t("review.practiceTitle")}>
    <header><h2>{t(done ? "review.practiceDone" : "review.practiceTitle")}</h2><p>{t("review.practiceNotice")}</p></header>
    {done ? <div className="review-session-complete"><p>{t("review.practiceScore", { correct, count: questions.length })}</p><button type="button" className="btn btn-primary" onClick={() => onFinish({ correct, count: questions.length })}>{t("review.backToSessionResult")}</button></div> : <>
      <p className="review-practice-position" dir="auto">{index + 1} / {questions.length}</p>
      <QuestionCard key={current.item.id} training item={current.item} selectedIds={selected} outcome={answers[current.item.id]} busy={false} error="" onSelect={(id, multiple) => setSelected(previous => multiple ? previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id] : [id])} onSubmit={answer} />
      {answers[current.item.id] && <footer className="review-session-controls"><button type="button" className="btn btn-primary" onClick={next}>{t(index === questions.length - 1 ? "review.finishPractice" : "review.nextQuestion")}</button></footer>}
    </>}
  </section>;
}
