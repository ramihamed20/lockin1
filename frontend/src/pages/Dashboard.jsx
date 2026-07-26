import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi } from "../api/learning.js";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { focusDurations } from "../lib/constants.js";
import { formatDuration, readFocusDurationPreference, themePreview } from "../lib/utils.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";
import { StatsGrid } from "../components/shared/StatsGrid.jsx";

async function loadDashboard() {
  const [accountResult, learningResult, resumeResult] = await Promise.allSettled([
    dashboardApi.accountDashboard(),
    progressApi.learningDashboard(),
    progressApi.listResume()
  ]);
  if (accountResult.status === "rejected" && learningResult.status === "rejected" && resumeResult.status === "rejected") {
    throw accountResult.reason;
  }
  return {
    account: accountResult.status === "fulfilled" ? accountResult.value : null,
    accountError: accountResult.status === "rejected" ? accountResult.reason : null,
    learning: learningResult.status === "fulfilled" ? learningResult.value : null,
    learningError: learningResult.status === "rejected" ? learningResult.reason : null,
    resume: resumeResult.status === "fulfilled" ? resumeResult.value : null,
    resumeError: resumeResult.status === "rejected" ? resumeResult.reason : null
  };
}

export default function Dashboard({ themeSettings, activeTheme }) {
  const dashboard = useAsyncData(loadDashboard, []);

  if (dashboard.loading) return <LoadingPanel />;
  if (dashboard.error) return <ErrorPanel message={dashboard.error.message || dashboard.error} onRetry={dashboard.reload} />;

  const { account, accountError, learning, learningError, resume, resumeError } = dashboard.data;
  const resumeItems = resume?.results || [];
  const nextItem = learning?.next_item || resumeItems[0] || null;
  const stats = [
    ["Completed", learning?.completed_count ?? "—", "check", "materials"],
    ["Saved", learning?.bookmark_count ?? "—", "bookmark", "items"],
    ["Due review", Array.isArray(learning?.review_due) ? learning.review_due.length : "—", "target", "scheduled"],
    ["Sessions", account?.account?.active_sessions ?? "—", "activity", "active"]
  ];

  return (
    <Page title="Dashboard" showHeading={false}>
      <div className="dashboard-layout">
        <StatsGrid cards={stats} />
        <section className="dashboard-main">
          <div className="dashboard-left">
            <ContinueCard item={nextItem} />
            <RecentContent items={learning?.recent_content || []} />
            <ReviewQueue items={learning?.review_due || []} />
            {(accountError || learningError || resumeError) && <p className="save-hint">Some dashboard data is temporarily unavailable. You can refresh this page to try again.</p>}
          </div>
          <div className="dashboard-right">
            <DashboardHero character={themeSettings.character} theme={activeTheme} />
            <FocusTimerCard />
            <StudyTableUnavailable />
          </div>
        </section>
      </div>
    </Page>
  );
}

function ContinueCard({ item }) {
  const learningObjectId = item?.learning_object_id || item?.id;
  const title = item?.title || "No material in progress";
  const completion = Number(item?.completion_percent) || 0;
  return (
    <article className="panel continue-card">
      <p className="eyebrow">Continue studying</p>
      <h2>{title}</h2>
      {learningObjectId ? <>
        <ProgressLine value={completion} />
        <div className="progress-meta"><span>Server-saved progress</span><strong>{completion}%</strong></div>
        <Link className="btn btn-primary" to={`/materials/objects/${learningObjectId}`}>Continue</Link>
      </> : <>
        <p>Choose a published material to start building a server-saved study history.</p>
        <Link className="btn btn-primary" to="/materials">Browse materials</Link>
      </>}
    </article>
  );
}

function RecentContent({ items }) {
  return (
    <article className="panel dashboard-review-card">
      <div className="panel-title"><div><p className="eyebrow">Recent materials</p><h2>Learning activity</h2></div><span><Icon name="layers" size={16} /></span></div>
      <div className="dashboard-review-list">
        {items.length ? items.slice(0, 3).map((item) => (
          <div key={item.learning_object_id} className="dashboard-review-item">
            <span>{item.title}</span><small>{item.content_type?.toUpperCase()}</small>
          </div>
        )) : <p>No recent material activity has been returned by the server.</p>}
      </div>
      <Link className="btn btn-soft" to="/materials">Open materials</Link>
    </article>
  );
}

function ReviewQueue({ items }) {
  return (
    <article className={`panel dashboard-review-card ${items.length ? "urgent" : ""}`}>
      <div className="panel-title"><div><p className="eyebrow">Review queue</p><h2>{items.length ? `${items.length} scheduled` : "Nothing scheduled"}</h2></div><span><Icon name="target" size={16} /></span></div>
      <div className="dashboard-review-list">
        {items.length ? items.slice(0, 3).map((item) => <div key={item.question_id} className="dashboard-review-item"><span>{item.prompt}</span><small>Due {item.due_at}</small></div>) : <p>New server-assigned reviews will appear here.</p>}
      </div>
      <button className="btn btn-soft" type="button" disabled>Review workspace in a later phase</button>
    </article>
  );
}

function FocusTimerCard() {
  const [duration, setDuration] = useState(readFocusDurationPreference);
  const [secondsLeft, setSecondsLeft] = useState(duration * 60);
  const [running, setRunning] = useState(false);
  const complete = secondsLeft === 0;
  const progress = Math.round(((duration * 60 - secondsLeft) / (duration * 60)) * 100);

  useEffect(() => {
    localStorage.setItem("lock-in.focus.minutes", String(duration));
  }, [duration]);
  useEffect(() => {
    if (!running || complete) return undefined;
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running, complete]);
  useEffect(() => {
    if (complete) setRunning(false);
  }, [complete]);

  function chooseDuration(minutes) {
    setDuration(minutes);
    setSecondsLeft(minutes * 60);
    setRunning(false);
  }

  return (
    <article className={`panel focus-timer-card ${running ? "running" : ""} ${complete ? "complete" : ""}`}>
      <div className="panel-title"><div><p className="eyebrow">Focus timer</p><h2>{complete ? "Block complete" : "Deep study block"}</h2></div><span><Icon name="clock" size={16} /></span></div>
      <div className="focus-timer-face" style={{ "--timer-progress": `${progress}%` }}><strong>{formatDuration(secondsLeft)}</strong><span>{duration} min block</span></div>
      <div className="focus-duration-options" aria-label="Focus timer duration">
        {focusDurations.map((item) => <button key={item.minutes} className={duration === item.minutes ? "active" : ""} onClick={() => chooseDuration(item.minutes)} type="button" aria-pressed={duration === item.minutes}>{item.label}</button>)}
      </div>
      <div className="focus-timer-actions"><button className="btn btn-primary" onClick={() => setRunning((value) => !value)} disabled={complete}>{running ? "Pause" : "Start"}</button><button className="btn btn-soft" onClick={() => { setSecondsLeft(duration * 60); setRunning(false); }}>Reset</button></div>
      <p className="save-hint">This timer stays on this device and does not award progress, XP, or completion.</p>
    </article>
  );
}

function DashboardHero({ character, theme }) {
  const heroSrc = themePreview(character, theme);
  const characterLabel = character === "white" ? "white cat" : "black cat";
  return <article className="scene-card" aria-label="Lock-in mascot scene"><img className="scene-theme" src={heroSrc} alt={`Lock-in ${characterLabel} studying in the ${theme} theme`} /></article>;
}

function StudyTableUnavailable() {
  return (
    <article className="panel study-table-card">
      <div className="panel-title"><h2>My Study Table</h2><span>Unavailable</span></div>
      <form className="plan-form"><input type="time" aria-label="Study time" disabled /><input type="text" placeholder="Add topic" aria-label="Study topic" disabled /><button className="icon-btn" type="button" disabled aria-label="Add study item"><Icon name="plus" /></button></form>
      <EmptyState title="Study-plan editing is unavailable" text="The current Django API does not provide a study-plan endpoint, so no local schedule is fabricated." />
    </article>
  );
}
