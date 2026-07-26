import { Link } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, ListRow, LoadingPanel, MiniFeature, Page } from "../components/ui/index.jsx";

function dueLabel(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "Server-scheduled";
  return time <= Date.now() ? "Due now" : `Due ${new Date(time).toLocaleString()}`;
}

export default function Review() {
  const review = useAsyncData(() => assessmentsApi.getReviewQueue(), []);
  if (review.loading) return <LoadingPanel />;
  if (review.error) return <ErrorPanel message={review.error} onRetry={review.reload} />;

  const items = review.data.results;
  const dueNow = items.filter((item) => Date.parse(item.due_at || "") <= Date.now()).length;
  const learning = items.filter((item) => item.mastery_state === "learning").length;

  return (
    <Page title="Review Center" subtitle="Server-scheduled questions from submitted assessment results.">
      <section className="review-hero"><div><p className="eyebrow">Assessment review</p><h2>{dueNow} due now, {items.length - dueNow} scheduled.</h2><p>Django controls the review schedule, mastery state, and any future review-only attempt eligibility.</p></div><span className="review-meter">{items.length}</span></section>
      <section className="review-summary-grid"><MiniFeature title="Due now" text={`${dueNow} server-scheduled item${dueNow === 1 ? "" : "s"}.`} icon="target" /><MiniFeature title="Learning" text={`${learning} item${learning === 1 ? "" : "s"} still building mastery.`} icon="help" /><MiniFeature title="Queue" text={`${items.length} total returned by the assessment service.`} icon="layers" /></section>
      <section className="list-panel"><div className="panel-title"><h2>Scheduled review</h2><span>{items.length}</span></div>{items.length ? items.map((item) => <ListRow key={item.question_id} title={item.prompt} meta={`${item.academic_node_title} · ${item.difficulty} · ${dueLabel(item.due_at)}`} icon="target" action={<span className="pill">{item.mastery_state}</span>} />) : <EmptyState title="Nothing due right now" text="Django will add questions here after submitted assessment results require review." />}</section>
      <section className="panel study-table-card"><div className="panel-title"><h2>Start review</h2></div><p className="muted">The current API returns due questions but does not identify a matching pool quiz for a one-click review attempt. Choose an available published practice quiz; Django decides whether its review-only mode is eligible.</p><Link className="btn btn-soft" to="/questions">Browse published quizzes</Link></section>
    </Page>
  );
}
