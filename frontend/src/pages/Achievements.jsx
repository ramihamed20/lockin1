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
  if (achievements.loading) return <Page width="reading" title="Achievements" showHeading><LoadingPanel variant="list" /></Page>;
  if (achievements.error) return <Page width="reading" title="Achievements" showHeading><ErrorPanel message={achievements.error} onRetry={achievements.reload} /></Page>;

  const unlocked = achievements.data.filter((achievement) => Boolean(achievement.earned_at));

  // The count is the headline's subtitle, not a second hero: the list is the
  // page, one row per achievement with its own progress.
  return (
    <Page width="reading" title="Achievements" subtitle={achievements.data.length ? t("achievements.unlockedOf", { unlocked: unlocked.length, total: achievements.data.length }) : ""} showHeading>
      {!achievements.data.length ? <EmptyState icon="achievement" title={t("achievements.emptyTitle")} text={t("achievements.emptyText")} /> : (
        <ul className="ui-group achievements-v2">
          {achievements.data.map((achievement) => {
            const current = Number(achievement.current_value) || 0;
            const target = Number(achievement.target_value) || 0;
            const isUnlocked = Boolean(achievement.earned_at);
            const progress = target > 0 ? Math.round((current / target) * 100) : 0;
            return (
              <li key={achievement.code}>
                <article className={`ui-row achievements-v2-row ${isUnlocked ? "is-unlocked" : "is-locked"}`}>
                  <span className="ui-row-icon"><Icon name={isUnlocked ? (achievement.icon_key || "award") : "lock"} size={17} /></span>
                  <span className="ui-row-body">
                    <strong dir="auto">{achievement.title}</strong>
                    <small dir="auto">{achievement.description}</small>
                    {!isUnlocked && <ProgressLine value={progress} />}
                  </span>
                  <span className="ui-row-value" dir="auto">{isUnlocked ? earnedLabel(achievement.earned_at, t) : `${current}/${target}`}</span>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
