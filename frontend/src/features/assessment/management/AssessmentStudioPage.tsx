import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../../api/client";
import { Button } from "../../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../../components/Feedback";
import { useI18n } from "../../../i18n/I18nProvider";
import { managedNodes } from "../../management/api";
import type { EducationNode } from "../../learning/types";
import { managedQuestions, managedQuizzes, questionAction, quizAction } from "../api";
import type { ManagedQuestion, ManagedQuiz, WorkflowStatus } from "../types";
import { QuestionComposer } from "./QuestionComposer";
import { QuizComposer } from "./QuizComposer";

function actions(status: WorkflowStatus) {
  if (status === "draft" || status === "rejected") return ["submit"] as const;
  if (status === "in_review") return ["publish", "reject"] as const;
  if (status === "published") return ["retire"] as const;
  return [];
}

export function AssessmentStudioPage() {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<EducationNode[] | null>(null);
  const [questions, setQuestions] = useState<ManagedQuestion[]>([]);
  const [quizzes, setQuizzes] = useState<ManagedQuiz[]>([]);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(() => {
    const controller = new AbortController();
    void Promise.all([
      managedNodes(controller.signal),
      managedQuestions(controller.signal),
      managedQuizzes(controller.signal)
    ]).then(([nodePage, questionPage, quizPage]) => {
      setNodes(nodePage.results);
      setQuestions(questionPage.results);
      setQuizzes(quizPage.results);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);

  async function runQuestionAction(item: ManagedQuestion, action: "submit" | "publish" | "reject" | "retire") {
    setActionError("");
    try {
      const reviewNote = action === "reject" ? window.prompt(t("reviewNotePrompt")) ?? "" : undefined;
      if (action === "reject" && !reviewNote) return;
      const updated = await questionAction(item, action, reviewNote);
      setQuestions((current) => current.map((question) => question.id === updated.id ? updated : question));
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : t("genericError"));
    }
  }

  async function runQuizAction(item: ManagedQuiz, action: "submit" | "publish" | "reject" | "retire") {
    setActionError("");
    try {
      const reviewNote = action === "reject" ? window.prompt(t("reviewNotePrompt")) ?? "" : undefined;
      if (action === "reject" && !reviewNote) return;
      const updated = await quizAction(item, action, reviewNote);
      setQuizzes((current) => current.map((quiz) => quiz.id === updated.id ? updated : quiz));
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : t("genericError"));
    }
  }

  if (!nodes && !failed) return <PageSkeleton label={t("loadingAssessmentStudio")} />;
  return (
    <div className="page assessment-studio">
      <header className="page-heading page-heading--wide"><p className="eyebrow">{t("assessmentBuilder")}</p><h1>{t("assessmentStudioTitle")}</h1><p>{t("assessmentStudioCopy")}</p></header>
      {failed ? <Alert>{t("assessmentLoadError")}</Alert> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}
      {nodes ? <div className="assessment-composer-grid"><QuestionComposer nodes={nodes} onSaved={(item) => setQuestions((current) => [item, ...current])} /><QuizComposer nodes={nodes} questions={questions} onSaved={(item) => setQuizzes((current) => [item, ...current])} /></div> : null}

      <section className="study-section" aria-labelledby="question-workflow-title">
        <header className="study-section__heading"><h2 id="question-workflow-title">{t("questionWorkflow")}</h2><span>{questions.length}</span></header>
        {questions.length ? <ul className="workflow-list">{questions.map((question) => <li key={question.id}><header><div><span className="resource-type">{t(`difficulty_${question.current_version.difficulty}`)}</span><h3>{question.current_version.prompt}</h3><p>{question.current_version.academic_node_title}</p></div><span className={`status-badge status-badge--${question.workflow_status}`}>{t(`workflow_${question.workflow_status}`)}</span></header>{question.review_note ? <p className="review-note">{question.review_note}</p> : null}<div className="workflow-actions">{actions(question.workflow_status).map((action) => <Button key={action} variant={action === "reject" || action === "retire" ? "quiet" : "secondary"} onClick={() => void runQuestionAction(question, action)}>{t(`action_${action}`)}</Button>)}</div></li>)}</ul> : <EmptyState title={t("noManagedQuestions")}>{t("noManagedQuestionsCopy")}</EmptyState>}
      </section>

      <section className="study-section" aria-labelledby="quiz-workflow-title">
        <header className="study-section__heading"><h2 id="quiz-workflow-title">{t("assessmentWorkflow")}</h2><span>{quizzes.length}</span></header>
        {quizzes.length ? <ul className="workflow-list">{quizzes.map((quiz) => <li key={quiz.id}><header><div><span className="resource-type">{t(`mode_${quiz.current_version.mode}`)}</span><h3>{quiz.current_version.title}</h3><p>{quiz.current_version.question_count} {t("questionsLabel")}</p></div><span className={`status-badge status-badge--${quiz.workflow_status}`}>{t(`workflow_${quiz.workflow_status}`)}</span></header>{quiz.review_note ? <p className="review-note">{quiz.review_note}</p> : null}<div className="workflow-actions">{actions(quiz.workflow_status).map((action) => <Button key={action} variant={action === "reject" || action === "retire" ? "quiet" : "secondary"} onClick={() => void runQuizAction(quiz, action)}>{t(`action_${action}`)}</Button>)}</div></li>)}</ul> : <EmptyState title={t("noManagedAssessments")}>{t("noManagedAssessmentsCopy")}</EmptyState>}
      </section>
    </div>
  );
}
