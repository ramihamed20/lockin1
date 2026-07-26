import { useState } from "react";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, MiniFeature, Page, ProgressLine } from "../components/ui/index.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";

function dateLabel(value) {
  if (!value) return "No server award recorded yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Server award recorded" : date.toLocaleString();
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
  const progression = useAsyncData(() => loadProgression(page), [page]);
  if (progression.loading) return <LoadingPanel />;
  if (progression.error) return <ErrorPanel message={progression.error} onRetry={progression.reload} />;

  const { xp, ledger, streak } = progression.data;
  const levelProgress = Number(xp.level_target) > 0
    ? Math.round((Number(xp.level_progress) / Number(xp.level_target)) * 100)
    : 0;
  const currentDays = Number(streak.current_days) || 0;
  const longestDays = Number(streak.longest_days) || 0;

  return (
    <Page title="Progress" subtitle="Your server-recorded XP, streak policy, and award history.">
      <section className="progress-hero">
        <div className="progress-hero-main">
          <p className="eyebrow">My Progress</p>
          <div className="progress-hero-level-badge">
            <span className="level-label">Level</span>
            <span className="level-number">{xp.level ?? 1}</span>
          </div>
        </div>
        <div className="progress-hero-meter" style={{ "--progress-xp": `${levelProgress}%` }}>
          <span>XP Progress</span>
          <strong>{levelProgress}%</strong>
          <small>{xp.level_progress ?? 0}/{xp.level_target ?? 0} XP in this level</small>
        </div>
      </section>

      <section className="progress-insight-grid">
        <MiniFeature title="Total XP" text={`${Number(xp.total_points || 0).toLocaleString()} server-awarded points across ${xp.transaction_count ?? 0} ledger entries.`} icon="award" />
        <MiniFeature title="Current streak" text={`${currentDays} day${currentDays === 1 ? "" : "s"}; personal best ${longestDays} day${longestDays === 1 ? "" : "s"}.`} icon="flame" />
        <MiniFeature title="Streak policy" text={`${streak.policy?.title || "Current policy"} · ${streak.policy?.grace_days ?? 0} grace day${Number(streak.policy?.grace_days) === 1 ? "" : "s"}.`} icon="calendar" />
      </section>

      <section className="dashboard-main">
        <article className="panel dashboard-review-card">
          <div className="panel-title"><div><p className="eyebrow">XP ledger</p><h2>Server award history</h2></div><span><Icon name="activity" size={16} /></span></div>
          <div className="dashboard-review-list">
            {ledger.results.length ? ledger.results.map((entry) => (
              <div className="dashboard-review-item" key={entry.id}>
                <span>{entry.reason || entry.category || "Server XP award"}</span>
                <small>{Number(entry.points || 0) >= 0 ? "+" : ""}{entry.points ?? 0} XP · {dateLabel(entry.occurred_at)}</small>
              </div>
            )) : <p>No XP awards have been recorded yet.</p>}
          </div>
          <PaginationControls page={page} pageData={ledger} onPageChange={setPage} label="XP-ledger pages" />
        </article>

        <article className="panel dashboard-review-card">
          <div className="panel-title"><div><p className="eyebrow">Streak policy</p><h2>{streak.policy?.title || "Current policy"}</h2></div><span><Icon name="flame" size={16} /></span></div>
          <div className="dashboard-review-list">
            <p>Qualifying activity: {Array.isArray(streak.policy?.qualifying_activity_types) && streak.policy.qualifying_activity_types.length ? streak.policy.qualifying_activity_types.join(", ") : "Defined by Django"}.</p>
            <p>Last qualified: {streak.last_qualified_on || "No qualifying activity recorded yet."}</p>
            <p>Freeze tokens available: {streak.freeze_tokens_available ?? 0}. Django provides no endpoint to consume one, so this interface cannot change that number.</p>
          </div>
        </article>
      </section>
    </Page>
  );
}
