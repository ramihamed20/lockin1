import { useState } from "react";
import { Link } from "react-router-dom";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page, Tab, TabList } from "../components/ui/index.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";
import { formatDate, formatDateTime, formatNumber } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";

const WEEK_COUNT = 4;

function dateLabel(value, t) {
  if (!value) return t("progress.awardNone");
  const formatted = formatDateTime(value, { dateStyle: undefined, timeStyle: undefined, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return formatted === "—" ? t("progress.awardRecorded") : formatted;
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function startOfWeek(value = new Date()) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Short weekday names in the interface language, starting on Monday. Counting
 * from a date that is known to be a Monday keeps the order fixed while the
 * names follow the locale.
 */
function weekdayLabels() {
  const knownMonday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) => formatDate(addDays(knownMonday, index), { weekday: "short" }));
}

function weekLabel(rowIndex, t) {
  if (rowIndex === 0) return t("progress.weekThis");
  if (rowIndex === 1) return t("progress.weekLast");
  return t("progress.weeksAgo", { count: rowIndex });
}

function activityCalendar(entries, lastQualifiedOn, t) {
  const activityDays = new Set(entries.map((entry) => dateKey(entry.occurred_at)).filter(Boolean));
  const weekStart = startOfWeek();
  const today = dateKey(new Date());
  const weekdays = weekdayLabels();
  const cells = Array.from({ length: WEEK_COUNT }, (_, rowIndex) => {
    const rowStart = addDays(weekStart, -rowIndex * 7);
    return {
      label: weekLabel(rowIndex, t),
      weekdays,
      days: weekdays.map((day, dayIndex) => {
        const key = dateKey(addDays(rowStart, dayIndex));
        const future = key > today;
        const qualified = !future && key === lastQualifiedOn;
        const active = !future && activityDays.has(key);
        return { day, key, state: future ? "future" : qualified ? "qualified" : active ? "active" : "empty" };
      })
    };
  });
  return { cells, weekdays, activeDays: activityDays.size };
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

async function loadProgression(page) {
  const [xp, ledger, streak] = await Promise.all([
    motivationApi.xpSummary(),
    motivationApi.xpLedger({ page }),
    motivationApi.streakSummary()
  ]);
  return { xp, ledger, streak };
}

export default function Progress() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState("week");
  const [selectedDay, setSelectedDay] = useState(null);
  const [progressSection, setProgressSection] = useState("summary");
  const progression = useAsyncData(() => loadProgression(page), [page]);
  if (progression.loading) return <LoadingPanel />;
  if (progression.error) return <ErrorPanel message={progression.error} onRetry={progression.reload} />;

  const { xp, ledger, streak } = progression.data;
  const levelProgress = Number(xp.level_target) > 0
    ? Math.round((Number(xp.level_progress) / Number(xp.level_target)) * 100)
    : 0;
  const currentDays = Number(streak.current_days) || 0;
  const longestDays = Number(streak.longest_days) || 0;
  const activity = activityCalendar(ledger.results, typeof streak.last_qualified_on === "string" ? streak.last_qualified_on : "", t);
  const rangeStart = (() => {
    const now = new Date();
    if (range === "month") return addDays(now, -28);
    if (range === "all") return null;
    return startOfWeek(now);
  })();
  const rangeLedger = rangeStart
    ? ledger.results.filter((entry) => new Date(entry.occurred_at) >= rangeStart)
    : ledger.results;
  const visibleLedger = rangeLedger.length ? rangeLedger : ledger.results;
  const ledgerPreview = visibleLedger.slice(0, 5);
  const consistencyRate = Math.min(100, Math.round((activity.activeDays / 28) * 100));

  return (
    <Page title={t("progress.title")} subtitle={t("progress.subtitle")} showHeading={false} headingHandled>
      <header className="progress-page-heading">
        <div><h1>{t("progress.title")} <Icon name="sparkles" size={20} /></h1><p>{t("progress.subtitle")}</p></div>
        <label className="progress-range-control"><Icon name="calendar" size={16} /><select value={range} onChange={(event) => { setRange(event.target.value); setPage(1); }} aria-label={t("progress.period")}><option value="week">{t("progress.weekThis")}</option><option value="month">{t("progress.rangeMonth")}</option><option value="all">{t("progress.rangeAll")}</option></select></label>
      </header>

      <TabList className="progress-mobile-nav" label={t("progress.sections")} value={progressSection} onChange={setProgressSection}>
        {[["summary", "progress.summary"], ["history", "progress.history"], ["calendar", "progress.calendar"]].map(([id, labelKey]) => (
          <Tab key={id} value={id}>{t(labelKey)}</Tab>
        ))}
      </TabList>

      <section className={`progress-level-hero progress-mobile-section ${progressSection === "summary" ? "is-active" : ""}`}>
        <div className="progress-level-orb" aria-label={t("progress.levelLabel", { level: xp.level ?? 1 })}><small>{t("progress.yourLevel")}</small><strong>{xp.level ?? 1}</strong></div>
        <div className="progress-level-copy"><h2 dir="auto">{t("progress.levelTitle", { level: xp.level ?? 1 })}</h2><p>{t("progress.levelCopy")}</p><div className="progress-level-bar" role="progressbar" aria-label={t("progress.xpProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelProgress}><i style={{ width: String(levelProgress) + "%" }} /></div><small dir="auto">{t("progress.xpToNext", { current: formatNumber(xp.level_progress || 0), target: formatNumber(xp.level_target || 0), next: Number(xp.level ?? 1) + 1 })}</small></div>
        <div className="progress-xp-arc"><small>{t("progress.xpProgress")}</small><svg viewBox="0 0 120 72" aria-hidden="true"><path className="progress-xp-arc-track" pathLength="100" d="M 12 60 A 48 48 0 0 1 108 60" /><path className="progress-xp-arc-value" pathLength="100" strokeDasharray={String(levelProgress) + " 100"} d="M 12 60 A 48 48 0 0 1 108 60" /></svg><strong>{levelProgress}%</strong><span dir="auto">{t("progress.xpInLevel", { current: formatNumber(xp.level_progress || 0), target: formatNumber(xp.level_target || 0) })}<br />{t("progress.inThisLevel")}</span></div>
      </section>

      <section className={`progress-stat-grid progress-mobile-section ${progressSection === "summary" ? "is-active" : ""}`}>
        <article className="progress-stat-card progress-stat-card--xp"><span className="progress-stat-icon"><Icon name="award" size={25} /></span><div><small>{t("progress.totalXp")}</small><strong dir="auto">{formatNumber(xp.total_points || 0)} <em>{t("progress.xp")}</em></strong><p dir="auto">{t("progress.fromAwards", { count: formatNumber(xp.transaction_count ?? 0) })}</p></div><Icon name="analytics" size={26} /></article>
        <article className="progress-stat-card progress-stat-card--streak"><span className="progress-stat-icon"><Icon name="flame" size={25} /></span><div><small>{t("progress.currentStreak")}</small><strong dir="auto">{currentDays} <em>{t("progress.dayCount", { count: currentDays })}</em></strong><p dir="auto">{t("progress.personalBest", { count: longestDays })}</p></div><Icon name="activity" size={26} /></article>
        <article className="progress-stat-card progress-stat-card--policy"><span className="progress-stat-icon"><Icon name="calendar" size={25} /></span><div><small>{t("progress.streakPolicy")}</small><strong dir="auto">{streak.policy?.title || t("progress.learningDays")}</strong><p dir="auto">{t("progress.graceDays", { count: streak.policy?.grace_days ?? 0 })}</p></div><Icon name="help" size={19} /></article>
      </section>

      <section className="progress-detail-grid">
        <article className={`progress-ledger-panel progress-mobile-section ${progressSection === "history" ? "is-active" : ""}`}>
          <header><div><p>{t("progress.xpLedger")}</p><h2>{t("progress.awardHistory")}</h2><span>{t("progress.recentEarnings")}</span></div><Icon name="activity" size={18} /></header>
          <div className="progress-ledger-list">
            {ledgerPreview.length ? ledgerPreview.map((entry) => <article className="progress-ledger-row" key={entry.id}><span className={"progress-ledger-icon progress-ledger-icon--" + (entry.category || "default")}><Icon name={ledgerIcon(entry.category)} size={17} /></span><div><strong dir="auto">{entry.reason || t("progress.xpAward")}</strong><small dir="auto">{dateLabel(entry.occurred_at, t)}</small></div><b dir="auto">{Number(entry.points || 0) >= 0 ? "+" : ""}{entry.points ?? 0} {t("progress.xp")}</b></article>) : <p className="progress-empty-ledger">{t("progress.noAwards")}</p>}
          </div>
          <PaginationControls page={page} pageData={ledger} onPageChange={setPage} label={t("progress.ledgerPages")} />
        </article>

        <article className={`progress-calendar-panel progress-mobile-section ${progressSection === "calendar" ? "is-active" : ""}`}>
          <header><div><p>{t("progress.streakOverview")}</p><h2>{t("progress.meaningfulDays")}</h2><span>{t("progress.consistencyCopy")}</span></div></header>
          <ProgressCalendarGrid activity={activity} selectedDay={selectedDay} onSelect={setSelectedDay} />
          {selectedDay && <p className="activity-cell-detail" role="status"><strong dir="auto">{selectedDay.day}, {selectedDay.key}</strong><span>{t(selectedDay.state === "active" || selectedDay.state === "qualified" ? "progress.dayActivity" : selectedDay.state === "future" ? "progress.dayFuture" : "progress.dayNone")}</span></p>}
          <div className="progress-calendar-legend"><span><i className="active" /> {t("progress.legendActivity")}</span><span><i className="qualified" /> {t("progress.legendQualified")}</span><span><i className="empty" /> {t("progress.legendNone")}</span></div>
          <div className="progress-calendar-metrics"><div><strong>{activity.activeDays}</strong><span>{t("progress.activeDays")}</span></div><div><strong>{streak.policy?.grace_days ?? 0}</strong><span>{t("progress.graceAllowance")}</span></div><div><strong>{consistencyRate}%</strong><span>{t("progress.consistencyRate")}</span></div></div>
        </article>
      </section>

      <aside className={`progress-study-cta progress-mobile-section ${progressSection === "summary" ? "is-active" : ""}`}><Icon name="sparkles" size={28} /><p>{t("progress.ctaCopy")}</p><Link to="/lock-in">{t("progress.keepStudying")} <Icon name="chevron-right" size={17} /></Link></aside>
    </Page>
  );
}
