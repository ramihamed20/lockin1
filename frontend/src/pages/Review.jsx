import { SearchableDirectory } from "../components/learning/SearchableDirectory.jsx";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { COMING_SOON_STUDY_TOOLS, STUDY_TOOLS_ENABLED } from "../workspace/knowledge/model.js";
const ReviewRecovery = lazy(() => import("../workspace/knowledge/ReviewRecovery.jsx"));
const KnowledgeShelf = lazy(() => import("../workspace/knowledge/KnowledgeShelf.jsx"));
import { Link, useParams, useSearchParams } from "react-router-dom";
import { createReviewTimer, recoveryQuestions, requestedReviewLimit, reviewQuestionLimit } from "../review/session.js";
import { MistakeReflection } from "../review/MistakeReflection.jsx";
import { RecoveryPass } from "../review/RecoveryPass.jsx";
import { reviewApi } from "../api/review.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { Icon } from "../lib/icons.jsx";
import { formatRelativeTime } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { QuestionExplanation } from "../components/shared/QuestionExplanation.jsx";
import { BiweeklyCurrent, BiweeklyHistory, useBiweekly } from "../components/biweekly/BiweeklyArchive.jsx";

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

export default function ReviewCenter({ user = null }) {
  const { t } = useI18n();
  const bankState = useAsyncData(() => reviewApi.getBank(user?.id || ""), [user?.id], { cacheKey: `review-bank:${user?.id || ""}` });
  const queueState = useAsyncData(() => reviewApi.getQueue(user?.id || ""), [user?.id], { cacheKey: `review-queue:${user?.id || ""}` });
  const weeklyState = useAsyncData(() => reviewApi.getWeeklyRecall(user?.id || ""), [user?.id], { cacheKey: `review-weekly:${user?.id || ""}` });
  const biweekly = useBiweekly("review");
  const bank = bankState.data;
  const queue = queueState.data;
  const weekly = weeklyState.data;
  const [dailyMinutes, setDailyMinutes] = useState(5);
  const daily = useAsyncData(signal => reviewApi.getDaily(user?.id || "", { signal }), [user?.id]);
  const dailyLimit = reviewQuestionLimit(daily.data, dailyMinutes);
  const dailyItems = daily.data?.results.slice(0, dailyLimit) || [];
  const secondsPerQuestion = daily.data?.seconds_per_question || 30;
  const dailySubjects = [...new Set(dailyItems.map(item => item.subject_label).filter(Boolean))];
  const weeklyStatus = weekly?.session?.status;
  const weeklyCount = weekly?.session?.total_questions || weekly?.eligible_count || 0;
  return (
    <Page width="reading" title={t("review.center")}>
      {/* One focal block (what is waiting and the way into it), then the
          scheduled reviews as quieter peers, then the material itself, and
          the archive last. */}
      <div className="review-center-layout review-v2">
        {bankState.loading && <ReviewCenterSkeleton inline />}
        {bankState.error && <ErrorPanel message={bankState.errorDetails || bankState.error} onRetry={bankState.reload} />}
        {daily.loading && <LoadingPanel variant="list" />}
        {daily.error && <ErrorPanel message={daily.errorDetails || daily.error} onRetry={daily.reload} />}
        {daily.data && <section className={`review-bank-entry review-daily-entry ${dailyItems.length ? "has-work" : "is-clear"}`} aria-labelledby="review-daily-title">
          <div className="review-bank-entry-copy">
            <span className="review-feature-icon"><Icon name={dailyItems.length ? "target" : "check"} size={22} /></span>
            <div>
              <h2 id="review-daily-title">{t("review.dailyTitle")}</h2>
              <p dir="auto" aria-live="polite">{dailyItems.length ? t("review.dailyEstimate", { count: dailyItems.length, minutes: Math.max(1, Math.ceil(dailyItems.length * secondsPerQuestion / 60)) }) : t("review.dailyClear")}</p>
              {daily.data.personalized_timing && <p className="review-timing-note">{t("review.personalizedTime")}</p>}
              {dailyItems.some(item => item.priority_reasons?.includes("exam_soon")) && <p className="review-priority-note">{t("review.examPriority")}</p>}
              {dailySubjects.length > 0 && <p className="review-daily-subjects" dir="auto">{dailySubjects.join(" · ")}</p>}
              {daily.data.due_count > dailyItems.length && <p dir="auto">{t("review.dailySmallSteps")}</p>}
            </div>
          </div>
          <div className="review-bank-entry-actions">
            {dailyItems.length > 0 && <>
              <div className="review-duration-options" role="group" aria-label={t("review.dailyLength")}>
                {[5, 10].map(minutes => <button key={minutes} className="btn btn-soft compact" type="button" aria-pressed={dailyMinutes === minutes} onClick={() => setDailyMinutes(minutes)}>{t("review.dailyMinutes", { minutes })}</button>)}
              </div>
              <Link className="btn btn-primary" to={`/review/daily?limit=${dailyLimit}`}>{t("review.startReview")}<Icon name="chevron-right" size={18} /></Link>
            </>}
            {!dailyItems.length && weekly?.available && weeklyStatus !== "completed" && <Link className="btn btn-primary" to="/review/weekly">{t("review.startWeekly")}</Link>}
            <Link className="review-daily-customize" to="/review/bank">{t("review.dailyChooseSubject")}</Link>
          </div>
        </section>}
        {bank?.mastered_this_week > 0 && <p className="review-week-progress" dir="auto"><Icon name="check" size={16} />{t("review.weekRecovered", { count: bank.mastered_this_week })}</p>}
        {bank?.subjects.length > 0 && <section className="review-center-section" aria-labelledby="subjects-title">
          <header className="review-section-heading"><h2 id="subjects-title">{t("review.subjectsTitle")}</h2><Link to="/review/bank">{t("review.viewAll")}</Link></header>
          <div className="review-subject-list">{[...bank.subjects].sort((a, b) => (b.due_count || 0) - (a.due_count || 0) || b.repeated_count - a.repeated_count).slice(0, 4).map((subject) => <SubjectRow key={subject.subject_key} subject={subject} />)}</div>
        </section>}

        {weeklyState.loading && <LoadingPanel variant="list" />}
        {weeklyState.error && <ErrorPanel message={weeklyState.errorDetails || weeklyState.error} onRetry={weeklyState.reload} />}
        {weekly && <section className={`weekly-recall-entry ${weekly.available ? "is-available" : ""}`} aria-labelledby="weekly-recall-title">
          <div>
            <span className="review-feature-icon"><Icon name="calendar" size={20} /></span>
            <div><h2 id="weekly-recall-title">{t("review.weekly")}</h2><p dir="auto">{weeklyStatus === "completed" ? t("review.weeklyDone") : weekly.session ? t("review.weeklySessionCopy", { count: weeklyCount }) : weekly.available ? t("review.weeklyReady", { count: weeklyCount }) : t("review.weeklyPrepare")}</p></div>
          </div>
          {weekly.available ? <Link className="btn btn-soft compact" to="/review/weekly">{weeklyStatus === "completed" ? t("review.viewResults") : weekly.session ? t("review.resumeWeekly") : t("review.startWeekly")}</Link> : <span className="pill">{t("review.notReady")}</span>}
        </section>}

        <BiweeklyCurrent type="review" biweekly={biweekly} />

        {queueState.loading && <LoadingPanel variant="list" />}
        {queueState.error && <ErrorPanel message={queueState.errorDetails || queueState.error} onRetry={queueState.reload} />}
        {queue?.results.length > 0 && <section className="review-center-section" aria-labelledby="recent-mistakes-title">
          <header className="review-section-heading"><h2 id="recent-mistakes-title">{t("review.recentMistakes")}</h2><span>{queue.count}</span></header>
          <details className="review-recent-details"><summary>{t("review.showRecent")}</summary><div className="recent-mistake-list">{queue.results.map((item) => <RecentMistake key={item.id} item={item} />)}</div></details>
        </section>}

        {STUDY_TOOLS_ENABLED && user?.id && <Suspense fallback={null}><KnowledgeShelf key={user.id} userId={user.id} /></Suspense>}
        <BiweeklyHistory type="review" biweekly={biweekly} />
      </div>
    </Page>
  );
}

function ReviewCenterSkeleton({ inline = false }) {
  const { t } = useI18n();
  const skeleton = <LoadingPanel variant="review" />;
  return inline ? skeleton : <Page width="reading" title={t("review.center")}>{skeleton}</Page>;
}

function SubjectRow({ subject }) {
  const { t } = useI18n();
  return <Link className="review-subject-row" to={`/review/bank/${encodeURIComponent(subject.subject_key)}`}><span><strong dir="auto">{subject.subject_label_snapshot}</strong><small dir="auto">{subject.due_count > 0 ? t("review.subjectDue", { count: subject.due_count }) : subject.repeated_count ? t("review.repeatedMistakes", { count: subject.repeated_count }) : t("review.readyForReview")}</small></span><span className="review-subject-count" dir="auto">{t("review.questionCount", { count: subject.question_count })}<Icon name="chevron-right" size={18} /></span></Link>;
}

function RecentMistake({ item }) {
  const { t } = useI18n();
  const selected = Array.isArray(item.selected_answers) ? item.selected_answers.join(", ") : t("review.noAnswer");
  const correct = Array.isArray(item.correct_answers) ? item.correct_answers.join(", ") : t("review.answerUnavailable");
  // One row per mistake: the question, what you chose struck through beside
  // what was right, and where it came from. The answer labels stay for
  // assistive technology; sighted readers get the strike and the check.
  const content = <><div className="recent-mistake-marker" aria-hidden="true"><Icon name="x" size={16} /></div><div className="recent-mistake-copy"><h3 dir="auto">{item.prompt}</h3><dl className="recent-mistake-answers"><div className="is-wrong"><dt>{t("review.yourAnswer")}</dt><dd dir="auto">{selected}</dd></div><Icon className="recent-mistake-arrow" name="chevron-right" size={14} aria-hidden="true" /><div className="is-correct"><dt>{t("review.correctAnswer")}</dt><dd dir="auto">{correct}</dd></div></dl><p className="recent-mistake-source" dir="auto">{item.subject_label || t("review.otherSubject")} · {item.source_label || item.original_source?.label || t("review.sourceUnavailable")}{item.source_question_index ? ` · ${t("review.questionIndex", { index: item.source_question_index })}` : ""}{item.mistake_count > 1 ? ` · ${t("review.missedTimes", { count: item.mistake_count })}` : ""} · <time dateTime={item.answered_at}>{relativeTime(item.answered_at, t)}</time></p></div>{item.subject_key && <Icon className="recent-mistake-chevron" name="chevron-right" size={17} aria-hidden="true" />}</>;
  return item.subject_key ? <Link className="recent-mistake" to={`/review/bank/${encodeURIComponent(item.subject_key)}`}>{content}</Link> : <article className="recent-mistake">{content}</article>;
}

export function ReviewBank({ user = null }) {
  const { t } = useI18n();
  const bank = useAsyncData(() => reviewApi.getBank(user?.id || ""), [user?.id], { cacheKey: `review-bank:${user?.id || ""}` });
  if (bank.loading) return <Page width="reading" title={t("review.bank")}><LoadingPanel variant="list" /></Page>;
  if (bank.error) return <Page width="reading" title={t("review.bank")}><ErrorPanel message={bank.errorDetails || bank.error} onRetry={bank.reload} /></Page>;
  return (
    <Page width="reading" title={t("review.bank")} subtitle={t("review.bankSubtitle")}>
      <section className="review-bank-overview" aria-labelledby="review-bank-overview-title">
        <div><p className="eyebrow">{t("review.activeReview")}</p><h2 id="review-bank-overview-title" dir="auto">{bank.data.active_count ? t("review.questionsToReview", { count: bank.data.active_count }) : t("review.caughtUpTitle")}</h2><p dir="auto">{bank.data.active_count ? t("review.masteredCopy", { count: bank.data.mastered_this_week }) : t("review.caughtUpBankText")}</p></div>
        <Link className="btn btn-soft" to="/review">{t("review.backToCenter")}</Link>
      </section>
      {bank.data.subjects.length ? <SearchableDirectory items={bank.data.subjects} getTitle={subject => subject.subject_label_snapshot}>{visible => <section className="review-bank-subjects" aria-label={t("review.bankSubjectsLabel")}>{visible.map(subject => <SubjectRow key={subject.subject_key} subject={subject} />)}</section>}</SearchableDirectory> : <EmptyState title={t("review.caughtUpTitle")} text={t("review.caughtUpText")} />}
    </Page>
  );
}

function ReviewQuestionCard({ item, selectedIds = [], onSelect, outcome, busy, error, onSubmit, training = false }) {
  const { t } = useI18n();
  const [confidence, setConfidence] = useState("");
  const explanationRegion = useRef(null);
  const timer = useRef(null);
  if (!timer.current) timer.current = createReviewTimer();
  useEffect(() => {
    function update() {
      if (!training && !busy && !outcome && document.visibilityState === "visible") timer.current.resume();
      else timer.current.pause();
    }
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); timer.current.pause(); };
  }, [busy, outcome, training]);
  const correctIds = new Set(outcome?.review_item?.correct_option_ids || []);
  const multiple = item.answer_mode === "multiple";
  return (
    <article className="review-session-question">
      <div className="review-question-source"><span>{t("review.originallyFrom")}</span><strong dir="auto">{sourceDescription(item, t)}</strong>{item.mistake_count > 1 && <em className="review-missed-count">{t("review.missedTimes", { count: item.mistake_count })}</em>}</div>
      {item.original_source?.has_page && <Link className="btn btn-soft compact" to={`/review/source/${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">{t("review.sourcePage")}</Link>}
      {item.priority_reasons?.includes("exam_soon") && <p className="review-priority-note">{t("review.examSoon")} · <time dateTime={item.exam_on}>{item.exam_on}</time></p>}
      <h2 dir="auto">{item.prompt}</h2>
      <fieldset className="review-choice-list" disabled={busy || Boolean(outcome)}>
        <legend className="visually-hidden">{t(multiple ? "review.chooseEvery" : "review.chooseOne")}</legend>
        {(item.options || []).map((option, index) => {
          const selected = selectedIds.includes(option.id);
          const isCorrect = Boolean(outcome) && correctIds.has(option.id);
          const isWrong = Boolean(outcome) && selected && !isCorrect;
          const state = isCorrect ? "is-correct" : isWrong ? "is-wrong" : selected ? "is-selected" : "";
          return <label className={`review-choice ${state}`} key={option.id}><input type={multiple ? "checkbox" : "radio"} name={`review-answer-${item.id}`} value={option.id} checked={selected} onChange={() => onSelect(option.id, multiple)} /><span className="review-choice-letter">{String.fromCharCode(65 + index)}</span><span dir="auto">{option.text || t("review.optionUnavailable")}</span>{isCorrect && <span className="review-choice-state"><Icon name="check" size={18} /> {t("review.correct")}</span>}{isWrong && <span className="review-choice-state"><Icon name="x" size={18} /> {t("review.yourAnswer")}</span>}</label>;
        })}
      </fieldset>
      {!outcome && <div className="review-answer-actions">{!training && <button className="btn btn-soft review-confidence" type="button" aria-pressed={confidence === "unsure"} disabled={busy} onClick={() => setConfidence(current => current === "unsure" ? "" : "unsure")}>{t("review.unsure")}</button>}<button className="btn btn-primary review-submit-answer" type="button" disabled={!selectedIds.length || busy} aria-busy={busy || undefined} onClick={() => onSubmit({ confidence, activeSeconds: timer.current.seconds() })}>{t(busy ? "review.checking" : "review.checkAnswer")}</button></div>}
      {outcome && <section className={`review-answer-outcome ${outcome.was_correct ? "is-correct" : "is-incorrect"}`} role="status" aria-live="polite"><Icon name={outcome.was_correct ? "check" : "alert-triangle"} size={20} /><div><strong>{t(training ? outcome.was_correct ? "review.practiceCorrect" : "review.practiceAgain" : outcome.was_correct ? "review.correctMoved" : "review.notYet")}</strong><p>{t(training ? "review.practiceFeedback" : outcome.was_correct ? "review.correctBody" : "review.incorrectBody")}</p>{outcome.was_correct && outcome.confidence === "unsure" && <p>{t("review.correctUnsureBody")}</p>}<div ref={explanationRegion}><QuestionExplanation explanation={outcome.review_item?.explanation} /></div></div></section>}
      {outcome && !outcome.was_correct && !training && <MistakeReflection item={item} outcome={outcome} selectedIds={selectedIds} onExplain={() => {
        const button = explanationRegion.current?.querySelector("button");
        if (button?.getAttribute("aria-expanded") === "false") button.click();
        button?.focus();
        explanationRegion.current?.scrollIntoView({ block: "nearest" });
      }} />}
      {outcome && !outcome.was_correct && !training && STUDY_TOOLS_ENABLED && !COMING_SOON_STUDY_TOOLS.includes("explain") && <Suspense fallback={null}><ReviewRecovery key={item.id} itemId={item.id} /></Suspense>}
      {error && <p className="inline-error" role="alert" dir="auto">{error}</p>}
    </article>
  );
}

export function SubjectReviewSession({ user = null, daily = false }) {
  const { t } = useI18n();
  const { subjectKey = "" } = useParams();
  const [searchParams] = useSearchParams();
  const requestedItem = daily ? null : searchParams.get("item");
  const dailyLimit = requestedReviewLimit(searchParams.get("limit"));
  const automaticLimit = !searchParams.has("limit");
  const detail = useAsyncData(() => daily ? reviewApi.getDaily(user?.id || "") : reviewApi.getSubject(subjectKey, user?.id || ""), [subjectKey, user?.id, daily, dailyLimit]);
  const returnPath = daily ? "/review" : "/review/bank";
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState({});
  const [outcomes, setOutcomes] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState(null);
  const answerKeys = useRef(new Map());

  useEffect(() => {
    if (!detail.data) return;
    setItems(daily ? detail.data.results.slice(0, automaticLimit ? reviewQuestionLimit(detail.data, 5) : dailyLimit) : detail.data.results);
    setIndex(Math.max(0, detail.data.results.findIndex(item => item.id === requestedItem)));
    setSelected({});
    setOutcomes({});
    setComplete(false);
    setRecoveryOpen(false);
    setRecoveryResult(null);
    answerKeys.current = new Map();
  }, [detail.data, requestedItem, daily, dailyLimit, automaticLimit]);

  const missingRequested = requestedItem && detail.data && !detail.data.results.some(item => item.id === requestedItem);
  const item = missingRequested ? null : items[index];
  const outcome = item ? outcomes[item.id] : null;
  const cleared = items.length > 0 && items.every((candidate) => outcomes[candidate.id]?.was_correct === true);

  async function answer(metadata) {
    if (!item || !selected[item.id]?.length || busy) return;
    let idempotencyKey = answerKeys.current.get(item.id);
    if (!idempotencyKey) {
      idempotencyKey = globalThis.crypto.randomUUID();
      answerKeys.current.set(item.id, idempotencyKey);
    }
    setBusy(true);
    setError("");
    try {
      const response = await reviewApi.answerItem(item.id, { selectedOptionIds: selected[item.id], idempotencyKey, userId: user?.id || "", ...metadata });
      setOutcomes((current) => ({ ...current, [item.id]: { ...response, confidence: response.confidence ?? metadata.confidence } }));
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

  if (detail.loading) return <LoadingPanel variant="quiz" />;
  if (detail.error) return <Page width="reading" title={t("review.sessionTitle")}><ErrorPanel message={detail.errorDetails || detail.error} onRetry={detail.reload} /></Page>;
  if (missingRequested) return <Page width="reading" title={t("review.sessionTitle")}><p role="status">{t("connected.reviewUnavailable")}</p><Link className="btn btn-primary" to="/review/bank">{t("review.backToBank")}</Link></Page>;
  if (!items.length) return <Page width="reading" title={daily ? t("review.dailyTitle") : detail.data?.subject_label || t("review.subjectReview")}><EmptyState title={daily ? t("review.dailyClearTitle") : t("review.subjectCleared")} text={daily ? t("review.dailyClear") : t("review.subjectClearedText")} /><div className="result-actions"><Link className="btn btn-primary" to={returnPath}>{t(daily ? "review.backToCenter" : "review.backToBank")}</Link></div></Page>;
  if (complete && recoveryOpen) return <Page width="reading" title={t("review.practiceTitle")}><RecoveryPass questions={recoveryQuestions(items, outcomes)} QuestionCard={ReviewQuestionCard} onFinish={result => { setRecoveryResult(result); setRecoveryOpen(false); }} /></Page>;
  if (complete) {
    const recovery = recoveryQuestions(items, outcomes);
    const answers = Object.values(outcomes);
    const correct = answers.filter(answer => answer.was_correct).length;
    const repeated = items.filter(candidate => candidate.mistake_count > 1 && outcomes[candidate.id]?.was_correct).length;
    const pending = answers.some(answer => answer.pending_sync);
    const unsureCorrect = answers.filter(answer => answer.was_correct && answer.confidence === "unsure").length;
    return <Page width="reading" title={daily ? t("review.dailyTitle") : detail.data?.subject_label || t("review.subjectReview")}><section className="review-session-complete" aria-labelledby="review-result-title">
      <span><Icon name={cleared ? "check" : "target"} size={28} /></span>
      <h2 id="review-result-title">{t(daily ? "review.dailyComplete" : cleared ? "review.subjectCleared" : "review.passComplete")}</h2>
      <p dir="auto">{t("review.sessionScore", { correct, count: answers.length })}</p>
      <dl className="review-result-stats"><div><dt>{t("review.recoveredRepeated")}</dt><dd>{repeated}</dd></div><div><dt>{t("review.needsAnotherPass")}</dt><dd>{answers.length - correct}</dd></div>{unsureCorrect > 0 && <div><dt>{t("review.correctUnsure")}</dt><dd>{unsureCorrect}</dd></div>}</dl>
      <p dir="auto">{t(pending ? "review.resultsPending" : "review.recallLater")}</p>
      {recoveryResult && <p className="review-practice-receipt" role="status">{t("review.practiceScore", recoveryResult)}</p>}
      {recovery.length > 0 && !recoveryResult && <section className="review-practice-offer"><h3>{t("review.practiceOffer")}</h3><p>{t("review.practiceNotice")}</p><button className="btn btn-primary" type="button" onClick={() => setRecoveryOpen(true)}>{t("review.startPractice", { count: recovery.length })}</button></section>}
      <div className="result-actions"><Link className={`btn ${recovery.length > 0 && !recoveryResult ? "btn-soft" : "btn-primary"}`} to={returnPath}>{t(daily ? "review.backToCenter" : "review.backToBank")}</Link><button className="btn btn-soft" type="button" disabled={detail.refreshing} onClick={detail.reload}>{t("review.anotherSession")}</button></div>
    </section></Page>;
  }

  return (
    <Page width="reading" title={daily ? t("review.dailyTitle") : detail.data.subject_label || t("review.subjectReview")} subtitle={t("review.activeFromBank", { count: items.length })}>
      <section className="review-session-shell">
        <header className="review-session-header"><div><p dir="auto">{index + 1} / {items.length}</p><div className="review-session-progress" role="progressbar" aria-label={t("review.progress")} aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={Object.keys(outcomes).length}><span style={{ width: `${(Object.keys(outcomes).length / items.length) * 100}%` }} /></div></div><Link className="btn btn-soft compact" to={returnPath}>{t("review.leaveSafely")}</Link></header>
        <ReviewQuestionCard key={item.id} item={item} selectedIds={selected[item.id] || []} onSelect={(optionId, multiple) => setSelected((current) => { const previous = current[item.id] || []; const next = multiple ? previous.includes(optionId) ? previous.filter((id) => id !== optionId) : [...previous, optionId] : [optionId]; return { ...current, [item.id]: next }; })} outcome={outcome} busy={busy} error={error} onSubmit={metadata => void answer(metadata)} />
        {outcome && <footer className="review-session-controls"><p dir="auto">{outcome.was_correct ? t("review.remaining", { count: Math.max(0, items.length - index - 1) }) : t("review.remainsActive")}</p><button className="btn btn-primary" type="button" onClick={continueSession}>{t(index >= items.length - 1 ? "review.finishReview" : "review.nextQuestion")}<Icon name="chevron-right" size={18} /></button></footer>}
      </section>
    </Page>
  );
}

export function WeeklyRecall({ user = null }) {
  const { t } = useI18n();
  const detail = useAsyncData(() => reviewApi.getWeeklyRecall(user?.id || ""), [user?.id]);
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

  async function answer(metadata) {
    if (!session || !question || !item || !selected[question.id]?.length || busy) return;
    let idempotencyKey = answerKeys.current.get(question.id);
    if (!idempotencyKey) {
      idempotencyKey = globalThis.crypto.randomUUID();
      answerKeys.current.set(question.id, idempotencyKey);
    }
    setBusy(true);
    setError("");
    try {
      const response = await reviewApi.answerWeeklyRecall(session.id, question.id, { selectedOptionIds: selected[question.id], idempotencyKey, userId: user?.id || "", ...metadata });
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

  if (detail.error) return <Page width="reading" title={t("review.weekly")}><ErrorPanel message={detail.errorDetails || detail.error} onRetry={detail.reload} /></Page>;
  if (detail.loading || weekly === null) return <LoadingPanel variant="quiz" />;
  if (!session) return <Page width="reading" title={t("review.weekly")} subtitle={t("review.weeklySubtitle")}><section className="weekly-recall-start"><span><Icon name="calendar" size={28} /></span><h2 dir="auto">{weekly.available ? t("review.weeklyEligible", { count: weekly.eligible_count }) : t("review.weeklyNotReady")}</h2><p>{t(weekly.available ? "review.weeklyStableCopy" : "review.weeklyPrepareCopy")}</p>{weekly.available && <button className="btn btn-primary" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void start()}>{t(busy ? "review.preparingSet" : "review.startWeekly")}</button>}{error && <p className="inline-error" role="alert" dir="auto">{error}</p>}<Link className="btn btn-soft" to="/review">{t("review.backToCenter")}</Link></section></Page>;
  if (session.status === "completed" && showCompleted) return <Page width="reading" title={t("review.weekly")}><section className="review-session-complete"><span><Icon name="check" size={28} /></span><h2>{t("review.weeklyDone")}</h2><p dir="auto">{t("review.weeklyScore", { correct: session.correct_answers, total: session.total_questions })}</p><div className="result-actions"><Link className="btn btn-primary" to="/review/bank">{t("review.openBank")}</Link><Link className="btn btn-soft" to="/review">{t("review.backToCenter")}</Link></div></section></Page>;
  if (!question || !item) return <Page width="reading" title={t("review.weekly")}><ErrorPanel message={t("review.weeklyNoQuestions")} onRetry={detail.reload} /></Page>;

  return (
    <Page width="reading" title={t("review.weekly")} subtitle={t("review.weeklySessionSubtitle")}>
      <section className="review-session-shell weekly-recall-session">
        <header className="review-session-header"><div><p dir="auto">{index + 1} / {session.total_questions}</p><div className="review-session-progress" role="progressbar" aria-label={t("review.weeklyProgress")} aria-valuemin={0} aria-valuemax={session.total_questions} aria-valuenow={session.answered_count}><span style={{ width: `${(session.answered_count / session.total_questions) * 100}%` }} /></div></div><Link className="btn btn-soft compact" to="/review">{t("review.leaveSafely")}</Link></header>
        <ReviewQuestionCard key={item.id} item={item} selectedIds={selected[question.id] || question.selected_option_ids || []} onSelect={(optionId, multiple) => setSelected((current) => { const previous = current[question.id] || question.selected_option_ids || []; const next = multiple ? previous.includes(optionId) ? previous.filter((id) => id !== optionId) : [...previous, optionId] : [optionId]; return { ...current, [question.id]: next }; })} outcome={outcome} busy={busy} error={error} onSubmit={metadata => void answer(metadata)} />
        {outcome && <footer className="review-session-controls"><p>{t(outcome.was_correct ? "review.memoryStrengthened" : "review.returnedToBank")}</p><button className="btn btn-primary" type="button" onClick={continueSession}>{t(session.status === "completed" ? "review.finishWeekly" : "review.nextQuestion")} <Icon name="chevron-right" size={18} /></button></footer>}
      </section>
    </Page>
  );
}
