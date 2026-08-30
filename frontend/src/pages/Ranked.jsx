import { useEffect, useState } from "react";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { formatDateTime, formatNumber } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";

async function loadRanked() {
  const [ranking, profile] = await Promise.all([
    motivationApi.currentRanking(),
    motivationApi.rankingProfile()
  ]);
  return { ranking, profile };
}

function snapshotLabel(snapshot, t) {
  if (!snapshot?.generated_at) return t("ranked.noSnapshot");
  const formatted = formatDateTime(snapshot.generated_at);
  return formatted === "—" ? t("ranked.publishedSnapshot") : t("ranked.updatedOn", { date: formatted });
}

export default function Ranked() {
  const { t } = useI18n();
  const ranked = useAsyncData(loadRanked, []);
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (ranked.data?.profile) setProfile(ranked.data.profile);
  }, [ranked.data]);

  if (ranked.loading) return <LoadingPanel />;
  if (ranked.error) return <ErrorPanel message={ranked.error} onRetry={ranked.reload} />;

  const { ranking } = ranked.data;
  const definition = ranking.definition;
  const ownEntry = ranking.own_entry;

  async function saveProfile(event) {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSaveError("");
    try {
      const updated = await motivationApi.updateRankingProfile({
        included: profile.included === true,
        displayMode: profile.display_mode
      });
      setProfile(updated);
      ranked.reload();
    } catch (error) {
      setSaveError(error.message || t("ranked.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Ranked" subtitle={t("ranked.subtitle")}>
      <section className="ranked-hero">
        <div>
          <p className="eyebrow">{t("ranked.currentRanking")}</p>
          <h2 dir="auto">{definition?.title || t("ranked.noRankingPublished")}</h2>
          <p dir="auto">{definition ? `${definition.period?.replaceAll("_", " ") || t("ranked.current")} · ${definition.tie_strategy || t("ranked.rankingRules")}` : t("ranked.noSnapshotYet")}</p>
          {ranking.snapshot && <span className="pill success" dir="auto"><Icon name="trophy" size={16} /> {snapshotLabel(ranking.snapshot, t)}</span>}
        </div>
        <div className="rank-user-card">
          <span>{t("ranked.yourRank")}</span>
          <strong dir="auto">{ownEntry ? `#${ownEntry.position}` : "—"}</strong>
          <p dir="auto">{ownEntry ? t("ranked.pointsEvidence", { points: formatNumber(ownEntry.score || 0), evidence: formatNumber(ownEntry.evidence_count || 0) }) : t("ranked.noPosition")}</p>
        </div>
      </section>

      <section className="dashboard-main">
        <Leaderboard entries={Array.isArray(ranking.entries) ? ranking.entries : []} />
        <article className="settings-panel">
          <div className="panel-title"><div><p className="eyebrow">{t("ranked.privacy")}</p><h2>{t("ranked.visibility")}</h2></div><span><Icon name="eye" size={16} /></span></div>
          {saveError && <ErrorPanel message={saveError} />}
          {profile && <form className="password-form" onSubmit={saveProfile}>
            <label className="form-row"><span>{t("ranked.includeScore")}</span><input type="checkbox" checked={profile.included === true} onChange={(event) => setProfile((current) => ({ ...current, included: event.target.checked }))} /></label>
            <label className="field"><span>{t("ranked.howOthersSee")}</span><select value={profile.display_mode || "initials"} onChange={(event) => setProfile((current) => ({ ...current, display_mode: event.target.value }))}><option value="full_name">{t("ranked.fullName")}</option><option value="initials">{t("ranked.initials")}</option><option value="anonymous">{t("ranked.anonymous")}</option></select></label>
            <button className="btn btn-primary" type="submit" disabled={saving}>{t(saving ? "profile.saving" : "ranked.saveVisibility")}</button>
          </form>}
        </article>
      </section>
    </Page>
  );
}

function Leaderboard({ entries }) {
  const { t } = useI18n();
  return (
    <article className="panel leaderboard-card">
      <div className="panel-title"><div><p className="eyebrow">{t("ranked.publishedEntries")}</p><h2>{t("ranked.leaderboard")}</h2></div><span><Icon name="medal" size={16} /></span></div>
      {!entries.length ? <EmptyState title={t("ranked.noEntriesTitle")} text={t("ranked.noEntriesText")} /> : (
        <div className="rank-list">
          {entries.map((entry) => (
            <div className="rank-row" key={`${entry.position}-${entry.display_name}`}>
              <span className="rank-place">{entry.position}</span>
              <div><strong dir="auto">{entry.display_name}</strong><small dir="auto">{entry.is_me ? t("ranked.you") : t("ranked.evidenceItems", { count: entry.evidence_count || 0 })}</small></div>
              <p dir="auto">{formatNumber(entry.score || 0)}<b> {t("ranked.pts")}</b></p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
