import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { isApiError } from "../api/client.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { AttemptQuestionCard } from "../components/assessment/AttemptQuestionCard.jsx";
import { AttemptTimer } from "../components/assessment/AttemptTimer.jsx";
import { ErrorPanel, LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";
import { Icon } from "../lib/icons.jsx";
import { notifyProgressionUpdated } from "../lib/progressionEvents.js";

function updateQuestion(attempt, questionId, answer) {
  const acknowledgedRevision = Number(answer?.server_revision);
  return {
    ...attempt,
    server_revision: Number.isInteger(acknowledgedRevision) ? acknowledgedRevision : attempt.server_revision,
    questions: attempt.questions.map((question) => question.id === questionId ? { ...question, answer } : question)
  };
}

function errorText(error) {
  if (!error) return "";
  const field = error.fields && Object.values(error.fields).flat().find((value) => typeof value === "string");
  return field || error.message || "The server could not save your answer.";
}

export default function Attempt() {
  const { attemptId } = useParams();
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

  useEffect(() => {
    activityStarted.current = false;
    submitKey.current = null;
    deadlineRefresh.current = false;
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
    setActiveIndex((index) => Math.min(index, Math.max(0, (detail.data.questions?.length || 1) - 1)));
  }, [detail.data]);

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
    function visibilityChange() {
      void record(document.hidden ? "page_hidden" : "page_visible");
    }
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChange);
      void record("workspace_exited");
    };
  }, [attempt?.status, attemptId]);

  async function selectOption(question, optionId) {
    if (!attempt || attempt.status !== "active") return;
    const previous = question.answer;
    const nextRevision = Number(previous?.client_revision || 0) + 1;
    setAnswerStates((current) => ({ ...current, [question.id]: { saving: true, error: "", conflict: false } }));
    try {
      const answer = await assessmentsApi.saveAnswer(attempt.id, question.id, {
        selectedOptionIds: [optionId],
        clientRevision: nextRevision
      });
      setAttempt((current) => current ? updateQuestion(current, question.id, answer) : current);
      setAnswerStates((current) => ({ ...current, [question.id]: { saving: false, error: "", conflict: false } }));
    } catch (error) {
      const currentAnswer = isApiError(error) && error.status === 409 && error.fields?.current_answer;
      if (currentAnswer && typeof currentAnswer === "object") {
        setAttempt((current) => current ? updateQuestion(current, question.id, currentAnswer) : current);
        setAnswerStates((current) => ({ ...current, [question.id]: { saving: false, error: "", conflict: true } }));
      } else {
        setAnswerStates((current) => ({ ...current, [question.id]: { saving: false, error: errorText(error), conflict: false } }));
        if (isApiError(error) && error.code === "attempt_closed") detail.reload();
      }
    }
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
      navigate(`/questions/results/${result.id}`, { replace: true });
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
    return (
      <Page title={attempt.quiz_title || "Assessment"} subtitle="This attempt is no longer active; Django has the final status.">
        <section className="session-result"><article className="result-hero"><div><p className="eyebrow">Attempt {attempt.status}</p><h2>{attempt.status === "expired" ? "Time window closed" : "Attempt submitted"}</h2><p>The server has closed this attempt. Open the result only when the backend provides one.</p></div></article><div className="result-actions">{attempt.result_id && <Link className="btn btn-primary" to={`/questions/results/${attempt.result_id}`}>Open result</Link>}<Link className="btn btn-soft" to="/questions">Back to quizzes</Link></div></section>
      </Page>
    );
  }

  if (!currentQuestion) return <ErrorPanel message="The server returned an attempt without questions." onRetry={detail.reload} />;
  const currentState = answerStates[currentQuestion.id] || {};
  const progress = questions.length ? Math.round(((activeIndex + 1) / questions.length) * 100) : 0;

  return (
    <Page title={attempt.quiz_title || "Assessment"} subtitle="Answers save to Django as you select them. Correct answers and scores remain hidden until the server releases the result.">
      <section className="session-panel">
        <div className="session-top"><div><p className="eyebrow">Question {activeIndex + 1} of {questions.length}</p><h2>{attempt.mode} attempt</h2></div><Link className="btn btn-soft" to="/questions">Exit</Link></div>
        <ProgressLine value={progress} />
        <div className="session-metrics"><span><strong>{answeredCount}</strong> saved answers</span><span><strong>{Math.max(0, questions.length - answeredCount)}</strong> remaining</span><span><strong>r{attempt.server_revision}</strong> server revision</span><AttemptTimer deadlineAt={attempt.deadline_at} serverTime={attempt.server_time} onDeadline={() => { if (!deadlineRefresh.current) { deadlineRefresh.current = true; detail.reload(); } }} /></div>
        <AttemptQuestionCard question={currentQuestion} saving={currentState.saving} error={currentState.error} conflict={currentState.conflict} disabled={false} onSelect={(optionId) => void selectOption(currentQuestion, optionId)} />
        {submitError && <p className="inline-error" role="alert">{errorText(submitError)}</p>}
        <div className="session-actions"><div className="focus-timer-actions"><button className="btn btn-soft" type="button" onClick={() => setActiveIndex((index) => Math.max(0, index - 1))} disabled={activeIndex === 0}>Previous</button><button className="btn btn-soft" type="button" onClick={() => setActiveIndex((index) => Math.min(questions.length - 1, index + 1))} disabled={activeIndex === questions.length - 1}>Next</button></div><button className="btn btn-primary" type="button" onClick={() => setSubmitOpen(true)}>Submit attempt</button></div>
      </section>
      <ConfirmDialog open={submitOpen} title="Submit this attempt?" message={`Django will grade the ${answeredCount} saved answer${answeredCount === 1 ? "" : "s"} and record any remaining questions as unanswered.`} confirmLabel={submitting ? "Submitting…" : "Submit"} onConfirm={() => void submitAttempt()} onCancel={() => !submitting && setSubmitOpen(false)} />
    </Page>
  );
}
