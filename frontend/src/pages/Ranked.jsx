import { useEffect, useState } from "react";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";

async function loadRanked() {
  const [ranking, profile] = await Promise.all([
    motivationApi.currentRanking(),
    motivationApi.rankingProfile()
  ]);
  return { ranking, profile };
}

function snapshotLabel(snapshot) {
  if (!snapshot?.generated_at) return "No published snapshot";
  const date = new Date(snapshot.generated_at);
  return Number.isNaN(date.getTime()) ? "Published snapshot" : `Updated ${date.toLocaleString()}`;
}

export default function Ranked() {
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
      setSaveError(error.message || "Ranking privacy could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Ranked" subtitle="Django-published learning rankings and your server-saved privacy choice.">
      <section className="ranked-hero">
        <div>
          <p className="eyebrow">Current ranking</p>
          <h2>{definition?.title || "No ranking published"}</h2>
          <p>{definition ? `${definition.period?.replaceAll("_", " ") || "Current"} · ${definition.tie_strategy || "server ranking rules"}` : "Django has not published a ranking snapshot for this definition yet."}</p>
          {ranking.snapshot && <span className="pill success"><Icon name="trophy" size={16} /> {snapshotLabel(ranking.snapshot)}</span>}
        </div>
        <div className="rank-user-card">
          <span>Your Rank</span>
          <strong>{ownEntry ? `#${ownEntry.position}` : "—"}</strong>
          <p>{ownEntry ? `${Number(ownEntry.score || 0).toLocaleString()} points · ${ownEntry.evidence_count || 0} evidence items` : "No position in this snapshot"}</p>
        </div>
      </section>

      <section className="dashboard-main">
        <Leaderboard entries={Array.isArray(ranking.entries) ? ranking.entries : []} />
        <article className="settings-panel">
          <div className="panel-title"><div><p className="eyebrow">Ranking privacy</p><h2>Visibility</h2></div><span><Icon name="eye" size={16} /></span></div>
          {saveError && <ErrorPanel message={saveError} />}
          {profile && <form className="password-form" onSubmit={saveProfile}>
            <label className="form-row"><span>Include my server score</span><input type="checkbox" checked={profile.included === true} onChange={(event) => setProfile((current) => ({ ...current, included: event.target.checked }))} /></label>
            <label className="field"><span>How others see me</span><select value={profile.display_mode || "initials"} onChange={(event) => setProfile((current) => ({ ...current, display_mode: event.target.value }))}><option value="full_name">Full name</option><option value="initials">Initials</option><option value="anonymous">Anonymous learner</option></select></label>
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save visibility"}</button>
          </form>}
        </article>
      </section>
    </Page>
  );
}

function Leaderboard({ entries }) {
  return (
    <article className="panel leaderboard-card">
      <div className="panel-title"><div><p className="eyebrow">Published entries</p><h2>Leaderboard</h2></div><span><Icon name="medal" size={16} /></span></div>
      {!entries.length ? <EmptyState title="No published entries" text="Django has not published participant entries for this ranking yet." /> : (
        <div className="rank-list">
          {entries.map((entry) => (
            <div className="rank-row" key={`${entry.position}-${entry.display_name}`}>
              <span className="rank-place">{entry.position}</span>
              <div><strong>{entry.display_name}</strong><small>{entry.is_me ? "You" : `${entry.evidence_count || 0} evidence items`}</small></div>
              <p>{Number(entry.score || 0).toLocaleString()}<b> pts</b></p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
