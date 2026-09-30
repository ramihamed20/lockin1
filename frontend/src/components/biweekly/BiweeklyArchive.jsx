import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { biweeklyApi } from "../../api/biweekly.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { useI18n } from "../I18nProvider.jsx";
import { countdownDays, groupHistory, periodLabel } from "../../lib/biweekly.js";
import "./biweekly.css";

export function BiweeklyArchive({ type }) {
  const { t, locale } = useI18n();
  const state = useAsyncData(() => biweeklyApi.history(type), [type]);
  const [clock, setClock] = useState(() => Date.now());
  const currentEnd = state.data?.current_period?.period_end;
  const reload = state.reload;
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (currentEnd && clock >= Date.parse(currentEnd)) reload();
  }, [clock, currentEnd, reload]);
  if (state.loading) return <section className="biweekly-archive" aria-busy="true">{t("common.loading")}</section>;
  if (state.error) return <section className="biweekly-archive"><p role="alert">{state.error}</p><button className="btn btn-soft" type="button" onClick={state.reload}>{t("common.tryAgain")}</button></section>;

  const { current_period: current, history } = state.data;
  const latest = history[0];
  const title = type === "review" ? t("biweekly.reviewTitle") : t("biweekly.analysisTitle");
  const detailPath = (id) => type === "review" ? `/review/biweekly/${id}` : `/analysis/${id}`;
  return <div className="biweekly-archive">
    <section className="biweekly-current" aria-label={title}>
      <p className="biweekly-eyebrow">{title}</p>
      <h2>{t(type === "review" ? "biweekly.nextReview" : "biweekly.nextReport", { days: countdownDays(current.next_report_at, clock) })}</h2>
      <p>{periodLabel(current.period_start, current.period_end, locale)} · {t("biweekly.currentPeriod")}</p>
      {latest && <div className="biweekly-latest"><strong>{t(type === "review" ? "biweekly.reviewReady" : "biweekly.reportReady")}</strong><div className="biweekly-actions"><Link className="btn btn-primary" to={detailPath(latest.id)}>{t(type === "review" ? "biweekly.viewReview" : "biweekly.viewReport")}</Link><a className="btn btn-soft" href={biweeklyApi.pdfUrl(type, latest.id)}>{t("biweekly.downloadPdf")}</a></div></div>}
    </section>
    <section className="biweekly-history" aria-label={t("biweekly.history")}><h2>{t("biweekly.history")}</h2>
      {history.length ? groupHistory(history, locale).map((group) => <section key={group.month} className="biweekly-month"><h3>{group.month}</h3><div className="biweekly-list">{group.reports.map((report) => <article className="biweekly-history-row" key={report.id}>
        <div><strong>{periodLabel(report.period_start, report.period_end, locale)}</strong><small>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(report.generated_at))} · {type === "review" ? t("biweekly.mistakes", { count: report.summary.mistake_count }) : t("biweekly.questions", { count: report.summary.questions_answered })}{type === "analysis" && report.summary.accuracy != null ? ` · ${report.summary.accuracy}%` : ""}</small></div>
        <div className="biweekly-row-actions"><Link to={detailPath(report.id)}>{t("biweekly.view")}</Link><a href={biweeklyApi.pdfUrl(type, report.id)}>{t("biweekly.downloadPdf")}</a>{type === "review" && report.test_completed_at && <Link to={`/review/biweekly/${report.id}/test`}>{t("biweekly.testResult")}</Link>}</div>
      </article>)}</div></section>) : <p className="biweekly-empty">{t("biweekly.noHistory")}</p>}
    </section>
  </div>;
}
