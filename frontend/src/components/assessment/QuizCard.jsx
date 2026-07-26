import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";

function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Untimed";
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

/** Public quiz metadata only; it deliberately has no question or answer data. */
export function QuizCard({ quiz }) {
  const version = quiz?.version;
  if (!version) return null;
  return (
    <article className="question-card">
      <div className="card-head">
        <div>
          <span className="pill">{String(version.mode || "quiz").replaceAll("_", " ")}</span>
          <h2>{version.title}</h2>
          <p>{version.instructions || "Published assessment available to your account."}</p>
        </div>
        <span className="stat-icon"><Icon name="help" /></span>
      </div>
      <div className="progress-meta"><span>{version.academic_node_title || "Academic assessment"}</span><strong>{version.question_count} questions</strong></div>
      <div className="progress-meta"><span>{durationLabel(version.duration_seconds)}</span><strong>{version.language?.toUpperCase() || "—"}</strong></div>
      <Link className="btn btn-primary" to={`/questions/quizzes/${quiz.id}`}>Open quiz</Link>
    </article>
  );
}
