import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { biweeklyApi } from "../api/biweekly.js";
import { BiweeklyArchive } from "../components/biweekly/BiweeklyArchive.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { periodLabel } from "../lib/biweekly.js";

export function AnalysisPage() {
  const { t } = useI18n();
  return <Page width="reading" title={t("nav.analysis")} showHeading><BiweeklyArchive type="analysis" /></Page>;
}

export function BiweeklyDetail({ type }) {
  const { id } = useParams();
  const { t, locale } = useI18n();
  const state = useAsyncData(() => biweeklyApi.report(type, id), [type, id]);
  if (state.loading) return <Page title={t("biweekly.view")}> <LoadingPanel /> </Page>;
  if (state.error) return <Page title={t("biweekly.view")}><ErrorPanel message={state.error} onRetry={state.reload} /></Page>;
  const report = state.data;
  const data = report.data;
  return <Page title={type === "review" ? t("biweekly.reviewTitle") : t("biweekly.analysisTitle")} subtitle={periodLabel(report.period_start, report.period_end, locale)}>
    <div className="biweekly-detail-actions"><Link className="btn btn-soft" to={type === "review" ? "/review" : "/analysis"}>{t("biweekly.history")}</Link><a className="btn btn-soft" href={biweeklyApi.pdfUrl(type, id, true)} target="_blank" rel="noopener noreferrer">{t("biweekly.previewPdf")}</a><a className="btn btn-primary" href={biweeklyApi.pdfUrl(type, id)}>{t("biweekly.downloadPdf")}</a></div>
    {type === "analysis" ? <AnalysisDetail data={data} t={t} /> : <ReviewDetail data={data} reportId={id} t={t} />}
  </Page>;
}

function AnalysisDetail({ data, t }) {
  const metrics = data.metrics;
  const rows = [
    [t("biweekly.studyTime"), `${Math.floor(metrics.study_time_seconds / 3600)}h ${String(Math.floor(metrics.study_time_seconds % 3600 / 60)).padStart(2, "0")}m`],
    [t("biweekly.questions", { count: metrics.questions_answered }), metrics.questions_answered],
    [t("biweekly.accuracy"), metrics.accuracy == null ? "—" : `${metrics.accuracy}%`],
    [t("biweekly.activeDays"), `${metrics.active_days} / 14`],
    [t("biweekly.mistakesMastered"), metrics.mistakes_mastered]
  ];
  return <div className="biweekly-detail"><section className="biweekly-current"><h2>{t("biweekly.numbers")}</h2><dl className="biweekly-metric-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section className="biweekly-history"><h2>{t("biweekly.insights")}</h2>{data.insights.map((insight) => <p key={insight}>{insight}</p>)}{!data.insights.length && <p>{t("biweekly.lowActivity")}</p>}</section>
    <section className="biweekly-history"><h2>{t("biweekly.subjects")}</h2>{data.subject_performance.map((subject) => <p key={subject.subject}>{subject.subject} · {subject.answered} · {subject.reliable ? `${subject.accuracy}%` : t("biweekly.smallSample")}</p>)}{!data.subject_performance.length && <p>{t("biweekly.lowActivity")}</p>}</section>
  </div>;
}

function ReviewDetail({ data, reportId, t }) {
  return <div className="biweekly-detail"><section className="biweekly-current"><h2>{t("biweekly.mistakes", { count: data.mistake_count })}</h2>{data.mistake_count ? <Link className="btn btn-primary" to={`/review/biweekly/${reportId}/test`}>{t("biweekly.startTest")}</Link> : <p>{t("biweekly.noMistakes")}</p>}</section>
    {data.questions.map((question, index) => <article className="biweekly-history" key={question.review_item_id}><small>{question.subject} · {question.sheet}</small><h2>{index + 1}. {question.prompt}</h2><ol type="A">{question.options.map((option) => <li key={option.id}>{option.text}</li>)}</ol><p>{t("biweekly.studentAnswer")}: {question.student_answers.join(", ")}</p><p>{t("biweekly.correctAnswer")}: {question.correct_answers.join(", ")}</p><p>{t("biweekly.why")}: {question.explanation || "—"}</p></article>)}
  </div>;
}

export function BiweeklyTest() {
  const { id } = useParams();
  const { t } = useI18n();
  const state = useAsyncData(() => biweeklyApi.test(id), [id]);
  const [selected, setSelected] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (state.loading) return <Page title={t("biweekly.startTest")}><LoadingPanel /></Page>;
  if (state.error) return <Page title={t("biweekly.startTest")}><ErrorPanel message={state.error} onRetry={state.reload} /></Page>;
  const questions = state.data.questions;
  const outcome = result || state.data.result;
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { const response = await biweeklyApi.submitTest(id, selected); setResult(response.result); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Page title={t("biweekly.startTest")}><div className="biweekly-detail-actions"><Link to={`/review/biweekly/${id}`} className="btn btn-soft">{t("biweekly.viewReview")}</Link></div>
    {outcome && <p role="status">{t("biweekly.testScore", { correct: Object.values(outcome).filter((answer) => answer.was_correct).length, total: questions.length })}</p>}
    <form className="biweekly-test" onSubmit={submit}>{questions.map((question, index) => <fieldset className="biweekly-history" key={question.review_item_id} disabled={Boolean(outcome)}><legend>{index + 1}. {question.prompt}</legend><p>{question.subject} · {question.sheet}</p>{question.options.map((option) => <label key={option.id} className="biweekly-option"><input type={question.question_type === "multiple_select" ? "checkbox" : "radio"} name={question.review_item_id} value={option.id} checked={(selected[question.review_item_id] || []).includes(option.id)} onChange={() => setSelected((current) => { const before = current[question.review_item_id] || []; const next = question.question_type === "multiple_select" ? before.includes(option.id) ? before.filter((value) => value !== option.id) : [...before, option.id] : [option.id]; return { ...current, [question.review_item_id]: next }; })} />{option.text}</label>)}{outcome?.[question.review_item_id] && <strong>{outcome[question.review_item_id].was_correct ? t("biweekly.correct") : t("biweekly.needsReview")}</strong>}</fieldset>)}
      {!outcome && questions.length > 0 && <button className="btn btn-primary" type="submit" disabled={busy || questions.some((question) => !(selected[question.review_item_id] || []).length)}>{t("biweekly.submitTest")}</button>}{error && <p role="alert">{error}</p>}
    </form>
  </Page>;
}
