import { Link, useLocation } from "react-router-dom";
import { dashboardApi } from "../api/learning.js";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { themePreview } from "../lib/utils.js";
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
  const dashboardCards = stats.map(([label, value, icon, sub]) => ({
    label,
    value,
    icon,
    sub,
    ...{
      Completed: {
        to: "/materials",
        actionLabel: "Open completed materials",
        variant: "emerald",
        badge: "Done",
        pulse: false
      },
      Saved: {
        to: "/bookmarks",
        actionLabel: "Open saved items",
        variant: "indigo",
        badge: "Saved",
        pulse: false
      },
      "Due review": {
        to: "/review",
        actionLabel: "Open due reviews",
        variant: "rose",
        badge: Array.isArray(learning?.review_due) && learning.review_due.length > 0 ? "Action Due" : "Ready",
        pulse: Array.isArray(learning?.review_due) && learning.review_due.length > 0
      },
      Sessions: {
        to: "/security",
        actionLabel: "Open active account sessions",
        variant: "amber",
        badge: "Live",
        pulse: true
      }
    }[label]
  }));


  return (
    <Page title="Dashboard" showHeading={false}>
      <div className="dashboard-layout">
        <StatsGrid cards={dashboardCards} className="dashboard-stats-grid" />
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

function reviewTiming(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return { label: "Scheduled", tone: "scheduled", icon: "calendar" };
  const minutes = Math.ceil((timestamp - Date.now()) / 60000);
  if (minutes <= 0) return { label: "Due now", tone: "due", icon: "flame" };
  if (minutes <= 60) return { label: `In ${minutes} min`, tone: "soon", icon: "clock" };
  if (minutes <= 24 * 60) return { label: "Due today", tone: "soon", icon: "clock" };
  return { label: `Due ${new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, tone: "scheduled", icon: "calendar" };
}

function ReviewQueue({ items }) {
  const visibleItems = items.slice(0, 3);
  return (
    <article className={`panel dashboard-review-card dashboard-review-queue ${items.length ? "urgent" : ""}`}>
      <header className="review-queue-header">
        <div className="review-queue-title"><span><Icon name="target" size={18} /></span><div><p className="eyebrow">Review queue</p><h2>{items.length ? "Ready for review" : "All caught up"}</h2></div></div>
        <span className={`review-queue-count ${items.length ? "has-items" : ""}`}><strong>{items.length}</strong><small>{items.length === 1 ? "item" : "items"}</small></span>
      </header>
      {items.length ? <>
        <p className="review-queue-lede">A quick review now helps keep each topic fresh.</p>
        <div className="review-queue-list">
          {visibleItems.map((item) => {
            const timing = reviewTiming(item.due_at);
            return <div key={item.question_id} className={`review-queue-item review-queue-item--${timing.tone}`}>
              <span className="review-queue-item-icon"><Icon name={timing.icon} size={16} /></span>
              <div><h3>{item.prompt || "Scheduled review question"}</h3><p>{item.academic_node_title || item.difficulty || "Server-assigned review"}</p></div>
              <span className="review-queue-due">{timing.label}</span>
            </div>;
          })}
        </div>
        <Link className="btn btn-soft compact" to="/review">Open Review Center <Icon name="arrow-up-right" size={15} /></Link>
      </> : <div className="review-queue-empty"><span><Icon name="check" size={18} /></span><div><h3>No reviews waiting</h3><p>New server-assigned reviews will appear here when they are ready.</p></div></div>}
    </article>
  );
}

function FocusTimerCard() {
  const location = useLocation();
  const returnState = { returnTo: location.pathname, scrollY: window.scrollY };

  return (
    <article className="panel focus-timer-card">
      <div className="panel-title"><div><p className="eyebrow">Focus session</p><h2>Ready to lock in?</h2></div><span><Icon name="clock" size={16} /></span></div>
      <div className="focus-timer-face"><strong>Lock In</strong><span>Saved securely to your study history</span></div>
      <div className="focus-timer-actions"><Link className="btn btn-primary" to="/lock-in" state={returnState}><Icon name="expand" size={16} /> Enter Lock In Mode</Link></div>
      <p className="save-hint">This entry does not award progress, XP, or completion by itself. The dedicated session calculates progress on Django, not this device.</p>
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
