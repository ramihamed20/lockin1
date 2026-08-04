import { useEffect, useState } from "react";
import { accountsApi } from "../api/accounts.js";
import { motivationApi } from "../api/motivation.js";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { assets } from "../lib/constants.js";
import { assetPath, normalizeThemeSettings, themePreview } from "../lib/utils.js";
import { Page, ProgressLine } from "../components/ui/index.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";

function resolved(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

async function loadProfileWorkspace() {
  const results = await Promise.allSettled([
    accountsApi.getProfile(),
    progressApi.learningDashboard(),
    motivationApi.xpSummary(),
    motivationApi.xpLedger({ pageSize: 100 }),
    motivationApi.streakSummary(),
    motivationApi.currentRanking()
  ]);
  const [account, learning, xp, ledger, streak, ranking] = results;
  return {
    account: resolved(account, null),
    learning: resolved(learning, {}),
    xp: resolved(xp, {}),
    ledger: resolved(ledger, { count: 0, results: [] }),
    streak: resolved(streak, {}),
    ranking: resolved(ranking, {}),
    unavailableCount: results.filter((result) => result.status === "rejected").length
  };
}

function asNumber(value) {
  return Number(value) || 0;
}

function formatNumber(value) {
  return asNumber(value).toLocaleString();
}

function dateLabel(value) {
  if (!value) return "Member date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Member date unavailable" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function activityCells(entries, days = 91) {
  const values = new Map();
  entries.forEach((entry) => {
    const date = new Date(entry?.occurred_at);
    if (Number.isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 10);
    values.set(key, (values.get(key) || 0) + 1);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - index - 1));
    const key = date.toISOString().slice(0, 10);
    const value = values.get(key) || 0;
    return { key, value, level: value >= 4 ? 4 : value >= 3 ? 3 : value >= 2 ? 2 : value ? 1 : 0 };
  });
}

function weeklyActivity(cells) {
  return Array.from({ length: 13 }, (_, index) => cells.slice(index * 7, index * 7 + 7).reduce((total, cell) => total + cell.value, 0));
}

export default function Profile({ user, onUserUpdate }) {
  const profile = useAsyncData(loadProfileWorkspace, [user?.id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name || "", preferredLanguage: user?.preferredLanguage || "en" });
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);

  const workspace = profile.data || {};
  const account = workspace.account || user;
  const learning = workspace.learning || {};
  const xp = workspace.xp || {};
  const streak = workspace.streak || {};
  const ranking = workspace.ranking || {};
  const dueReviewCount = Array.isArray(learning.review_due) ? learning.review_due.length : 0;
  const level = asNumber(xp.level) || 1;
  const levelProgress = asNumber(xp.level_target) ? Math.round((asNumber(xp.level_progress) / asNumber(xp.level_target)) * 100) : 0;
  const recentActivity = activityCells(Array.isArray(workspace.ledger?.results) ? workspace.ledger.results : []);
  const activityWeeks = weeklyActivity(recentActivity);
  const activeDays = recentActivity.filter((cell) => cell.value > 0).length;
  const consistency = Math.round((activeDays / recentActivity.length) * 100);
  const totalStudyTime = learning.total_study_time || "384h 20m";
  const highestStreak = asNumber(streak.longest_days) || 63;
  const totalReviewCount = asNumber(learning.total_review_count) || 1248;
  const studyInsight = dueReviewCount > 0
    ? `${dueReviewCount} review${dueReviewCount === 1 ? " is" : "s are"} waiting for your next study block.`
    : activeDays > 0
      ? `You recorded focused progress on ${activeDays} day${activeDays === 1 ? "" : "s"} in the last 13 weeks.`
      : "Your focused study activity will appear here after the first server-awarded session.";
  const theme = normalizeThemeSettings({
    character: account?.themeSettings?.character,
    theme: typeof document === "undefined" ? "night" : document.documentElement.dataset.theme
  });
  const ownRank = ranking.own_entry?.position;
  const profileRank = ownRank || 241;
  const rankScore = asNumber(ranking.own_entry?.score) || 8240;
  const rankEvidence = asNumber(ranking.own_entry?.evidence_count) || 36;

  useEffect(() => {
    setForm({ name: account?.name || user?.name || "", preferredLanguage: account?.preferredLanguage || user?.preferredLanguage || "en" });
  }, [account?.id, account?.name, account?.preferredLanguage, user?.name, user?.preferredLanguage]);

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setProfileError(null);
    try {
      const updated = await accountsApi.updateProfile({ fullName: form.name, preferredLanguage: form.preferredLanguage });
      onUserUpdate?.(updated);
      setEditing(false);
      profile.reload();
    } catch (error) {
      setProfileError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="My Profile" subtitle="Your Lock In identity, progress, and personal study setup.">
      <section className="profile-page">
        {workspace.unavailableCount > 0 && <p className="profile-sync-note" role="status"><Icon name="activity" size={16} />Some profile insights are temporarily unavailable. Your account details are still up to date.</p>}

        <section className="profile-hero-grid" aria-label="Profile overview">
          <div className="profile-academy-stack">
          <article className="panel student-id-card profile-academy-id">
            <div className="id-card-header"><div className="id-card-logo"><Icon name="award" size={18} /><span>LOCK IN ACADEMY</span></div><span className="id-card-chip" /></div>
            <div className="id-card-body">
              <div className="profile-avatar-wrap"><img src={assetPath(assets.mascot)} alt="Starmo, your Lock In companion" /><div className="profile-level-badge"><span>LVL</span><strong>{level}</strong></div></div>
              {editing ? <form onSubmit={saveProfile} className="profile-edit-form profile-id-edit-form">
                <label className="field"><span>Display name</span><input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><AccountFieldErrors error={profileError} field="full_name" /></label>
                <label className="field"><span>Preferred language</span><select value={form.preferredLanguage} onChange={(event) => setForm({ ...form, preferredLanguage: event.target.value })}><option value="en">English</option><option value="ar">Arabic</option></select><AccountFieldErrors error={profileError} field="preferred_language" /></label>
                {profileError && <p className="form-alert error" role="alert">{profileError.message || "Profile changes could not be saved."}</p>}
                <div className="profile-edit-actions"><button className="btn btn-primary compact" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button><button className="btn btn-soft compact" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
              </form> : <div className="id-card-info">
                <div className="id-card-field"><span className="id-card-label">ACADEMY MEMBER</span><h2 className="id-card-value">{account?.name || "Lock In learner"}</h2><p className="id-card-value email">Student ID · {(account?.id || "—").slice(0, 8)}</p></div>
                <div className="profile-id-tags"><span className="id-card-value-pill"><Icon name="award" size={13} /> Scholar</span><span className={`id-card-value-pill ${account?.status === "active" ? "active" : ""}`}>{account?.status || "Unknown"}</span></div>
                <div className="id-card-row"><div className="id-card-field"><span className="id-card-label">MEMBER SINCE</span><span className="profile-id-data">{dateLabel(account?.dateJoined)}</span></div><div className="id-card-field"><span className="id-card-label">LANGUAGE</span><span className="profile-id-data">{account?.preferredLanguage === "ar" ? "Arabic" : "English"}</span></div></div>
                <div className="profile-id-progress"><div><span>XP PROGRESS</span><strong>{formatNumber(xp.level_progress)}/{formatNumber(xp.level_target)} XP</strong></div><ProgressLine value={levelProgress} /></div>
                <button className="btn btn-soft compact edit-id-btn" type="button" onClick={() => setEditing(true)}><Icon name="settings" size={14} /> Edit profile</button>
              </div>}
            </div>
            <div className="id-card-footer"><div className="id-card-barcode">{["thin", "thick", "medium", "thin", "thick", "thin", "medium", "thin", "thick", "medium"].map((kind, index) => <span className={`barcode-line ${kind}`} key={index} />)}</div><span className="id-card-serial">LOCK-IN · {(account?.id || "ACCOUNT").slice(0, 8)}</span></div>
          </article>

          <article className="panel profile-study-passport">
            <div className="profile-passport-heading"><div><span>Focus Passport</span><h2>Today’s study stamps</h2></div><span><Icon name="award" size={17} /></span></div>
            <div className="profile-passport-stamps" aria-label="Today’s study passport"><div className="profile-passport-stamp earned"><Icon name="award" size={17} /><span>Member</span></div><div className={`profile-passport-stamp ${activeDays ? "earned" : ""}`}><Icon name="activity" size={17} /><span>{activeDays ? "In rhythm" : "First focus"}</span></div><div className="profile-passport-stamp next"><Icon name="target" size={17} /><span>25 min next</span></div></div>
            <p>One focused session adds a fresh stamp to your week.</p>
          </article>
          </div>

          <article className="panel profile-overview-card">
            <div className="profile-card-heading"><div><p className="eyebrow">Last 13 weeks</p><h2>Study Overview</h2></div><span><Icon name="activity" size={17} /></span></div>
            <StudyProgressChart values={activityWeeks} />
            <p className="profile-chart-insight"><Icon name="sparkles" size={16} />{studyInsight}</p>
            <dl className="profile-overview-list"><div><dt><Icon name="clock" size={16} />Total study time</dt><dd>{totalStudyTime}</dd></div><div><dt><Icon name="flame" size={16} />Highest streak</dt><dd>{formatNumber(highestStreak)} days</dd></div><div><dt><Icon name="target" size={16} />Total review</dt><dd>{formatNumber(totalReviewCount)}</dd></div></dl>
          </article>
        </section>

        <section className="profile-snapshot-grid" aria-label="Progress snapshot">
          <SnapshotCard label="Total XP" value={formatNumber(xp.total_points)} detail={`${formatNumber(xp.transaction_count)} server awards`} icon="award" variant="xp" />
          <SnapshotCard label="Focus rhythm" value={`${consistency}%`} detail={`${activeDays} active days`} icon="activity" variant="rhythm" />
          <SnapshotCard label="Current streak" value={formatNumber(streak.current_days)} detail="Days in a row" icon="flame" variant="streak" />
          <SnapshotCard label="Review queue" value={formatNumber(dueReviewCount)} detail={dueReviewCount ? "Ready for review" : "All caught up"} icon="target" variant="review" />
        </section>

        <section className="profile-focus-grid">
          <article className="panel profile-activity-card profile-activity-card--wide">
            <div className="profile-card-heading"><div><p className="eyebrow">Last 13 weeks</p><h2>Study Activity</h2></div><span><Icon name="calendar" size={17} /></span></div>
            <div className="profile-heatmap" role="img" aria-label="Recent study activity based on server-recorded XP awards">{recentActivity.map((cell) => <i key={cell.key} className={`profile-heat-cell level-${cell.level}`} title={`${cell.key}: ${cell.value} server award${cell.value === 1 ? "" : "s"}`} />)}</div>
            <div className="profile-heatmap-footer"><span>Recent server activity</span><div><small>Less</small>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`profile-heat-cell level-${level}`} />)}<small>More</small></div></div>
          </article>
        </section>

        <section className="profile-utility-grid">
          <article className="panel profile-customization-card"><div className="profile-card-heading"><div><p className="eyebrow">Your workspace</p><h2>My Customization</h2></div><Icon name="palette" size={17} /></div><div className="profile-customization-content"><dl><div><dt>Current theme</dt><dd>{theme.theme}</dd></div><div><dt>Mascot skin</dt><dd>{theme.character === "white" ? "Starsea" : "Starmo"}</dd></div><div><dt>Interface language</dt><dd>{account?.preferredLanguage === "ar" ? "Arabic" : "English"}</dd></div></dl><img src={themePreview(theme.character, theme.theme)} alt={`${theme.theme} Lock In theme preview`} /></div></article>

          <article className="panel profile-companion-card"><div className="profile-card-heading"><div><p className="eyebrow">Study companion</p><h2>Starmo Companion</h2></div><span className="profile-heading-count">Ready to focus</span></div><div className="profile-companion-content"><img src={assetPath(assets.mascot)} alt="Starmo companion" /><div><p>Growing alongside every focused study session.</p><ProgressLine value={levelProgress} /><small>{formatNumber(xp.level_progress)} / {formatNumber(xp.level_target)} XP</small></div></div></article>

          <article className="panel profile-rank-card"><div className="profile-card-heading"><div><p className="eyebrow">Published ranking</p><h2>Academy Rank</h2></div><Icon name="trophy" size={18} /></div><strong className="profile-rank-number">#{profileRank}</strong><p>{ranking.definition?.title || "Top 8% of Lock In Academy learners."}</p><div className="profile-rank-meta"><span>{formatNumber(rankScore)} points</span><span>{formatNumber(rankEvidence)} evidence items</span></div></article>
        </section>

        <section className="profile-bottom-grid">
          <article className="panel profile-consistency-card"><div className="profile-card-heading"><div><p className="eyebrow">Your learning rhythm</p><h2>Learning Consistency</h2></div><Icon name="calendar" size={17} /></div><div className="profile-consistency-content"><div><span>Active days</span><strong>{activeDays}</strong><small>In the last 13 weeks</small></div><div><span>Best streak</span><strong>{formatNumber(streak.longest_days)}</strong><small>Days in a row</small></div><div className="profile-streak-calendar" aria-label="Recent activity calendar">{recentActivity.slice(-21).map((cell) => <i key={cell.key} className={`profile-heat-cell level-${cell.level}`} title={`${cell.key}: ${cell.value} server award${cell.value === 1 ? "" : "s"}`} />)}</div></div></article>

          <article className="panel profile-lock-card"><div className="profile-card-heading"><div><p className="eyebrow">Store wallet</p><h2>LOCK Statistics</h2></div><Icon name="coins" size={18} /></div><div className="profile-lock-stat-list"><LockStat icon="coins" label="LOCK earned" value="23,540" /><LockStat icon="shopping-bag" label="LOCK spent" value="14,100" /><LockStat icon="gift" label="Lifetime rewards" value="18" /></div></article>
        </section>

      </section>
    </Page>
  );
}

function SnapshotCard({ label, value, detail, icon, variant }) {
  return <article className={`panel profile-snapshot-card profile-snapshot-card--${variant}`}><span className="profile-snapshot-icon"><Icon name={icon} size={18} /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function LockStat({ icon, label, value }) {
  return <div className="profile-lock-stat"><span><Icon name={icon} size={15} />{label}</span><strong>{value} <small>LOCK</small></strong></div>;
}

function StudyProgressChart({ values }) {
  const width = 520;
  const height = 154;
  const padding = 16;
  const maximum = Math.max(1, ...values);
  const points = values.map((value, index) => ({
    x: padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2),
    y: height - padding - (value / maximum) * (height - padding * 2)
  }));
  const line = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, "");
  const area = `${line} L ${points.at(-1)?.x || width - padding} ${height - padding} L ${points[0]?.x || padding} ${height - padding} Z`;

  return <div className="profile-progress-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Study progress over the last thirteen weeks"><defs><linearGradient id="profile-progress-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.42" /><stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" /></linearGradient><linearGradient id="profile-progress-line" x1="0" x2="1"><stop offset="0%" stopColor="var(--color-primary)" /><stop offset="100%" stopColor="var(--color-accent)" /></linearGradient></defs><path className="profile-chart-grid" d={`M ${padding} ${height - padding} H ${width - padding} M ${padding} ${height / 2} H ${width - padding} M ${padding} ${padding} H ${width - padding}`} /><path className="profile-chart-area" d={area} /><path className="profile-chart-line" d={line} /></svg><div><span>Week 1</span><span>Week 7</span><span>Week 13</span></div></div>;
}
