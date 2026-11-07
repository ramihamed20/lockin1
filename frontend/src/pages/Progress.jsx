import { useState } from "react";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page, Tab, TabList } from "../components/ui/index.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";
import { formatDate, formatDateTime, formatNumber } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";

import { activityCalendar } from "../lib/progressCalendar.js";

function dateLabel(value, t) {
  if (!value) return t("progress.awardNone");
  const formatted = formatDateTime(value, { dateStyle: undefined, timeStyle: undefined, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return formatted === "—" ? t("progress.awardRecorded") : formatted;
}

function ProgressCalendarGrid({ activity, selectedDay, onSelect }) {
  const { t } = useI18n();
  const days = activity.cells.flatMap((week) => week.days);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, days.findIndex((day) => day.key === selectedDay?.key)));

  function select(index) {
    const bounded = Math.min(Math.max(0, index), days.length - 1);
    setActiveIndex(bounded);
    onSelect(days[bounded]);
  }

  function handleKeyDown(event) {
    const rtl = document.documentElement.dir === "rtl";
    const horizontal = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const vertical = event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : activeIndex + horizontal + vertical;
    if (!horizontal && !vertical && !["Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    select(["Enter", " "].includes(event.key) ? activeIndex : next);
  }

  function handleClick(event) {
    const cell = event.target.closest?.("[data-calendar-index]");
    if (cell) select(Number(cell.dataset.calendarIndex));
  }

  let index = 0;
  return (
    <div
      className="progress-calendar-table"
      role="grid"
      tabIndex={0}
      aria-label={t("progress.calendarLabel")}
      aria-activedescendant={days[activeIndex] ? `progress-day-${days[activeIndex].key}` : undefined}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      <div className="progress-calendar-weekdays" aria-hidden="true"><i />{activity.weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      {activity.cells.map((week) => <div className="progress-calendar-week" role="row" key={week.label}><small>{week.label}</small>{week.days.map((cell) => {
        const cellIndex = index++;
        const stateLabel = t(cell.state === "active" || cell.state === "qualified" ? "progress.stateActivity" : cell.state === "future" ? "progress.stateFuture" : "progress.stateNone");
        return <span id={`progress-day-${cell.key}`} role="gridcell" data-calendar-index={cellIndex} className={`progress-calendar-cell progress-calendar-cell--${cell.state}`} key={cell.key} aria-label={t("progress.cellLabel", { day: cell.day, date: cell.key, state: stateLabel })} aria-selected={activeIndex === cellIndex}><i /></span>;
      })}</div>)}
    </div>
  );
}

function ledgerIcon(category) {
  if (category === "focus") return "target";
  if (category === "assessment") return "award";
  if (category === "learning") return "book-open";
  return "sparkles";
}

export default function Progress({ user = null }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState("week");
  const [selectedDay, setSelectedDay] = useState(null);
  const [progressSection, setProgressSection] = useState("summary");
  const xpState = useAsyncData(() => motivationApi.xpSummary(), [user?.id], { cacheKey: `progress-xp:${user?.id}` });
  const streakState = useAsyncData(() => motivationApi.streakSummary(), [user?.id], { cacheKey: `progress-streak:${user?.id}` });
  const zone = streakState.data?.calendar?.timezone || "UTC";
  const ledgerState = useAsyncData(() => motivationApi.xpLedger({ page, pageSize: 5, period: range, timezone: zone }), [user?.id, page, range, zone], { cacheKey: `progress-ledger:${user?.id}:${page}:${range}:${zone}` });
  const xp = xpState.data;
  const streak = streakState.data;
  const ledger = ledgerState.loading ? null : ledgerState.data;
  const levelProgress = xp?.level_target > 0 ? Math.round(xp.level_progress * 100 / xp.level_target) : 0;
  const currentDays = streak?.current_days ?? 0;
  const longestDays = streak?.longest_days ?? 0;
  const activity = activityCalendar(streak?.calendar, streak?.last_qualified_on, t, formatDate);
  const ledgerPreview = ledger?.results || [];
  const consistencyRate = activity?.consistencyRate ?? 0;

  return (
    <Page title={t("progress.title")} showHeading={false} headingHandled>
      <header className="progress-page-heading">
        <h1 className="visually-hidden">{t("progress.title")}</h1>
        <label className="progress-range-control"><Icon name="calendar" size={16} /><select value={range} onChange={(event) => { setRange(event.target.value); setPage(1); }} aria-label={t("progress.period")}><option value="week">{t("progress.weekThis")}</option><option value="month">{t("progress.rangeMonth")}</option><option value="all">{t("progress.rangeAll")}</option></select></label>
      </header>

      <TabList className="progress-mobile-nav" label={t("progress.sections")} value={progressSection} onChange={setProgressSection}>
        {[["summary", "progress.summary"], ["history", "progress.history"], ["calendar", "progress.calendar"]].map(([id, labelKey]) => (
          <Tab key={id} value={id}>{t(labelKey)}</Tab>
        ))}
      </TabList>

      {xpState.loading && <LoadingPanel variant="progress" />}
      {xpState.error && <ErrorPanel message={xpState.errorDetails || xpState.error} onRetry={xpState.reload} />}
      {xp && <section className={`progress-level-hero progress-mobile-section ${progressSection === "summary" ? "is-active" : ""}`}>
        <div className="progress-level-orb" aria-label={t("progress.levelLabel", { level: xp.level ?? 1 })}><strong>{xp.level ?? 1}</strong></div>
        <div className="progress-level-copy"><h2 dir="auto">{t("progress.levelTitle", { level: xp.level ?? 1 })}</h2><div className="progress-level-bar" role="progressbar" aria-label={t("progress.xpProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelProgress}><i style={{ width: String(levelProgress) + "%" }} /></div><small dir="auto">{t("progress.xpToNext", { current: formatNumber(xp.level_progress || 0), target: formatNumber(xp.level_target || 0), next: Number(xp.level ?? 1) + 1 })}</small></div>
      </section>}

      <section className={`progress-stat-grid progress-mobile-section ${progressSection === "summary" ? "is-active" : ""}`}>
        {xp && <article className="progress-stat-card progress-stat-card--xp"><span className="progress-stat-icon"><Icon name="award" size={25} /></span><div><small>{t("progress.totalXp")}</small><strong dir="auto">{formatNumber(xp.total_points || 0)} <em>{t("progress.xp")}</em></strong><p dir="auto">{t("progress.fromAwards", { count: formatNumber(xp.transaction_count ?? 0) })}</p></div><Icon name="analytics" size={26} /></article>}
        {streak && <article className="progress-stat-card progress-stat-card--streak"><span className="progress-stat-icon"><Icon name="flame" size={25} /></span><div><small>{t("progress.currentStreak")}</small><strong dir="auto">{currentDays} <em>{t("progress.dayCount", { count: currentDays })}</em></strong><p dir="auto">{t("progress.personalBest", { count: longestDays })}</p></div><Icon name="activity" size={26} /></article>}
        {streak && <article className="progress-stat-card progress-stat-card--policy"><span className="progress-stat-icon"><Icon name="calendar" size={25} /></span><div><small>{t("progress.streakPolicy")}</small><strong dir="auto">{!streak.policy?.title || streak.policy.title === "Meaningful learning days" ? t(streak.policy?.title ? "progress.meaningfulDays" : "progress.learningDays") : streak.policy.title}</strong><p dir="auto">{t("progress.graceDays", { count: streak?.policy?.grace_days ?? 0 })}</p></div><Icon name="help" size={19} /></article>}
      </section>

      <section className="progress-detail-grid">
        <article className={`progress-ledger-panel progress-mobile-section ${progressSection === "history" ? "is-active" : ""}`}>
          <header><h2>{t("progress.awardHistory")}</h2></header>
          {ledgerState.loading && <LoadingPanel variant="list" />}
          {ledgerState.error && <ErrorPanel message={ledgerState.errorDetails || ledgerState.error} onRetry={ledgerState.reload} />}
          {ledger && <div className="progress-ledger-list">
            {ledgerPreview.length ? ledgerPreview.map((entry) => <article className="progress-ledger-row" key={entry.id}><span className={"progress-ledger-icon progress-ledger-icon--" + (entry.category || "default")}><Icon name={ledgerIcon(entry.category)} size={17} /></span><div><strong dir="auto">{entry.reason || t("progress.xpAward")}</strong><small dir="auto">{dateLabel(entry.occurred_at, t)}</small></div><b dir="auto">{Number(entry.points || 0) >= 0 ? "+" : ""}{entry.points ?? 0} {t("progress.xp")}</b></article>) : <p className="progress-empty-ledger">{t("progress.noAwards")}</p>}
          </div>}
          <PaginationControls page={page} pageData={ledger} onPageChange={setPage} label={t("progress.ledgerPages")} />
        </article>

        <article className={`progress-calendar-panel progress-mobile-section ${progressSection === "calendar" ? "is-active" : ""}`}>
          <header><h2>{t("progress.meaningfulDays")}</h2></header>
          {streakState.loading && <LoadingPanel variant="list" />}
          {streakState.error && <ErrorPanel message={streakState.errorDetails || streakState.error} onRetry={streakState.reload} />}
          {streak && !activity && <p role="status">{t("progress.calendarUnavailable")}</p>}
          {activity && <>
          <ProgressCalendarGrid activity={activity} selectedDay={selectedDay} onSelect={setSelectedDay} />
          {selectedDay && <p className="activity-cell-detail" role="status"><strong dir="auto">{selectedDay.day}, {selectedDay.key}</strong><span>{t(selectedDay.state === "active" || selectedDay.state === "qualified" ? "progress.dayActivity" : selectedDay.state === "future" ? "progress.dayFuture" : "progress.dayNone")}</span></p>}
          <div className="progress-calendar-legend"><span><i className="active" /> {t("progress.legendActivity")}</span><span><i className="qualified" /> {t("progress.legendQualified")}</span><span><i className="empty" /> {t("progress.legendNone")}</span></div>
          <div className="progress-calendar-metrics"><div><strong>{activity.activeDays}</strong><span>{t("progress.activeDays")}</span></div><div><strong>{streak?.policy?.grace_days ?? 0}</strong><span>{t("progress.graceAllowance")}</span></div><div><strong>{consistencyRate}%</strong><span>{t("progress.consistencyRate")}</span></div></div>
          </>}
        </article>
      </section>

    </Page>
  );
}
