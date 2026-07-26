import { Link, useSearchParams } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";
import { QuizCard } from "../components/assessment/QuizCard.jsx";

const MODE_FILTERS = [
  ["", "All quizzes"],
  ["practice", "Practice"],
  ["quiz", "Quizzes"],
  ["mastery", "Mastery"]
];

export default function Questions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get("mode") || "";
  const nodeId = searchParams.get("node") || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const quizzes = useAsyncData(
    () => assessmentsApi.listQuizzes({ nodeId: nodeId || null, mode: mode || null, page }),
    [nodeId, mode, page]
  );

  function updateQuery(changes) {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, String(value));
      else next.delete(key);
    });
    setSearchParams(next);
  }

  function filterPath(nextMode) {
    const params = new URLSearchParams();
    if (nodeId) params.set("node", nodeId);
    if (nextMode) params.set("mode", nextMode);
    const query = params.toString();
    return query ? `/questions?${query}` : "/questions";
  }

  if (quizzes.loading) return <LoadingPanel />;
  if (quizzes.error) return <ErrorPanel message={quizzes.error} onRetry={quizzes.reload} />;

  return (
    <Page title="Questions" subtitle="Choose a published quiz. Your answers, deadline, score, and review schedule stay with Django.">
      <div className="question-context">
        <div><p className="eyebrow">Published assessments</p><h2>{quizzes.data.count} available</h2><p>Only the server decides which quizzes and attempts are available to your account.</p></div>
        <Link className="btn btn-soft" to="/review">Review queue</Link>
      </div>
      <div className="filter-group" aria-label="Quiz mode filter">
        {MODE_FILTERS.map(([value, label]) => <Link key={value || "all"} className={mode === value ? "active" : ""} to={filterPath(value)}>{label}</Link>)}
      </div>
      <section className="question-grid">
        {quizzes.data.results.length ? quizzes.data.results.map((quiz) => <QuizCard key={quiz.id} quiz={quiz} />) : <EmptyState title="No published quizzes" text="Published assessments will appear here when they are available to your account." />}
      </section>
      <PaginationControls page={page} pageData={quizzes.data} onPageChange={(nextPage) => updateQuery({ page: nextPage })} label="Quiz pages" />
    </Page>
  );
}
