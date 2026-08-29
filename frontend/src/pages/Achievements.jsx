import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";
import { formatDate } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";

function earnedLabel(value, t) {
  if (!value) return t("achievements.inProgress");
  const formatted = formatDate(value);
  return formatted === "—" ? t("achievements.earned") : t("achievements.earnedOn", { date: formatted });
}

export default function Achievements() {
  const { t } = useI18n();
  const achievements = useAsyncData(() => motivationApi.achievements(), []);
  if (achievements.loading) return <LoadingPanel />;
  if (achievements.error) return <ErrorPanel message={achievements.error} onRetry={achievements.reload} />;

  const unlocked = achievements.data.filter((achievement) => Boolean(achievement.earned_at));
  const completion = achievements.data.length ? Math.round((unlocked.length / achievements.data.length) * 100) : 0;

  return (
    <Page title="Achievements" subtitle={t("achievements.subtitle")}>
      <section className="achievement-hero">
        <div>
          <p className="eyebrow">{t("achievements.badgeRoom")}</p>
          <h2 dir="auto">{t("achievements.unlockedOf", { unlocked: unlocked.length, total: achievements.data.length })}</h2>
          <p>{t("achievements.sourceNote")}</p>
        </div>
        <div className="achievement-ring">{completion}%</div>
      </section>
      {!achievements.data.length ? <EmptyState title={t("achievements.emptyTitle")} text={t("achievements.emptyText")} /> : (
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
                  {!isUnlocked && <span className="lock-pill"><Icon name="lock" size={14} /> {t("achievements.locked")}</span>}
                </div>
                <div><h2 dir="auto">{achievement.title}</h2><p dir="auto">{achievement.description}</p></div>
                <ProgressLine value={progress} />
                <small dir="auto">{earnedLabel(achievement.earned_at, t)} · {current}/{target}</small>
              </article>
            );
          })}
        </section>
      )}
    </Page>
  );
}
