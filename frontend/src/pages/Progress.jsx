import { useState } from "react";
import { Link } from "react-router-dom";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEK_LABELS = ["This week", "Last week", "2 weeks ago", "3 weeks ago"];

function dateLabel(value) {
  if (!value) return "No server award recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Server award recorded";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
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

function activityCalendar(entries, lastQualifiedOn) {
  const activityDays = new Set(entries.map((entry) => dateKey(entry.occurred_at)).filter(Boolean));
  const weekStart = startOfWeek();
  const today = dateKey(new Date());
  const cells = WEEK_LABELS.map((label, rowIndex) => {
    const rowStart = addDays(weekStart, -rowIndex * 7);
    return {
      label,
      days: WEEKDAYS.map((day, dayIndex) => {
        const key = dateKey(addDays(rowStart, dayIndex));
        const future = key > today;
        const qualified = !future && key === lastQualifiedOn;
        const active = !future && activityDays.has(key);
        return { day, key, state: future ? "future" : qualified ? "qualified" : active ? "active" : "empty" };
      })
    };
  });
  return { cells, activeDays: activityDays.size };
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
  const [page, setPage] = useState(1);
  const [range, setRange] = useState("week");
  const progression = useAsyncData(() => loadProgression(page), [page]);
  if (progression.loading) return <LoadingPanel />;
  if (progression.error) return <ErrorPanel message={progression.error} onRetry={progression.reload} />;

  const { xp, ledger, streak } = progression.data;
  const levelProgress = Number(xp.level_target) > 0
    ? Math.round((Number(xp.level_progress) / Number(xp.level_target)) * 100)
    : 0;
  const currentDays = Number(streak.current_days) || 0;
  const longestDays = Number(streak.longest_days) || 0;
  const activity = activityCalendar(ledger.results, typeof streak.last_qualified_on === "string" ? streak.last_qualified_on : "");
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
    <Page title="My Progress" subtitle="Track your learning journey and keep growing.">
      <header className="progress-page-heading">
        <div><h1>My Progress <Icon name="sparkles" size={20} /></h1><p>Track your learning journey and keep growing.</p></div>
        <label className="progress-range-control"><Icon name="calendar" size={16} /><select value={range} onChange={(event) => { setRange(event.target.value); setPage(1); }} aria-label="Progress period"><option value="week">This week</option><option value="month">Last 4 weeks</option><option value="all">All time</option></select></label>
      </header>

      <section className="progress-level-hero">
        <div className="progress-level-orb" aria-label={"Level " + (xp.level ?? 1)}><small>Your level</small><strong>{xp.level ?? 1}</strong></div>
        <div className="progress-level-copy"><h2>Level {xp.level ?? 1} - Explorer</h2><p>Keep going, you are on the right path.</p><div className="progress-level-bar" role="progressbar" aria-label="XP progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelProgress}><i style={{ width: String(levelProgress) + "%" }} /></div><small>{Number(xp.level_progress || 0).toLocaleString()} / {Number(xp.level_target || 0).toLocaleString()} XP to level {Number(xp.level ?? 1) + 1}</small></div>
        <div className="progress-xp-arc"><small>XP progress</small><svg viewBox="0 0 120 72" aria-hidden="true"><path className="progress-xp-arc-track" pathLength="100" d="M 12 60 A 48 48 0 0 1 108 60" /><path className="progress-xp-arc-value" pathLength="100" strokeDasharray={String(levelProgress) + " 100"} d="M 12 60 A 48 48 0 0 1 108 60" /></svg><strong>{levelProgress}%</strong><span>{Number(xp.level_progress || 0).toLocaleString()} / {Number(xp.level_target || 0).toLocaleString()} XP<br />in this level</span></div>
      </section>

      <section className="progress-stat-grid">
        <article className="progress-stat-card progress-stat-card--xp"><span className="progress-stat-icon"><Icon name="award" size={25} /></span><div><small>Total XP</small><strong>{Number(xp.total_points || 0).toLocaleString()} <em>XP</em></strong><p>From {xp.transaction_count ?? 0} server awards</p></div><Icon name="analytics" size={26} /></article>
        <article className="progress-stat-card progress-stat-card--streak"><span className="progress-stat-icon"><Icon name="flame" size={25} /></span><div><small>Current streak</small><strong>{currentDays} <em>day{currentDays === 1 ? "" : "s"}</em></strong><p>Personal best: {longestDays} days</p></div><Icon name="activity" size={26} /></article>
        <article className="progress-stat-card progress-stat-card--policy"><span className="progress-stat-icon"><Icon name="calendar" size={25} /></span><div><small>Streak policy</small><strong>{streak.policy?.title || "Learning days"}</strong><p>Grace allowance: {streak.policy?.grace_days ?? 0} days</p></div><Icon name="help" size={19} /></article>
      </section>

      <section className="progress-detail-grid">
        <article className="progress-ledger-panel">
          <header><div><p>XP ledger</p><h2>Server award history</h2><span>Your recent XP earnings</span></div><Icon name="activity" size={18} /></header>
          <div className="progress-ledger-list">
            {ledgerPreview.length ? ledgerPreview.map((entry) => <article className="progress-ledger-row" key={entry.id}><span className={"progress-ledger-icon progress-ledger-icon--" + (entry.category || "default")}><Icon name={ledgerIcon(entry.category)} size={17} /></span><div><strong>{entry.reason || "Server XP award"}</strong><small>{dateLabel(entry.occurred_at)}</small></div><b>{Number(entry.points || 0) >= 0 ? "+" : ""}{entry.points ?? 0} XP</b></article>) : <p className="progress-empty-ledger">No XP awards in this period yet.</p>}
          </div>
          <PaginationControls page={page} pageData={ledger} onPageChange={setPage} label="XP ledger pages" />
        </article>

        <article className="progress-calendar-panel">
          <header><div><p>Streak overview</p><h2>Meaningful learning days</h2><span>Consistency is your superpower.</span></div></header>
          <div className="progress-calendar-table" role="img" aria-label="Four-week server activity calendar"><div className="progress-calendar-weekdays"><i />{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>{activity.cells.map((week) => <div className="progress-calendar-week" key={week.label}><small>{week.label}</small>{week.days.map((cell) => <span className={"progress-calendar-cell progress-calendar-cell--" + cell.state} key={cell.key} title={cell.day + ", " + cell.key}><i /></span>)}</div>)}</div>
          <div className="progress-calendar-legend"><span><i className="active" /> Server activity</span><span><i className="qualified" /> Latest qualified day</span><span><i className="empty" /> No activity</span></div>
          <div className="progress-calendar-metrics"><div><strong>{activity.activeDays}</strong><span>Active days</span></div><div><strong>{streak.policy?.grace_days ?? 0}</strong><span>Grace allowance</span></div><div><strong>{consistencyRate}%</strong><span>Consistency rate</span></div></div>
        </article>
      </section>

      <aside className="progress-study-cta"><Icon name="sparkles" size={28} /><p>Discipline today, mastery tomorrow.</p><Link to="/lock-in">Keep studying <Icon name="chevron-right" size={17} /></Link></aside>
    </Page>
  );
}
