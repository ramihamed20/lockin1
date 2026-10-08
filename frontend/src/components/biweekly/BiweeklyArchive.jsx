import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { biweeklyApi } from "../../api/biweekly.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { countdownDays, groupHistory, periodLabel } from "../../lib/biweekly.js";
import "./biweekly.css";

/**
 * One fetch of a report type's current period and history, reloaded when the
 * current period closes. The two parts below render from it, so a screen can
 * place the current period and the archive in different places.
 */
export function useBiweekly(type) {
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
  return { ...state, clock };
}

function detailPath(type, id) {
  return type === "review" ? `/review/biweekly/${id}` : `/analysis/${id}`;
}

/** The current period: when the next report arrives, and the latest one if it is ready. */
export function BiweeklyCurrent({ type, biweekly }) {
  const { t, locale } = useI18n();
  // The placeholder has the loaded card's shape (icon, kicker, title, period),
  // so the card does not change height or jump when the period arrives.
  if (biweekly.loading) return <section className="biweekly-current is-loading" aria-busy="true" aria-label={t("common.loading")}><div className="biweekly-current-main" aria-hidden="true"><span className="skeleton biweekly-current-icon" /><span className="biweekly-skeleton-lines"><span className="skeleton biweekly-skeleton is-kicker" /><span className="skeleton biweekly-skeleton" /><span className="skeleton biweekly-skeleton is-meta" /></span></div></section>;
  if (biweekly.error) return <section className="biweekly-current"><p role="alert">{biweekly.error}</p><button className="btn btn-soft compact" type="button" onClick={biweekly.reload}>{t("common.tryAgain")}</button></section>;
  const { current_period: current, history } = biweekly.data;
  const latest = history[0];
  const title = type === "review" ? t("biweekly.reviewTitle") : t("biweekly.analysisTitle");
  return <section className="biweekly-current" aria-label={title}>
    <div className="biweekly-current-main">
      <span className="biweekly-current-icon" aria-hidden="true"><Icon name="calendar" size={20} /></span>
      <div>
        <p className="biweekly-kicker">{title}</p>
        <h2>{t(type === "review" ? "biweekly.nextReview" : "biweekly.nextReport", { days: countdownDays(current.next_report_at, biweekly.clock) })}</h2>
        <p>{periodLabel(current.period_start, current.period_end, locale)} · {t("biweekly.currentPeriod")}</p>
      </div>
    </div>
    {latest && <div className="biweekly-latest">
      <strong>{t(type === "review" ? "biweekly.reviewReady" : "biweekly.reportReady")}</strong>
      <div className="biweekly-actions">
        <Link className="btn btn-primary compact" to={detailPath(type, latest.id)}>{t(type === "review" ? "biweekly.viewReview" : "biweekly.viewReport")}</Link>
        <a className="btn btn-soft compact" href={biweeklyApi.pdfUrl(type, latest.id)}>{t("biweekly.downloadPdf")}</a>
      </div>
    </div>}
  </section>;
}

/** Closed periods, newest first, grouped by month. Each stays viewable and downloadable. */
export function BiweeklyHistory({ type, biweekly }) {
  const { t, locale } = useI18n();
  if (biweekly.loading || biweekly.error) return null;
  const { history } = biweekly.data;
  return <section className="biweekly-history" aria-label={t("biweekly.history")}>
    <h2>{t("biweekly.history")}</h2>
    {history.length ? groupHistory(history, locale).map((group) => <section key={group.month} className="biweekly-month">
      <h3>{group.month}</h3>
      <div className="biweekly-list">{group.reports.map((report) => <article className="biweekly-history-row" key={report.id}>
        <div>
          <strong>{periodLabel(report.period_start, report.period_end, locale)}</strong>
          <small>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(report.generated_at))} · {type === "review" ? t("biweekly.mistakes", { count: report.summary.mistake_count }) : t("biweekly.questions", { count: report.summary.questions_answered })}{type === "analysis" && report.summary.accuracy != null ? ` · ${report.summary.accuracy}%` : ""}</small>
        </div>
        <div className="biweekly-row-actions">
          <Link to={detailPath(type, report.id)}>{t("biweekly.view")}</Link>
          <a href={biweeklyApi.pdfUrl(type, report.id)}>{t("biweekly.downloadPdf")}</a>
          {type === "review" && report.test_completed_at && <Link to={`/review/biweekly/${report.id}/test`}>{t("biweekly.testResult")}</Link>}
        </div>
      </article>)}</div>
    </section>) : <p className="biweekly-empty">{t("biweekly.noHistory")}</p>}
  </section>;
}

/** The whole archive in one place, for the Analysis page. */
export function BiweeklyArchive({ type }) {
  const biweekly = useBiweekly(type);
  return <div className="biweekly-archive">
    <BiweeklyCurrent type={type} biweekly={biweekly} />
    <BiweeklyHistory type={type} biweekly={biweekly} />
  </div>;
}
