import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { Icon } from "../lib/icons.jsx";

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Untimed";
  return `${Math.round(seconds / 60)} minutes`;
}

function errorText(error) {
  if (!error) return "";
  const firstField = error.fields && Object.values(error.fields).flat().find((value) => typeof value === "string");
  return firstField || error.message || "The quiz could not be started.";
}

export default function QuizDetail() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const quiz = useAsyncData(() => assessmentsApi.getQuiz(quizId), [quizId]);
  const [questionCount, setQuestionCount] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  async function startAttempt() {
    setStarting(true);
    setStartError(null);
    try {
      const started = await assessmentsApi.startAttempt(quizId, {
        idempotencyKey: generateIdempotencyKey(),
        questionCount: questionCount ? Number(questionCount) : undefined
      });
      navigate(`/questions/attempts/${started.attempt.id}`, { replace: true });
    } catch (error) {
      setStartError(error);
    } finally {
      setStarting(false);
    }
  }

  if (quiz.loading) return <LoadingPanel />;
  if (quiz.error) return <ErrorPanel message={quiz.error} onRetry={quiz.reload} />;

  const version = quiz.data.version;
  if (!version) return <ErrorPanel message="The published quiz response did not contain a version." onRetry={quiz.reload} />;
  const isPractice = version.mode === "practice";
  const sizes = [5, 10, 20].filter((size) => size < version.question_count);

  return (
    <Page title={version.title} subtitle={version.instructions || "Read the assessment details before starting. Django controls eligibility, timing, and final results."}>
      <Link className="back-link" to="/questions"><Icon name="chevron-left" size={16} /> Back to quizzes</Link>
      <section className="session-panel">
        <div className="session-top"><div><p className="eyebrow">{version.mode} assessment</p><h2>{version.academic_node_title}</h2></div><span className="pill">{version.language?.toUpperCase() || "—"}</span></div>
        <div className="session-metrics">
          <span><strong>{version.question_count}</strong> configured questions</span>
          <span><strong>{formatDuration(version.duration_seconds)}</strong> server deadline</span>
          <span><strong>{version.maximum_attempts || "∞"}</strong> permitted attempts</span>
          <span><strong>{version.result_release === "immediate" ? "Immediate" : "After close"}</strong> result release</span>
        </div>
        {isPractice && <div className="session-count-picker" aria-label="Practice question count"><span>Practice size</span>{sizes.map((size) => <button key={size} type="button" className={questionCount === String(size) ? "active" : ""} onClick={() => setQuestionCount(String(size))}>{size}</button>)}<button type="button" className={questionCount === "" ? "active" : ""} onClick={() => setQuestionCount("")}>All</button></div>}
        {version.focus_required && <p className="save-hint">This quiz has a server-declared Focus requirement. Focus workspace access is connected in its scheduled phase; starting remains subject to Django validation.</p>}
        {startError && <p className="inline-error" role="alert">{errorText(startError)}</p>}
        <div className="result-actions"><button className="btn btn-primary" type="button" onClick={() => void startAttempt()} disabled={starting}>{starting ? "Starting…" : "Start or resume"}</button><Link className="btn btn-soft" to="/review">Open review queue</Link><Link className="btn btn-soft" to={`/community/context/quiz/${quizId}`}>Discuss quiz</Link></div>
      </section>
    </Page>
  );
}
