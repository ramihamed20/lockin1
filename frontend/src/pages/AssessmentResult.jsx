import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page, SessionConfetti } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

const REPORT_CATEGORY_KEYS = [
  ["answer_key", "assessment.reportAnswerKey"], ["ambiguous", "assessment.reportAmbiguous"], ["outdated", "assessment.reportOutdated"], ["typo", "assessment.reportTypo"], ["explanation", "assessment.reportExplanation"], ["other", "assessment.reportOther"]
];

function optionText(question, optionIds, t) {
  const options = Array.isArray(question.option_snapshot) ? question.option_snapshot : [];
  const names = options.filter((option) => optionIds?.includes(option.id)).map((option) => option.text).filter(Boolean);
  return names.length ? names.join(", ") : t("assessment.noAnswer");
}

function errorText(error, t) {
  if (!error) return "";
  const field = error.fields && Object.values(error.fields).flat().find((value) => typeof value === "string");
  return field || error.message || t("assessment.reportError");
}

function returnPath(state) {
  return typeof state?.returnTo === "string" && state.returnTo.startsWith("/questions") ? state.returnTo : "/questions";
}

export default function AssessmentResult() {
  const { t } = useI18n();
  const { resultId } = useParams();
  const location = useLocation();
  const result = useAsyncData(() => assessmentsApi.getResult(resultId), [resultId]);
  const returnTo = returnPath(location.state);

  if (result.loading) return <LoadingPanel />;
  if (result.error) return <ErrorPanel message={result.error} onRetry={result.reload} />;

  const data = result.data;
  if (!data.released) {
    return <Page title={data.quiz_title || t("assessment.resultTitle")} subtitle={t("assessment.pendingSubtitle")}><section className="session-result"><div className="session-top"><div><p className="eyebrow">{t("assessment.pendingEyebrow")}</p><h2>{t("assessment.awaitingRelease")}</h2></div><Link className="btn btn-soft" to={returnTo}>{t("assessment.exit")}</Link></div><article className="result-hero"><div><p>{t("assessment.pendingBody")}</p></div></article><div className="result-actions"><Link className="btn btn-primary" to={returnTo}>{t("assessment.backToQuizzes")}</Link><Link className="btn btn-soft" to="/review">{t("assessment.reviewQueue")}</Link></div></section></Page>;
  }

  const questions = Array.isArray(data.questions) ? data.questions : [];
  const correctCount = questions.filter((question) => question.correct === true).length;
  const incorrectCount = questions.filter((question) => question.correct === false && question.selected_option_ids?.length).length;
  return (
    <Page title={data.quiz_title || t("assessment.resultTitle")} subtitle={t("assessment.resultsSubtitle")}>
      <section className="session-result">
        <div className="session-top"><div><p className="eyebrow">{t("assessment.quizResults")}</p><h2 dir="auto">{data.quiz_title || t("assessment.completedQuiz")}</h2></div><Link className="btn btn-soft" to={returnTo}>{t("assessment.exitResults")}</Link></div>
        <article className="result-hero">
          {data.passed && <SessionConfetti />}
          <div><p className="eyebrow">{t("assessment.score")}</p><h2 dir="auto">{data.percentage}%</h2><p>{t(data.passed ? "assessment.passed" : "assessment.notPassed")}</p></div>
          <div className="result-stats"><div className="xp-card"><span>{t("assessment.correct")}</span><strong dir="auto">{correctCount}</strong></div><div className="xp-card"><span>{t("assessment.incorrect")}</span><strong dir="auto">{incorrectCount}</strong></div><div className="xp-card"><span>{t("assessment.total")}</span><strong dir="auto">{questions.length}</strong></div><div className="xp-card timer"><span>{t("assessment.points")}</span><strong dir="auto">{data.score_points}/{data.maximum_points}</strong></div></div>
        </article>
        <article className="panel mistake-review"><div className="panel-title"><div><p className="eyebrow">{t("assessment.questionReview")}</p><h2>{t("assessment.reviewEach")}</h2></div><span>{questions.length}</span></div>{questions.map((question) => <ResultQuestion key={question.id} resultId={data.id} question={question} />)}</article>
        <div className="result-actions"><Link className="btn btn-primary" to={`/community/context/quiz/${data.quiz_id}`}>{t("assessment.discussQuiz")}</Link><Link className="btn btn-soft" to={returnTo}>{t("assessment.exit")}</Link></div>
      </section>
    </Page>
  );
}

function ResultQuestion({ resultId, question }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("ambiguous");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const selected = Array.isArray(question.selected_option_ids) && question.selected_option_ids.length > 0;
  // The status drives a class name and two comparisons as well as the label, so
  // the identifier stays in English and only the label is translated.
  const status = question.correct === true ? "correct" : selected ? "incorrect" : "unanswered";
  const statusLabel = t(status === "correct" ? "assessment.correct" : status === "incorrect" ? "assessment.incorrect" : "assessment.statusUnanswered");
  const explanation = typeof question.explanation === "string" && question.explanation.trim() ? question.explanation : "";

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
    <details className={`mistake-row result-question result-question--${status}`}>
      <summary><span className="pill">{statusLabel}</span><strong dir="auto">{question.prompt}</strong><span>{t("assessment.reviewAnswer")}</span></summary>
      <div className="result-question-detail">
        <p>{t("assessment.yourAnswerIs")} <strong dir="auto">{optionText(question, question.selected_option_ids, t)}</strong></p>
        <p>{t("assessment.correctAnswerIs")} <strong dir="auto">{optionText(question, question.correct_option_ids, t)}</strong></p>
        {status === "incorrect" && (explanation ? <div className="result-explanation"><button className="btn btn-soft compact" type="button" onClick={() => setExplanationOpen((value) => !value)}>{t(explanationOpen ? "assessment.hideExplanation" : "assessment.explainQuestion")}</button>{explanationOpen && <p dir="auto">{explanation}</p>}</div> : <p className="save-hint">{t("assessment.noExplanation")}</p>)}
        {status === "correct" && explanation && <p className="save-hint">{t("assessment.explanationIncorrectOnly")}</p>}
        {sent ? <p className="save-hint" role="status">{t("assessment.reportSent")}</p> : <button className="btn btn-soft compact" type="button" onClick={() => setOpen((value) => !value)}>{t(open ? "assessment.closeReport" : "assessment.reportIssue")}</button>}
        {open && <form className="password-form" onSubmit={submitReport}><label className="field"><span>{t("assessment.category")}</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{REPORT_CATEGORY_KEYS.map(([value, labelKey]) => <option key={value} value={value}>{t(labelKey)}</option>)}</select></label><label className="field"><span>{t("assessment.details")}</span><textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={4000} required /></label>{error && <p className="inline-error" role="alert" dir="auto">{errorText(error, t)}</p>}<button className="btn btn-primary" type="submit" disabled={saving}>{t(saving ? "assessment.sending" : "assessment.sendReport")}</button></form>}
      </div>
    </details>
  );
}
