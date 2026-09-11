import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { isApiError } from "../api/client.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { AttemptQuestionCard } from "../components/assessment/AttemptQuestionCard.jsx";
import { AttemptTimer } from "../components/assessment/AttemptTimer.jsx";
import { ErrorPanel, LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";
import { notifyProgressionUpdated } from "../lib/progressionEvents.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { flushAttemptChanges, queueAttemptChange } from "../workspace/assessment/offlineAttemptQueue.js";
import { subscribeConnection } from "../lib/connectionState.js";

function updateQuestion(attempt, questionId, answer) {
  const acknowledgedRevision = Number(answer?.server_revision);
  return {
    ...attempt,
    server_revision: Number.isInteger(acknowledgedRevision) ? acknowledgedRevision : attempt.server_revision,
    questions: attempt.questions.map((question) => question.id === questionId ? { ...question, answer } : question)
  };
}

function errorText(error, t) {
  if (!error) return "";
  const field = error.fields && Object.values(error.fields).flat().find((value) => typeof value === "string");
  return field || error.message || t("assessment.saveError");
}

function returnPath(state) {
  return typeof state?.returnTo === "string" && state.returnTo.startsWith("/questions") ? state.returnTo : "/questions";
}

export default function Attempt() {
  const { t } = useI18n();
  const { attemptId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const detail = useAsyncData(() => assessmentsApi.getAttempt(attemptId), [attemptId]);
  const [attempt, setAttempt] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [answerStates, setAnswerStates] = useState({});
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const activityStarted = useRef(false);
  const submitKey = useRef(null);
  const deadlineRefresh = useRef(false);
  const resumeRevision = useRef(0);
  const resumeRequest = useRef(0);
  const returnTo = returnPath(location.state);

  useEffect(() => {
    activityStarted.current = false;
    submitKey.current = null;
    deadlineRefresh.current = false;
    resumeRevision.current = 0;
    resumeRequest.current = 0;
    setAttempt(null);
    setActiveIndex(0);
    setAnswerStates({});
    setSubmitOpen(false);
    setSubmitting(false);
    setSubmitError(null);
  }, [attemptId]);

  useEffect(() => {
    if (!detail.data) return;
    setAttempt(detail.data);
    const questionCount = detail.data.questions?.length || 1;
    const savedPosition = Number(detail.data.resume_question_position || 1);
    setActiveIndex(Math.min(Math.max(0, savedPosition - 1), questionCount - 1));
    resumeRevision.current = Number(detail.data.resume_client_revision || 0);
  }, [detail.data]);

  useEffect(() => {
    if (!attemptId) return undefined;
    return subscribeConnection((connection) => {
      if (connection.status !== "connected") return;
      void flushAttemptChanges(attemptId, assessmentsApi).then(({ pending }) => {
        if (!pending) detail.reload();
      });
    });
  }, [attemptId, detail]);

  useEffect(() => {
    if (!attemptId || attempt?.status !== "active" || activityStarted.current) return undefined;
    activityStarted.current = true;
    function record(activityType) {
      return assessmentsApi.recordActivity(attemptId, {
        clientEventId: generateIdempotencyKey(),
        activityType,
        clientOccurredAt: new Date().toISOString(),
        metadata: {}
      }).catch(() => null);
    }
    void record("workspace_entered");
    function visibilityChange() { void record(document.hidden ? "page_hidden" : "page_visible"); }
    document.addEventListener("visibilitychange", visibilityChange);
    return () => { document.removeEventListener("visibilitychange", visibilityChange); void record("workspace_exited"); };
  }, [attempt?.status, attemptId]);

  async function selectOption(question, optionId) {
    if (!attempt || attempt.status !== "active") return;
    const previous = question.answer;
    const previousIds = Array.isArray(previous?.selected_option_ids) ? previous.selected_option_ids : [];
    const selectedOptionIds = question.question_type === "multiple_select"
      ? previousIds.includes(optionId) ? previousIds.filter((id) => id !== optionId) : [...previousIds, optionId]
      : [optionId];
    const nextRevision = Number(previous?.client_revision || 0) + 1;
    const optimistic = { ...(previous || {}), selected_option_ids: selectedOptionIds, client_revision: nextRevision };
    setAttempt((current) => current ? updateQuestion(current, question.id, optimistic) : current);
    setAnswerStates((current) => ({ ...current, [question.id]: { saving: true, error: "", conflict: false } }));
    try {
      const answer = await assessmentsApi.saveAnswer(attempt.id, question.id, { selectedOptionIds, clientRevision: nextRevision });
      setAttempt((current) => current ? updateQuestion(current, question.id, answer) : current);
      setAnswerStates((current) => ({ ...current, [question.id]: { saving: false, error: "", conflict: false } }));
    } catch (error) {
      const currentAnswer = isApiError(error) && error.status === 409 && error.fields?.current_answer;
      if (currentAnswer && typeof currentAnswer === "object") {
        setAttempt((current) => current ? updateQuestion(current, question.id, currentAnswer) : current);
        setAnswerStates((current) => ({ ...current, [question.id]: { saving: false, error: "", conflict: true } }));
      } else {
        if (isApiError(error) && ["network_error", "timeout", "offline"].includes(error.code)) {
          queueAttemptChange(attempt.id, { kind: "answer", questionId: question.id, selectedOptionIds, clientRevision: nextRevision });
          setAnswerStates((current) => ({ ...current, [question.id]: { saving: false, error: "Saved on this device. It will sync when the connection returns.", conflict: false } }));
          return;
        }
        setAnswerStates((current) => ({ ...current, [question.id]: { saving: false, error: errorText(error, t), conflict: false } }));
        if (isApiError(error) && error.code === "attempt_closed") detail.reload();
      }
    }
  }

  function moveToQuestion(nextIndex) {
    if (!attempt) return;
    const questionCount = attempt.questions?.length || 0;
    const safeIndex = Math.min(Math.max(0, nextIndex), Math.max(0, questionCount - 1));
    if (safeIndex === activeIndex) return;
    setActiveIndex(safeIndex);
    const clientRevision = resumeRevision.current + 1;
    const requestId = resumeRequest.current + 1;
    resumeRevision.current = clientRevision;
    resumeRequest.current = requestId;
    void assessmentsApi.saveResume(attempt.id, {
      questionPosition: safeIndex + 1,
      clientRevision
    }).then((savedAttempt) => {
      if (resumeRequest.current !== requestId) return;
      setAttempt((current) => current ? {
        ...current,
        server_revision: savedAttempt.server_revision,
        resume_question_position: savedAttempt.resume_question_position,
        resume_client_revision: savedAttempt.resume_client_revision
      } : current);
    }).catch((error) => {
      if (resumeRequest.current !== requestId) return;
      if (isApiError(error) && ["network_error", "timeout", "offline"].includes(error.code)) {
        queueAttemptChange(attempt.id, { kind: "resume", questionPosition: safeIndex + 1, clientRevision });
        return;
      }
      if (isApiError(error) && (error.status === 409 || error.code === "attempt_closed")) {
        detail.reload();
      }
    });
  }

  async function submitAttempt() {
    if (!attempt) return;
    if (!submitKey.current) submitKey.current = generateIdempotencyKey();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await assessmentsApi.submitAttempt(attempt.id, submitKey.current);
      notifyProgressionUpdated();
      setSubmitOpen(false);
      navigate(`/questions/results/${result.id}`, { replace: true, state: { returnTo } });
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (detail.loading) return <LoadingPanel />;
  if (detail.error) return <ErrorPanel message={detail.error} onRetry={detail.reload} />;
  if (!attempt) return <LoadingPanel />;

  const questions = Array.isArray(attempt.questions) ? attempt.questions : [];
  const currentQuestion = questions[activeIndex];
  const answeredCount = questions.filter((question) => question.answer?.selected_option_ids?.length).length;
  const closed = attempt.status !== "active";

  if (closed) {
    return <Page title={attempt.quiz_title || t("assessment.assessment")} subtitle={t("assessment.attemptClosedSubtitle")}><section className="session-result"><article className="result-hero"><div><p className="eyebrow" dir="auto">{t("assessment.attemptStatus", { status: attempt.status })}</p><h2>{t(attempt.status === "expired" ? "assessment.timeClosed" : "assessment.attemptSubmitted")}</h2><p>{t("assessment.attemptClosedBody")}</p></div></article><div className="result-actions">{attempt.result_id && <Link className="btn btn-primary" to={`/questions/results/${attempt.result_id}`} state={{ returnTo }}>{t("assessment.openResult")}</Link>}<Link className="btn btn-soft" to={returnTo}>{t("assessment.exit")}</Link></div></section></Page>;
  }

  if (!currentQuestion) return <ErrorPanel message={t("assessment.noQuestions")} onRetry={detail.reload} />;
  const currentState = answerStates[currentQuestion.id] || {};
  const progress = questions.length ? Math.round(((activeIndex + 1) / questions.length) * 100) : 0;
  const finalQuestion = activeIndex === questions.length - 1;

  return (
    <Page title={attempt.quiz_title || t("assessment.assessment")} subtitle={t("assessment.attemptSubtitle")}>
      <section className="session-panel attempt-workspace">
        <div className="session-top session-quiz-header"><div><p className="eyebrow" dir="auto">{attempt.quiz_title || t("assessment.quiz")}</p><h2 dir="auto">{t("assessment.questionOf", { index: activeIndex + 1, total: questions.length })}</h2></div><Link className="btn btn-soft" to={returnTo}>{t("assessment.backToQuizzes")}</Link></div>
        <ProgressLine value={progress} />
        <div className="quiz-explanation-hint"><button className="btn btn-soft compact" type="button" disabled aria-describedby="quiz-explanation-availability">{t("assessment.explainQuestion")}</button><span id="quiz-explanation-availability">{t("assessment.explainAvailability")}</span></div>
        <AttemptQuestionCard question={currentQuestion} saving={currentState.saving} error={currentState.error} conflict={currentState.conflict} disabled={false} onSelect={(optionId) => void selectOption(currentQuestion, optionId)} />
        <details className="attempt-metadata">
          <summary>{t("assessment.quizProgress")} <span dir="auto">{t("assessment.answeredOf", { answered: answeredCount, total: questions.length })}</span></summary>
          <div className="session-metrics"><span dir="auto"><strong>{answeredCount}</strong> {t("assessment.savedAnswers")}</span><span dir="auto"><strong>{Math.max(0, questions.length - answeredCount)}</strong> {t("assessment.remaining")}</span><span dir="auto"><strong>r{attempt.server_revision}</strong> {t("assessment.revision")}</span><AttemptTimer deadlineAt={attempt.deadline_at} serverTime={attempt.server_time} onDeadline={() => { if (!deadlineRefresh.current) { deadlineRefresh.current = true; detail.reload(); } }} /></div>
        </details>
        {submitError && <p className="inline-error" role="alert" dir="auto">{errorText(submitError, t)}</p>}
        <div className="session-actions quiz-navigation"><button className="btn btn-soft" type="button" onClick={() => moveToQuestion(activeIndex - 1)} disabled={activeIndex === 0}>{t("common.previous")}</button>{finalQuestion ? <button className="btn btn-primary" type="button" onClick={() => setSubmitOpen(true)}>{t("assessment.submitQuiz")}</button> : <button className="btn btn-primary" type="button" onClick={() => moveToQuestion(activeIndex + 1)}>{t("common.next")}</button>}</div>
      </section>
      <ConfirmDialog open={submitOpen} title={t("assessment.submitTitle")} message={t("assessment.submitMessage", { count: answeredCount })} confirmLabel={t(submitting ? "assessment.submitting" : "assessment.submitQuiz")} onConfirm={() => void submitAttempt()} onCancel={() => !submitting && setSubmitOpen(false)} />
    </Page>
  );
}
