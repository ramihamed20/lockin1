import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { reviewApi } from "../api/review.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { Icon } from "../lib/icons.jsx";
import { formatRelativeTime } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";

function relativeTime(value, t) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return t("review.recently");
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return formatRelativeTime(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatRelativeTime(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatRelativeTime(hours, "hour");
  return formatRelativeTime(Math.round(hours / 24), "day");
}

function sourceDescription(item, t) {
  const source = item?.original_source || {};
  const parts = [item?.subject_label, source.label || source.type];
  if (source.question_index) parts.push(t("review.questionIndex", { index: source.question_index }));
  return parts.filter(Boolean).join(" · ") || t("review.sourceUnavailable");
}

async function loadReviewCenter() {
  const [bank, queue, weekly] = await Promise.all([
    reviewApi.getBank(),
    reviewApi.getQueue(),
    reviewApi.getWeeklyRecall()
  ]);
  return { bank, queue, weekly };
}

export default function ReviewCenter() {
  const { t } = useI18n();
  const review = useAsyncData(loadReviewCenter, []);
  if (review.loading) return <ReviewCenterSkeleton />;
  if (review.error) return <Page title={t("review.center")}><ErrorPanel message={review.error} onRetry={review.reload} /></Page>;

  const { bank, queue, weekly } = review.data;
  const weeklyStatus = weekly.session?.status;
  const weeklyCount = weekly.session?.total_questions || weekly.eligible_count || 0;
  return (
    <Page title={t("review.center")} subtitle={t("review.centerSubtitle")}>
      <div className="review-center-layout">
        <section className="review-bank-entry" aria-labelledby="review-bank-title">
          <div className="review-bank-entry-copy">
            <span className="review-feature-icon"><Icon name="target" size={22} /></span>
            <div>
              <p className="eyebrow">{t("review.personalized")}</p>
              <h2 id="review-bank-title">{t("review.bank")}</h2>
              <p dir="auto">{bank.active_count ? t("review.needReview", { count: bank.active_count, subjects: t("review.subjectCount", { count: bank.subjects.length }) }) : t("review.allCaughtUp")}</p>
            </div>
          </div>
          <div className="review-bank-entry-actions">
            <dl className="review-bank-summary">
              <div><dt>{t("review.toReview")}</dt><dd>{bank.active_count}</dd></div>
              <div><dt>{t("review.masteredThisWeek")}</dt><dd>{bank.mastered_this_week}</dd></div>
            </dl>
            <Link className="btn btn-primary" to="/review/bank">{t("review.openBank")} <Icon name="arrow-up-right" size={16} /></Link>
          </div>
        </section>

        <section className={`weekly-recall-entry ${weekly.available ? "is-available" : ""}`} aria-labelledby="weekly-recall-title">
          <div>
            <span className="review-feature-icon"><Icon name="calendar" size={20} /></span>
            <div><h2 id="weekly-recall-title">{t("review.weekly")}</h2><p dir="auto">{weeklyStatus === "completed" ? t("review.weeklyDone") : weekly.session ? t("review.weeklySessionCopy", { count: weeklyCount }) : weekly.available ? t("review.weeklyReady", { count: weeklyCount }) : t("review.weeklyPrepare")}</p></div>
          </div>
          {weekly.available ? <Link className="btn btn-soft" to="/review/weekly">{weeklyStatus === "completed" ? t("review.viewResults") : weekly.session ? t("review.resumeWeekly") : t("review.startWeekly")}</Link> : <span className="pill">{t("review.notReady")}</span>}
        </section>

        <section className="review-center-section" aria-labelledby="subjects-title">
          <header className="review-section-heading"><div><h2 id="subjects-title">{t("review.subjectsTitle")}</h2><p>{t("review.subjectsCopy")}</p></div><Link to="/review/bank">{t("review.viewAll")}</Link></header>
          {bank.subjects.length ? <div className="review-subject-list">{bank.subjects.slice(0, 4).map((subject) => <SubjectRow key={subject.subject_key} subject={subject} />)}</div> : <EmptyState title={t("review.caughtUpTitle")} text={t("review.caughtUpText")} />}
        </section>

        <section className="review-center-section" aria-labelledby="recent-mistakes-title">
          <header className="review-section-heading"><div><h2 id="recent-mistakes-title">{t("review.recentMistakes")}</h2><p>{t("review.recentMistakesCopy")}</p></div><span>{queue.count}</span></header>
          {queue.results.length ? <div className="recent-mistake-list">{queue.results.map((item) => <RecentMistake key={item.id} item={item} />)}</div> : <EmptyState title={t("review.noMistakesTitle")} text={t("review.noMistakesText")} />}
        </section>
      </div>
    </Page>
  );
}

function ReviewCenterSkeleton() {
  const { t } = useI18n();
  return <Page title={t("review.center")}><div className="review-center-skeleton" aria-label={t("review.loadingCenter")} aria-busy="true"><span /><span /><span /></div></Page>;
}

function SubjectRow({ subject }) {
  const { t } = useI18n();
  return <Link className="review-subject-row" to={`/review/bank/${encodeURIComponent(subject.subject_key)}`}><span><strong dir="auto">{subject.subject_label_snapshot}</strong><small dir="auto">{subject.repeated_count ? t("review.repeatedMistakes", { count: subject.repeated_count }) : t("review.readyForReview")}</small></span><span className="review-subject-count" dir="auto">{t("review.questionCount", { count: subject.question_count })}<Icon name="chevron-right" size={18} /></span></Link>;
}

function RecentMistake({ item }) {
  const { t } = useI18n();
  const selected = Array.isArray(item.selected_answers) ? item.selected_answers.join(", ") : t("review.noAnswer");
  const correct = Array.isArray(item.correct_answers) ? item.correct_answers.join(", ") : t("review.answerUnavailable");
  const content = <><div className="recent-mistake-topline"><span className="pill" dir="auto">{item.source_type?.replaceAll("_", " ") || t("review.question")}</span><time dateTime={item.answered_at} dir="auto">{relativeTime(item.answered_at, t)}</time></div><h3 dir="auto">{item.prompt}</h3><dl className="recent-mistake-answers"><div><dt>{t("review.yourAnswer")}</dt><dd dir="auto">{selected}</dd></div><div><dt>{t("review.correctAnswer")}</dt><dd dir="auto">{correct}</dd></div></dl><p dir="auto">{item.subject_label || t("review.otherSubject")} · {item.source_label || item.original_source?.label || t("review.sourceUnavailable")}{item.source_question_index ? ` · ${t("review.questionIndex", { index: item.source_question_index })}` : ""}</p></>;
  return item.subject_key ? <Link className="recent-mistake" to={`/review/bank/${encodeURIComponent(item.subject_key)}`}>{content}</Link> : <article className="recent-mistake">{content}</article>;
}

export function ReviewBank() {
  const { t } = useI18n();
  const bank = useAsyncData(() => reviewApi.getBank(), []);
  if (bank.loading) return <LoadingPanel />;
  if (bank.error) return <Page title={t("review.bank")}><ErrorPanel message={bank.error} onRetry={bank.reload} /></Page>;
  return (
    <Page title={t("review.bank")} subtitle={t("review.bankSubtitle")}>
      <section className="review-bank-overview" aria-labelledby="review-bank-overview-title">
        <div><p className="eyebrow">{t("review.activeReview")}</p><h2 id="review-bank-overview-title" dir="auto">{bank.data.active_count ? t("review.questionsToReview", { count: bank.data.active_count }) : t("review.caughtUpTitle")}</h2><p dir="auto">{bank.data.active_count ? t("review.masteredCopy", { count: bank.data.mastered_this_week }) : t("review.caughtUpBankText")}</p></div>
        <Link className="btn btn-soft" to="/review">{t("review.backToCenter")}</Link>
      </section>
      {bank.data.subjects.length ? <section className="review-bank-subjects" aria-label={t("review.bankSubjectsLabel")}>{bank.data.subjects.map((subject) => <SubjectRow key={subject.subject_key} subject={subject} />)}</section> : <EmptyState title={t("review.caughtUpTitle")} text={t("review.caughtUpText")} />}
    </Page>
  );
}

function ReviewQuestionCard({ item, selectedIds = [], onSelect, outcome, busy, error, onSubmit }) {
  const { t } = useI18n();
  const correctIds = new Set(outcome?.review_item?.correct_option_ids || []);
  const multiple = item.answer_mode === "multiple";
  return (
    <article className="review-session-question">
      <div className="review-question-source"><span>{t("review.originallyFrom")}</span><strong dir="auto">{sourceDescription(item, t)}</strong></div>
      <h2 dir="auto">{item.prompt}</h2>
      <fieldset className="review-choice-list" disabled={busy || Boolean(outcome)}>
        <legend className="sr-only">{t(multiple ? "review.chooseEvery" : "review.chooseOne")}</legend>
        {(item.options || []).map((option, index) => {
          const selected = selectedIds.includes(option.id);
          const isCorrect = Boolean(outcome) && correctIds.has(option.id);
          const isWrong = Boolean(outcome) && selected && !isCorrect;
          const state = isCorrect ? "is-correct" : isWrong ? "is-wrong" : selected ? "is-selected" : "";
          return <label className={`review-choice ${state}`} key={option.id}><input type={multiple ? "checkbox" : "radio"} name={`review-answer-${item.id}`} value={option.id} checked={selected} onChange={() => onSelect(option.id, multiple)} /><span className="review-choice-letter">{String.fromCharCode(65 + index)}</span><span dir="auto">{option.text || t("review.optionUnavailable")}</span>{isCorrect && <span className="review-choice-state"><Icon name="check" size={18} /> {t("review.correct")}</span>}{isWrong && <span className="review-choice-state"><Icon name="x" size={18} /> {t("review.yourAnswer")}</span>}</label>;
        })}
      </fieldset>
      {!outcome && <button className="btn btn-primary review-submit-answer" type="button" disabled={!selectedIds.length || busy} onClick={onSubmit}>{t(busy ? "review.checking" : "review.checkAnswer")}</button>}
      {outcome && <section className={`review-answer-outcome ${outcome.was_correct ? "is-correct" : "is-incorrect"}`} role="status" aria-live="polite"><Icon name={outcome.was_correct ? "check" : "alert-triangle"} size={20} /><div><strong>{t(outcome.was_correct ? "review.correctMoved" : "review.notYet")}</strong><p>{t(outcome.was_correct ? "review.correctBody" : "review.incorrectBody")}</p>{outcome.review_item?.explanation && <details><summary>{t("review.readExplanation")}</summary><p dir="auto">{outcome.review_item.explanation}</p></details>}</div></section>}
      {error && <p className="inline-error" role="alert" dir="auto">{error}</p>}
    </article>
  );
}

export function SubjectReviewSession() {
  const { t } = useI18n();
  const { subjectKey = "" } = useParams();
  const detail = useAsyncData(() => reviewApi.getSubject(subjectKey), [subjectKey]);
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState({});
  const [outcomes, setOutcomes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const answerKeys = useRef(new Map());

  useEffect(() => {
    if (!detail.data) return;
    setItems(detail.data.results);
    setIndex(0);
    setSelected({});
    setOutcomes({});
    setComplete(false);
    answerKeys.current = new Map();
  }, [detail.data]);

  const item = items[index];
  const outcome = item ? outcomes[item.id] : null;
  const cleared = items.length > 0 && items.every((candidate) => outcomes[candidate.id]?.was_correct === true);

  async function answer() {
    if (!item || !selected[item.id]?.length || busy) return;
    let idempotencyKey = answerKeys.current.get(item.id);
    if (!idempotencyKey) {
      idempotencyKey = globalThis.crypto.randomUUID();
      answerKeys.current.set(item.id, idempotencyKey);
    }
    setBusy(true);
    setError("");
    try {
      const response = await reviewApi.answerItem(item.id, { selectedOptionIds: selected[item.id], idempotencyKey });
      setOutcomes((current) => ({ ...current, [item.id]: response }));
    } catch (requestError) {
      setError(requestError?.message || t("review.saveError"));
    } finally {
      setBusy(false);
    }
  }

  function continueSession() {
    if (index >= items.length - 1) setComplete(true);
    else {
      setIndex((current) => current + 1);
      setError("");
    }
  }

  if (detail.loading) return <LoadingPanel />;
  if (detail.error) return <Page title={t("review.sessionTitle")}><ErrorPanel message={detail.error} onRetry={detail.reload} /></Page>;
  if (!items.length) return <Page title={detail.data?.subject_label || t("review.subjectReview")}><EmptyState title={t("review.subjectCleared")} text={t("review.subjectClearedText")} /><div className="result-actions"><Link className="btn btn-primary" to="/review/bank">{t("review.backToBank")}</Link></div></Page>;
  if (complete) return <Page title={detail.data?.subject_label || t("review.subjectReview")}><section className="review-session-complete"><span><Icon name={cleared ? "check" : "target"} size={28} /></span><h2>{t(cleared ? "review.subjectCleared" : "review.passComplete")}</h2><p dir="auto">{cleared ? t("review.clearedIn", { name: detail.data.subject_label }) : t("review.someRemain")}</p><div className="result-actions"><button className="btn btn-primary" type="button" onClick={detail.reload}>{t("review.reviewAgain")}</button><Link className="btn btn-soft" to="/review/bank">{t("review.backToBank")}</Link></div></section></Page>;

  return (
    <Page title={detail.data.subject_label || t("review.subjectReview")} subtitle={t("review.activeFromBank", { count: items.length })}>
      <section className="review-session-shell">
        <header className="review-session-header"><div><p dir="auto">{index + 1} / {items.length}</p><div className="review-session-progress" role="progressbar" aria-label={t("review.progress")} aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={index + 1}><span style={{ width: `${((index + 1) / items.length) * 100}%` }} /></div></div><Link className="btn btn-soft compact" to="/review/bank">{t("review.leaveSafely")}</Link></header>
        <ReviewQuestionCard item={item} selectedIds={selected[item.id] || []} onSelect={(optionId, multiple) => setSelected((current) => { const previous = current[item.id] || []; const next = multiple ? previous.includes(optionId) ? previous.filter((id) => id !== optionId) : [...previous, optionId] : [optionId]; return { ...current, [item.id]: next }; })} outcome={outcome} busy={busy} error={error} onSubmit={() => void answer()} />
        {outcome && <footer className="review-session-controls"><p dir="auto">{outcome.was_correct ? t("review.remaining", { count: Math.max(0, items.length - index - 1) }) : t("review.remainsActive")}</p><button className="btn btn-primary" type="button" onClick={continueSession}>{t(index >= items.length - 1 ? "review.finishReview" : "review.nextQuestion")}<Icon name="chevron-right" size={18} /></button></footer>}
      </section>
    </Page>
  );
}

export function WeeklyRecall() {
  const { t } = useI18n();
  const detail = useAsyncData(() => reviewApi.getWeeklyRecall(), []);
  const [weekly, setWeekly] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const answerKeys = useRef(new Map());

  useEffect(() => {
    if (!detail.data) return;
    setWeekly(detail.data);
    setShowCompleted(detail.data.session?.status === "completed");
    const firstOpen = detail.data.session?.questions?.findIndex((question) => !question.answered_at);
    setIndex(firstOpen >= 0 ? firstOpen : 0);
  }, [detail.data]);

  const session = weekly?.session;
  const questions = useMemo(() => session?.questions || [], [session]);
  const question = questions[index];
  const item = question?.review_item;
  const outcome = question?.answered_at ? { was_correct: question.was_correct, review_item: item } : null;

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await reviewApi.startWeeklyRecall();
      setWeekly(response);
      setShowCompleted(false);
      const firstOpen = response.session?.questions?.findIndex((candidate) => !candidate.answered_at);
      setIndex(firstOpen >= 0 ? firstOpen : 0);
    } catch (requestError) {
      setError(requestError?.message || t("review.startError"));
    } finally {
      setBusy(false);
    }
  }

  async function answer() {
    if (!session || !question || !item || !selected[question.id]?.length || busy) return;
    let idempotencyKey = answerKeys.current.get(question.id);
    if (!idempotencyKey) {
      idempotencyKey = globalThis.crypto.randomUUID();
      answerKeys.current.set(question.id, idempotencyKey);
    }
    setBusy(true);
    setError("");
    try {
      const response = await reviewApi.answerWeeklyRecall(session.id, question.id, { selectedOptionIds: selected[question.id], idempotencyKey });
      setWeekly((current) => ({ ...current, session: response.session }));
    } catch (requestError) {
      setError(requestError?.message || t("review.recallSaveError"));
    } finally {
      setBusy(false);
    }
  }

  function continueSession() {
    if (session?.status === "completed") {
      setShowCompleted(true);
      return;
    }
    const next = questions.findIndex((candidate, candidateIndex) => candidateIndex > index && !candidate.answered_at);
    setIndex(next >= 0 ? next : Math.min(index + 1, questions.length - 1));
    setError("");
  }

  if (detail.error) return <Page title={t("review.weekly")}><ErrorPanel message={detail.error} onRetry={detail.reload} /></Page>;
  if (detail.loading || weekly === null) return <LoadingPanel />;
  if (!session) return <Page title={t("review.weekly")} subtitle={t("review.weeklySubtitle")}><section className="weekly-recall-start"><span><Icon name="calendar" size={28} /></span><h2 dir="auto">{weekly.available ? t("review.weeklyEligible", { count: weekly.eligible_count }) : t("review.weeklyNotReady")}</h2><p>{t(weekly.available ? "review.weeklyStableCopy" : "review.weeklyPrepareCopy")}</p>{weekly.available && <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void start()}>{t(busy ? "review.preparingSet" : "review.startWeekly")}</button>}{error && <p className="inline-error" role="alert" dir="auto">{error}</p>}<Link className="btn btn-soft" to="/review">{t("review.backToCenter")}</Link></section></Page>;
  if (session.status === "completed" && showCompleted) return <Page title={t("review.weekly")}><section className="review-session-complete"><span><Icon name="check" size={28} /></span><h2>{t("review.weeklyDone")}</h2><p dir="auto">{t("review.weeklyScore", { correct: session.correct_answers, total: session.total_questions })}</p><div className="result-actions"><Link className="btn btn-primary" to="/review/bank">{t("review.openBank")}</Link><Link className="btn btn-soft" to="/review">{t("review.backToCenter")}</Link></div></section></Page>;
  if (!question || !item) return <Page title={t("review.weekly")}><ErrorPanel message={t("review.weeklyNoQuestions")} onRetry={detail.reload} /></Page>;

  return (
    <Page title={t("review.weekly")} subtitle={t("review.weeklySessionSubtitle")}>
      <section className="review-session-shell weekly-recall-session">
        <header className="review-session-header"><div><p dir="auto">{index + 1} / {session.total_questions}</p><div className="review-session-progress" role="progressbar" aria-label={t("review.weeklyProgress")} aria-valuemin={0} aria-valuemax={session.total_questions} aria-valuenow={session.answered_count}><span style={{ width: `${(session.answered_count / session.total_questions) * 100}%` }} /></div></div><Link className="btn btn-soft compact" to="/review">{t("review.leaveSafely")}</Link></header>
        <ReviewQuestionCard item={item} selectedIds={selected[question.id] || question.selected_option_ids || []} onSelect={(optionId, multiple) => setSelected((current) => { const previous = current[question.id] || question.selected_option_ids || []; const next = multiple ? previous.includes(optionId) ? previous.filter((id) => id !== optionId) : [...previous, optionId] : [optionId]; return { ...current, [question.id]: next }; })} outcome={outcome} busy={busy} error={error} onSubmit={() => void answer()} />
        {outcome && <footer className="review-session-controls"><p>{t(outcome.was_correct ? "review.memoryStrengthened" : "review.returnedToBank")}</p><button className="btn btn-primary" type="button" onClick={continueSession}>{t(session.status === "completed" ? "review.finishWeekly" : "review.nextQuestion")} <Icon name="chevron-right" size={18} /></button></footer>}
      </section>
    </Page>
  );
}
