import { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { progressionApi } from "./api";
import type {
  Achievement,
  Ranking,
  RankingProfile,
  StreakSummary,
  XpSummary
} from "./types";

type ProgressionState = {
  xp: XpSummary;
  streak: StreakSummary;
  achievements: Achievement[];
  ranking: Ranking;
  profile: RankingProfile;
};

export function ProgressionPage() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<ProgressionState | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    void Promise.all([
      progressionApi.xp(controller.signal),
      progressionApi.streak(controller.signal),
      progressionApi.achievements(controller.signal),
      progressionApi.ranking(controller.signal),
      progressionApi.rankingProfile(controller.signal)
    ])
      .then(([xp, streak, achievements, ranking, profile]) => {
        if (!controller.signal.aborted) setData({ xp, streak, achievements, ranking, profile });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  if (!data && !failed) return <PageSkeleton label={t("loadingProgression")} />;
  if (!data) {
    return (
      <Alert>
        {t("genericError")} <Button onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button>
      </Alert>
    );
  }

  const savePrivacy = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const profile = await progressionApi.saveRankingProfile({
        included: data.profile.included,
        display_mode: data.profile.display_mode
      });
      setData((current) => (current ? { ...current, profile } : current));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value)
    );

  return (
    <div className="page progression-page">
      <header className="page-heading page-heading--wide">
        <p className="eyebrow">Lock-in</p>
        <h1>{t("progressionTitle")}</h1>
        <p>{t("progressionCopy")}</p>
      </header>

      <section className="momentum-grid" aria-label={t("progressionTitle")}>
        <article className="momentum-card momentum-card--xp">
          <span>{t("learningLevel")}</span>
          <strong>{data.xp.level}</strong>
          <p>
            {data.xp.total_points.toLocaleString(locale)} {t("learningXp")}
          </p>
          <progress
            aria-label={t("levelProgress")}
            max={data.xp.level_target}
            value={data.xp.level_progress}
          />
          <small>
            {data.xp.level_progress.toLocaleString(locale)} / {data.xp.level_target.toLocaleString(locale)}
          </small>
        </article>
        <article className="momentum-card momentum-card--streak">
          <span>{t("currentStreak")}</span>
          <div>
            <strong>{data.streak.current_days}</strong>
            <b>{data.streak.current_days === 1 ? t("day") : t("days")}</b>
          </div>
          <p>{t("streakCalmCopy")}</p>
          <small>
            {t("longestStreak")}: {data.streak.longest_days.toLocaleString(locale)} {t("days")}
          </small>
        </article>
        <article className="momentum-card momentum-card--rules">
          <span>{t("whatCounts")}</span>
          <ul>
            <li>{t("lessonActivity")}</li>
            <li>{t("assessmentActivity")}</li>
            <li>{t("focusActivity")}</li>
          </ul>
        </article>
      </section>

      <section className="study-section" aria-labelledby="achievement-heading">
        <header className="study-section__heading progression-section-heading">
          <div>
            <h2 id="achievement-heading">{t("achievementJourney")}</h2>
            <p>{t("achievementJourneyCopy")}</p>
          </div>
        </header>
        <ul className="achievement-grid">
          {data.achievements.map((achievement) => {
            const complete = achievement.earned_at !== null;
            const current = Math.min(achievement.current_value, achievement.target_value);
            return (
              <li key={achievement.code} className={complete ? "is-earned" : ""}>
                <span className="achievement-mark" aria-hidden="true">
                  {complete ? "✓" : current}
                </span>
                <div>
                  <span className="achievement-state">{complete ? t("earned") : t("inProgress")}</span>
                  <h3>{achievement.title}</h3>
                  <p>{achievement.description}</p>
                  <progress
                    aria-label={`${achievement.title}: ${t("achievementProgress")}`}
                    max={achievement.target_value}
                    value={current}
                  />
                  <small>
                    {current.toLocaleString(locale)} / {achievement.target_value.toLocaleString(locale)}
                  </small>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="study-section ranking-section" aria-labelledby="ranking-heading">
        <header className="study-section__heading progression-section-heading">
          <div>
            <h2 id="ranking-heading">{t("rankingTitle")}</h2>
            <p>{t("rankingCopy")}</p>
          </div>
          {data.ranking.snapshot ? (
            <span>
              {t("rankingFreshness")}: {date(data.ranking.snapshot.generated_at)}
            </span>
          ) : null}
        </header>
        {data.ranking.snapshot ? (
          <>
            <div className="ranking-own" aria-label={t("yourPosition")}>
              <span>{t("yourPosition")}</span>
              <strong>{data.ranking.own_entry ? `#${data.ranking.own_entry.position}` : "—"}</strong>
              <small>
                {data.ranking.own_entry?.score.toLocaleString(locale) ?? 0} {t("learningXp")}
              </small>
            </div>
            <div className="ranking-table-wrap">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th scope="col">{t("position")}</th>
                    <th scope="col">{t("learner")}</th>
                    <th scope="col">{t("score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ranking.entries.map((entry, index) => (
                    <tr key={`${entry.position}-${entry.display_name}-${index}`} className={entry.is_me ? "is-me" : ""}>
                      <td data-label={t("position")}>#{entry.position}</td>
                      <th data-label={t("learner")} scope="row">{entry.display_name}</th>
                      <td data-label={t("score")}>{entry.score.toLocaleString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="ranking-rules">
              <summary>{t("rankingRules")}</summary>
              <p>
                {typeof data.ranking.definition?.rules.summary === "string"
                  ? data.ranking.definition.rules.summary
                  : t("rankingCopy")}
              </p>
            </details>
          </>
        ) : (
          <EmptyState title={t("rankingNotReady")}>{t("rankingCopy")}</EmptyState>
        )}

        <form
          className="ranking-privacy"
          onSubmit={(event) => {
            event.preventDefault();
            void savePrivacy();
          }}
        >
          <h3>{t("rankingPrivacy")}</h3>
          <label className="choice-row">
            <input
              type="checkbox"
              checked={data.profile.included}
              onChange={(event) =>
                setData((current) =>
                  current
                    ? { ...current, profile: { ...current.profile, included: event.target.checked } }
                    : current
                )
              }
            />
            <span>{t("rankingIncluded")}</span>
          </label>
          <label className="privacy-select">
            <span>{t("displayName")}</span>
            <select
              value={data.profile.display_mode}
              onChange={(event) =>
                setData((current) =>
                  current
                    ? {
                        ...current,
                        profile: {
                          ...current.profile,
                          display_mode: event.target.value as RankingProfile["display_mode"]
                        }
                      }
                    : current
                )
              }
            >
              <option value="full_name">{t("fullName")}</option>
              <option value="initials">{t("initials")}</option>
              <option value="anonymous">{t("anonymous")}</option>
            </select>
          </label>
          <div className="form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? t("saving") : t("savePrivacy")}
            </Button>
            {saved ? <span className="inline-success" role="status">{t("privacySaved")}</span> : null}
          </div>
        </form>
      </section>
    </div>
  );
}
