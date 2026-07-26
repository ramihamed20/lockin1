import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";

function earnedLabel(value) {
  if (!value) return "In progress";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Earned" : `Earned ${date.toLocaleDateString()}`;
}

export default function Achievements() {
  const achievements = useAsyncData(() => motivationApi.achievements(), []);
  if (achievements.loading) return <LoadingPanel />;
  if (achievements.error) return <ErrorPanel message={achievements.error} onRetry={achievements.reload} />;

  const unlocked = achievements.data.filter((achievement) => Boolean(achievement.earned_at));
  const completion = achievements.data.length ? Math.round((unlocked.length / achievements.data.length) * 100) : 0;

  return (
    <Page title="Achievements" subtitle="Django records your achievement progress and earned badges.">
      <section className="achievement-hero">
        <div>
          <p className="eyebrow">Badge Room</p>
          <h2>{unlocked.length}/{achievements.data.length} unlocked</h2>
          <p>Every value here comes from the server achievement catalog.</p>
        </div>
        <div className="achievement-ring">{completion}%</div>
      </section>
      {!achievements.data.length ? <EmptyState title="No achievements available" text="Django has not published an active achievement catalog for this account." /> : (
        <section className="achievement-grid">
          {achievements.data.map((achievement) => {
            const current = Number(achievement.current_value) || 0;
            const target = Number(achievement.target_value) || 0;
            const isUnlocked = Boolean(achievement.earned_at);
            const progress = target > 0 ? Math.round((current / target) * 100) : 0;
            return (
              <article className={`achievement-card ${isUnlocked ? "unlocked" : "locked"}`} key={achievement.code}>
                <div className="achievement-card-head">
                  <span className="stat-icon"><Icon name={achievement.icon_key || "award"} /></span>
                  {!isUnlocked && <span className="lock-pill"><Icon name="lock" size={14} /> Locked</span>}
                </div>
                <div><h2>{achievement.title}</h2><p>{achievement.description}</p></div>
                <ProgressLine value={progress} />
                <small>{earnedLabel(achievement.earned_at)} · {current}/{target}</small>
              </article>
            );
          })}
        </section>
      )}
    </Page>
  );
}
