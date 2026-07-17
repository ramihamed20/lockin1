import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Brand } from "../../components/Brand";
import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { attempt, saveAttemptAnswer, submitAttempt } from "./api";
import { AttemptTimer } from "./components/AttemptTimer";
import { QuestionPanel } from "./components/QuestionPanel";
import { SaveIndicator, type SaveState } from "./components/SaveIndicator";
import { SubmissionDialog } from "./components/SubmissionDialog";
import {
  clearAttemptRecovery,
  clearPendingAnswer,
  readPendingAnswers,
  storePendingAnswer
} from "./recovery";
import type { Attempt } from "./types";
import { useIntegritySignals } from "./useIntegritySignals";

export function AttemptPage() {
  const { attemptId = "" } = useParams();
  const navigate = useNavigate();
  const { t, toggleLocale } = useI18n();
  const [data, setData] = useState<Attempt | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const revisions = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const loaded = await attempt(attemptId);
      if (loaded.status !== "active" && loaded.result_id) {
        clearAttemptRecovery(loaded.id);
        void navigate(`/assessments/results/${loaded.result_id}`, { replace: true });
        return;
      }
      const nextSelected: Record<string, string> = {};
      const nextStates: Record<string, SaveState> = {};
      const nextRevisions: Record<string, number> = {};
      for (const question of loaded.questions) {
        const saved = question.answer;
        if (saved?.selected_option_ids[0]) nextSelected[question.id] = saved.selected_option_ids[0];
        nextRevisions[question.id] = saved?.client_revision ?? 0;
        nextStates[question.id] = saved ? "saved" : "idle";
      }
      for (const pending of readPendingAnswers(loaded)) {
        const optionId = pending.selectedOptionIds[0];
        if (optionId) nextSelected[pending.questionId] = optionId;
        nextRevisions[pending.questionId] = Math.max(
          nextRevisions[pending.questionId] ?? 0,
          pending.clientRevision
        );
        nextStates[pending.questionId] = "failed";
      }
      revisions.current = nextRevisions;
      setSelected(nextSelected);
      setSaveStates(nextStates);
      setData(loaded);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t("assessmentLoadError"));
    }
  }, [attemptId, navigate, t]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);
  useIntegritySignals(data?.id, data?.status === "active");

  const persist = useCallback(async (
    questionId: string,
    optionId: string,
    clientRevision: number
  ) => {
    if (!data) return;
    storePendingAnswer(data.id, {
      questionId,
      selectedOptionIds: [optionId],
      clientRevision,
      createdAt: Date.now()
    });
    setSaveStates((current) => ({ ...current, [questionId]: "saving" }));
    try {
      const saved = await saveAttemptAnswer(data.id, questionId, [optionId], clientRevision);
      revisions.current[questionId] = saved.client_revision;
      clearPendingAnswer(data.id, questionId);
      setSaveStates((current) => ({ ...current, [questionId]: "saved" }));
      setActionError("");
    } catch (error) {
      if (error instanceof ApiError && (error.code === "answer_revision_conflict" || error.code === "attempt_closed")) {
        setActionError(t("serverAnswerChanged"));
        await load();
      } else {
        setSaveStates((current) => ({ ...current, [questionId]: "failed" }));
        setActionError(t("answerRecoveryCopy"));
      }
    }
  }, [data, load, t]);

  const choose = useCallback((questionId: string, optionId: string) => {
    if (!data || data.status !== "active") return;
    const nextRevision = (revisions.current[questionId] ?? 0) + 1;
    revisions.current[questionId] = nextRevision;
    setSelected((current) => ({ ...current, [questionId]: optionId }));
    void persist(questionId, optionId, nextRevision);
  }, [data, persist]);

  useEffect(() => {
    if (!data) return;
    const retry = () => {
      for (const pending of readPendingAnswers(data)) {
        const optionId = pending.selectedOptionIds[0];
        if (optionId) void persist(pending.questionId, optionId, pending.clientRevision);
      }
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [data, persist]);

  const currentQuestion = data?.questions[currentIndex];
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!currentQuestion || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const optionIndex = Number(event.key) - 1;
      const option = currentQuestion.option_snapshot[optionIndex];
      if (Number.isInteger(optionIndex) && option) choose(currentQuestion.id, option.id);
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [choose, currentQuestion]);

  const answered = useMemo(
    () => data?.questions.filter((question) => Boolean(selected[question.id])).length ?? 0,
    [data, selected]
  );

  async function finish() {
    if (!data) return;
    setSubmitting(true);
    setActionError("");
    try {
      const result = await submitAttempt(data.id, crypto.randomUUID());
      clearAttemptRecovery(data.id);
      void navigate(`/assessments/results/${result.id}`, { replace: true });
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : t("genericError"));
      setConfirming(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setActionError(t("fullscreenUnavailable"));
    }
  }

  if (!data && !loadError) return <PageSkeleton label={t("loadingAttempt")} />;
  if (!data) return <main className="attempt-failure"><Alert>{loadError}</Alert><Link className="button button--secondary" to="/assessments">{t("backToAssessments")}</Link></main>;
  if (!currentQuestion) return <main className="attempt-failure"><Alert>{t("assessmentLoadError")}</Alert></main>;

  return (
    <div className="attempt-workspace">
      <a className="skip-link" href="#attempt-question">{t("skipToQuestion")}</a>
      <header className="attempt-header">
        <Brand />
        <div className="attempt-header__identity">
          <span>{t(`mode_${data.mode}`)}</span>
          <h1>{data.quiz_title}</h1>
        </div>
        <AttemptTimer deadline={data.deadline_at} serverTime={data.server_time} onExpired={() => void load()} />
        <div className="attempt-header__actions">
          <Button variant="quiet" onClick={() => void toggleFullscreen()}>{t("fullscreen")}</Button>
          <Button variant="quiet" onClick={toggleLocale}>{t("language")}</Button>
        </div>
      </header>

      <aside className="attempt-map" aria-label={t("questionNavigation")}>
        <div className="attempt-progress">
          <strong>{answered}/{data.questions.length}</strong>
          <span>{t("answeredLabel")}</span>
          <progress value={answered} max={data.questions.length}>{answered}</progress>
        </div>
        <ol>
          {data.questions.map((question, index) => (
            <li key={question.id}>
              <button
                type="button"
                className={`${index === currentIndex ? "is-current" : ""}${selected[question.id] ? " is-answered" : ""}`}
                aria-current={index === currentIndex ? "step" : undefined}
                aria-label={`${t("questionLabel")} ${question.position}${selected[question.id] ? `, ${t("answeredLabel")}` : ""}`}
                onClick={() => setCurrentIndex(index)}
              >
                {question.position}
              </button>
            </li>
          ))}
        </ol>
        <Link to="/assessments">{t("leaveWorkspace")}</Link>
      </aside>

      <main id="attempt-question" className="attempt-main" tabIndex={-1}>
        {actionError ? <Alert>{actionError}</Alert> : null}
        <div className="attempt-question-meta">
          <span>{t(`difficulty_${currentQuestion.difficulty}`)}</span>
          <SaveIndicator
            state={saveStates[currentQuestion.id] ?? "idle"}
            onRetry={() => {
              const optionId = selected[currentQuestion.id];
              if (optionId) void persist(currentQuestion.id, optionId, revisions.current[currentQuestion.id] ?? 1);
            }}
          />
        </div>
        <QuestionPanel
          question={currentQuestion}
          selectedOptionId={selected[currentQuestion.id]}
          onSelect={(optionId) => choose(currentQuestion.id, optionId)}
          disabled={data.status !== "active"}
        />
        <p className="keyboard-hint">{t("numberShortcutHint")}</p>
        <nav className="attempt-controls" aria-label={t("questionActions")}>
          <Button variant="secondary" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => index - 1)}>{t("previousQuestion")}</Button>
          {currentIndex < data.questions.length - 1 ? (
            <Button onClick={() => setCurrentIndex((index) => index + 1)}>{t("nextQuestion")}</Button>
          ) : (
            <Button onClick={() => setConfirming(true)}>{t("reviewAndSubmit")}</Button>
          )}
        </nav>
      </main>
      {confirming ? (
        <SubmissionDialog
          unanswered={data.questions.length - answered}
          pending={submitting}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void finish()}
        />
      ) : null}
    </div>
  );
}
