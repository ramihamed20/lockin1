import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page, SessionConfetti } from "../components/ui/index.jsx";

const REPORT_CATEGORIES = [
  ["answer_key", "Answer key"],
  ["ambiguous", "Ambiguous wording"],
  ["outdated", "Outdated content"],
  ["typo", "Typographical error"],
  ["explanation", "Incorrect explanation"],
  ["other", "Other"]
];

function optionText(question, optionIds) {
  const options = Array.isArray(question.option_snapshot) ? question.option_snapshot : [];
  const names = options.filter((option) => optionIds?.includes(option.id)).map((option) => option.text).filter(Boolean);
  return names.length ? names.join(", ") : "No answer";
}

function errorText(error) {
  if (!error) return "";
  const field = error.fields && Object.values(error.fields).flat().find((value) => typeof value === "string");
  return field || error.message || "The issue report could not be sent.";
}

export default function AssessmentResult() {
  const { resultId } = useParams();
  const result = useAsyncData(() => assessmentsApi.getResult(resultId), [resultId]);

  if (result.loading) return <LoadingPanel />;
  if (result.error) return <ErrorPanel message={result.error} onRetry={result.reload} />;

  const data = result.data;
  if (!data.released) {
    return (
      <Page title={data.quiz_title || "Assessment result"} subtitle="Django has accepted the submission, but has not released its result details yet.">
        <section className="session-result"><article className="result-hero"><div><p className="eyebrow">Result pending release</p><h2>Awaiting server release</h2><p>Scores, correct options, explanations, and answer details remain unavailable until the server marks this result as released.</p></div></article><div className="result-actions"><Link className="btn btn-primary" to="/questions">Back to quizzes</Link><Link className="btn btn-soft" to="/review">Review queue</Link></div></section>
      </Page>
    );
  }

  const questions = Array.isArray(data.questions) ? data.questions : [];
  return (
    <Page title={data.quiz_title || "Assessment result"} subtitle="Server-released result details for your submitted attempt.">
      <section className="session-result">
        <article className="result-hero">
          {data.passed && <SessionConfetti />}
          <div><p className="eyebrow">Server-released result</p><h2>{data.percentage}%</h2><p>{data.passed ? "Passed according to the server threshold." : "The server recorded this attempt below its pass threshold."}</p></div>
          <div className="result-stats"><div className="xp-card"><span>Answered</span><strong>{data.answered_count}</strong></div><div className="xp-card"><span>Unanswered</span><strong>{data.unanswered_count}</strong></div><div className="xp-card timer"><span>Points</span><strong>{data.score_points}/{data.maximum_points}</strong></div></div>
        </article>
        <article className="panel mistake-review"><div className="panel-title"><h2>Released question review</h2><span>{questions.length}</span></div>{questions.map((question) => <ResultQuestion key={question.id} resultId={data.id} question={question} />)}</article>
        <div className="result-actions"><Link className="btn btn-primary" to="/questions">Browse quizzes</Link><Link className="btn btn-soft" to="/review">Open review queue</Link></div>
      </section>
    </Page>
  );
}

function ResultQuestion({ resultId, question }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("ambiguous");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function submitReport(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await assessmentsApi.reportQuestionIssue(resultId, { attemptQuestionId: question.id, category, details });
      setSent(true);
      setOpen(false);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mistake-row">
      <span className="pill">{question.difficulty || "Question"}</span>
      <h3>{question.prompt}</h3>
      <p>Your answer: <strong>{optionText(question, question.selected_option_ids)}</strong></p>
      <p>Correct answer: <strong>{optionText(question, question.correct_option_ids)}</strong></p>
      <small>{question.explanation}</small>
      {sent ? <p className="save-hint" role="status">Issue report sent to the server.</p> : <button className="btn btn-soft compact" type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close report" : "Report an issue"}</button>}
      {open && <form className="password-form" onSubmit={submitReport}><label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{REPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>Details</span><textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength="4000" required /></label>{error && <p className="inline-error" role="alert">{errorText(error)}</p>}<button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Sending…" : "Send report"}</button></form>}
    </div>
  );
}
