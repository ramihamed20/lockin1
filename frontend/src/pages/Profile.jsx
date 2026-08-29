import { useEffect, useState } from "react";
import { accountsApi } from "../api/accounts.js";
import { motivationApi } from "../api/motivation.js";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { normalizeThemeSettings } from "../lib/utils.js";
import { Page, ProgressLine } from "../components/ui/index.jsx";
import { AccountFieldErrors } from "../components/account/AccountFormErrors.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { formatDate, formatNumber as formatLocaleNumber } from "../lib/i18n.js";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";
import { ResponsiveMascot } from "../components/shared/ResponsiveMascot.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

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
    availability: {
      account: account.status === "fulfilled",
      learning: learning.status === "fulfilled",
      xp: xp.status === "fulfilled",
      ledger: ledger.status === "fulfilled",
      streak: streak.status === "fulfilled",
      ranking: ranking.status === "fulfilled"
    },
    unavailableCount: results.filter((result) => result.status === "rejected").length
  };
}

function asNumber(value) {
  return Number(value) || 0;
}

function formatNumber(value) {
  return formatLocaleNumber(asNumber(value));
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatOptionalNumber(value, fallback) {
  const number = optionalNumber(value);
  return number === null ? fallback : formatLocaleNumber(number);
}

function dateLabel(value, t) {
  if (!value) return t("profile.memberDateUnavailable");
  const formatted = formatDate(value, { day: "numeric", month: "short", year: "numeric" });
  return formatted === "—" ? t("profile.memberDateUnavailable") : formatted;
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

function ActivityHeatmap({ cells, onSelect, compact = false }) {
  const { t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, cells.length - 1));

  useEffect(() => {
    setActiveIndex((current) => Math.min(Math.max(0, current), Math.max(0, cells.length - 1)));
  }, [cells.length]);

  function select(index) {
    const bounded = Math.min(Math.max(0, index), cells.length - 1);
    setActiveIndex(bounded);
    onSelect?.(cells[bounded]);
  }

  function handleKeyDown(event) {
    const rtl = document.documentElement.dir === "rtl";
    const horizontal = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const vertical = event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? cells.length - 1 : activeIndex + horizontal + vertical;
    if (!horizontal && !vertical && !["Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    select(["Enter", " "].includes(event.key) ? activeIndex : next);
  }

  function handleClick(event) {
    const cell = event.target.closest?.("[data-activity-index]");
    if (cell) select(Number(cell.dataset.activityIndex));
  }

  return (
    <div
      className={`profile-heatmap ${compact ? "profile-heatmap--compact" : ""}`.trim()}
      role="grid"
      tabIndex={0}
      aria-label={t("profile.heatmapLabel")}
      aria-activedescendant={cells[activeIndex] ? `activity-${compact ? "compact-" : ""}${cells[activeIndex].key}` : undefined}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      {cells.map((cell, index) => (
        <span
          id={`activity-${compact ? "compact-" : ""}${cell.key}`}
          role="gridcell"
          key={cell.key}
          data-activity-index={index}
          className={`profile-heat-cell level-${cell.level}`}
          aria-label={t("profile.cellLabel", { date: cell.key, awards: t("profile.awardsCount", { count: cell.value }) })}
          aria-selected={activeIndex === index}
        />
      ))}
    </div>
  );
}

export default function Profile({ user, onUserUpdate }) {
  const { t } = useI18n();
  const profile = useAsyncData(loadProfileWorkspace, [user?.id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name || "", preferredLanguage: user?.preferredLanguage || "en" });
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [mobileSection, setMobileSection] = useState("overview");

  const workspace = profile.data || {};
  const account = workspace.account || user;
  const learning = workspace.learning || {};
  const xp = workspace.xp || {};
  const streak = workspace.streak || {};
  const ranking = workspace.ranking || {};
  const availability = workspace.availability || {};
  const dueReviewCount = Array.isArray(learning.review_due) ? learning.review_due.length : null;
  const level = asNumber(xp.level) || 1;
  const levelProgress = asNumber(xp.level_target) ? Math.round((asNumber(xp.level_progress) / asNumber(xp.level_target)) * 100) : 0;
  const recentActivity = activityCells(Array.isArray(workspace.ledger?.results) ? workspace.ledger.results : []);
  const activityWeeks = weeklyActivity(recentActivity);
  const activeDays = recentActivity.filter((cell) => cell.value > 0).length;
  const consistency = availability.ledger ? Math.round((activeDays / recentActivity.length) * 100) : null;
  const totalStudyTime = typeof learning.total_study_time === "string" && learning.total_study_time.trim() ? learning.total_study_time : null;
  const highestStreak = optionalNumber(streak.longest_days);
  const totalReviewCount = optionalNumber(learning.total_review_count);
  const studyInsight = dueReviewCount > 0
    ? t("profile.insightDue", { count: dueReviewCount })
    : activeDays > 0
      ? t("profile.insightActive", { count: activeDays })
      : t("profile.insightNone");
  const theme = normalizeThemeSettings({
    character: account?.themeSettings?.character,
    theme: typeof document === "undefined" ? "night" : document.documentElement.dataset.theme
  });
  const profileRank = optionalNumber(ranking.own_entry?.position);
  const rankScore = optionalNumber(ranking.own_entry?.score);
  const rankEvidence = optionalNumber(ranking.own_entry?.evidence_count);

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
    <Page title="My Profile" subtitle={t("profile.subtitle")}>
      <section className="profile-page">
        {workspace.unavailableCount > 0 && <p className="profile-sync-note" role="status"><Icon name="activity" size={16} />{t("profile.syncNote")}</p>}

        <nav className="profile-mobile-nav" aria-label={t("profile.sections")}>
          {[["overview", "profile.overview"], ["activity", "profile.activity"], ["personal", "profile.personal"]].map(([id, labelKey]) => <button type="button" key={id} className={mobileSection === id ? "active" : ""} aria-pressed={mobileSection === id} onClick={() => setMobileSection(id)}>{t(labelKey)}</button>)}
        </nav>

        <section className={`profile-hero-grid profile-mobile-section profile-mobile-overview ${mobileSection === "overview" ? "is-active" : ""}`} aria-label={t("profile.overviewLabel")}>
          <div className="profile-academy-stack">
          <article className="panel student-id-card profile-academy-id">
            <div className="id-card-header"><div className="id-card-logo"><Icon name="award" size={18} /><span>{t("profile.academy")}</span></div><span className="id-card-chip" /></div>
            <div className="id-card-body">
              <div className="profile-avatar-wrap"><ResponsiveMascot alt={t("profile.companionAlt")} sizes="140px" priority /><div className="profile-level-badge"><span>{t("profile.lvl")}</span><strong>{level}</strong></div></div>
              {editing ? <form onSubmit={saveProfile} className="profile-edit-form profile-id-edit-form">
                <label className="field"><span>{t("profile.displayName")}</span><input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><AccountFieldErrors error={profileError} field="full_name" /></label>
                <label className="field"><span>{t("profile.preferredLanguage")}</span><select value={form.preferredLanguage} onChange={(event) => setForm({ ...form, preferredLanguage: event.target.value })}><option value="en">{t("profile.english")}</option><option value="ar">{t("profile.arabic")}</option></select><AccountFieldErrors error={profileError} field="preferred_language" /></label>
                {profileError && <p className="form-alert error" role="alert" dir="auto">{profileError.message || t("profile.saveError")}</p>}
                <div className="profile-edit-actions"><button className="btn btn-primary compact" type="submit" disabled={saving}>{t(saving ? "profile.saving" : "profile.saveChanges")}</button><button className="btn btn-soft compact" type="button" onClick={() => setEditing(false)}>{t("common.cancel")}</button></div>
              </form> : <div className="id-card-info">
                <div className="id-card-field"><span className="id-card-label">{t("profile.academyMember")}</span><h2 className="id-card-value" dir="auto">{account?.name || t("profile.learner")}</h2><p className="id-card-value email" dir="auto">{t("profile.studentId", { id: (account?.id || "—").slice(0, 8) })}</p></div>
                <div className="profile-id-tags"><span className="id-card-value-pill"><Icon name="award" size={13} /> {t("profile.scholar")}</span><span className={`id-card-value-pill ${account?.status === "active" ? "active" : ""}`} dir="auto">{account?.status || t("profile.unknown")}</span></div>
                <div className="id-card-row"><div className="id-card-field"><span className="id-card-label">{t("profile.memberSince")}</span><span className="profile-id-data" dir="auto">{dateLabel(account?.dateJoined, t)}</span></div><div className="id-card-field"><span className="id-card-label">{t("profile.language")}</span><span className="profile-id-data">{t(account?.preferredLanguage === "ar" ? "profile.arabic" : "profile.english")}</span></div></div>
                <div className="profile-id-progress"><div><span>{t("profile.xpProgressLabel")}</span><strong dir="auto">{t("profile.xpOf", { current: formatNumber(xp.level_progress), target: formatNumber(xp.level_target) })}</strong></div><ProgressLine value={levelProgress} /></div>
                <button className="btn btn-soft compact edit-id-btn" type="button" onClick={() => setEditing(true)}><Icon name="settings" size={14} /> {t("profile.editProfile")}</button>
              </div>}
            </div>
            <div className="id-card-footer"><div className="id-card-barcode">{["thin", "thick", "medium", "thin", "thick", "thin", "medium", "thin", "thick", "medium"].map((kind, index) => <span className={`barcode-line ${kind}`} key={index} />)}</div><span className="id-card-serial">LOCK-IN · {(account?.id || "ACCOUNT").slice(0, 8)}</span></div>
          </article>

          <article className="panel profile-study-passport">
            <div className="profile-passport-heading"><div><span>{t("profile.focusPassport")}</span><h2>{t("profile.todayStamps")}</h2></div><span><Icon name="award" size={17} /></span></div>
            <div className="profile-passport-stamps" aria-label={t("profile.passportLabel")}><div className="profile-passport-stamp earned"><Icon name="award" size={17} /><span>{t("profile.member")}</span></div><div className={`profile-passport-stamp ${activeDays ? "earned" : ""}`}><Icon name="activity" size={17} /><span>{t(activeDays ? "profile.inRhythm" : "profile.firstFocus")}</span></div><div className="profile-passport-stamp next"><Icon name="target" size={17} /><span>{t("profile.next25")}</span></div></div>
            <p>{t("profile.stampCopy")}</p>
          </article>
          </div>

          <article className="panel profile-overview-card">
            <div className="profile-card-heading"><div><p className="eyebrow">{t("profile.last13")}</p><h2>{t("profile.studyOverview")}</h2></div><span><Icon name="activity" size={17} /></span></div>
            <StudyProgressChart values={activityWeeks} />
            <p className="profile-chart-insight" dir="auto"><Icon name="sparkles" size={16} />{studyInsight}</p>
            <dl className="profile-overview-list"><div><dt><Icon name="clock" size={16} />{t("profile.totalStudyTime")}</dt><dd dir="auto">{totalStudyTime || t("profile.unavailable")}</dd></div><div><dt><Icon name="flame" size={16} />{t("profile.highestStreak")}</dt><dd dir="auto">{highestStreak === null ? t("profile.unavailable") : t("profile.daysValue", { count: highestStreak })}</dd></div><div><dt><Icon name="target" size={16} />{t("profile.totalReview")}</dt><dd dir="auto">{formatOptionalNumber(totalReviewCount, t("profile.unavailable"))}</dd></div></dl>
          </article>
        </section>

        <section className={`profile-snapshot-grid profile-mobile-section profile-mobile-overview ${mobileSection === "overview" ? "is-active" : ""}`} aria-label={t("profile.snapshotLabel")}>
          <SnapshotCard label={t("profile.totalXp")} value={formatOptionalNumber(xp.total_points, t("profile.unavailable"))} detail={optionalNumber(xp.transaction_count) === null ? t("profile.awardsUnavailable") : t("profile.awardsCount", { count: optionalNumber(xp.transaction_count) })} icon="award" variant="xp" />
          <SnapshotCard label={t("profile.focusRhythm")} value={consistency === null ? t("profile.unavailable") : `${consistency}%`} detail={availability.ledger ? t("profile.activeDaysCount", { count: activeDays }) : t("profile.activityUnavailable")} icon="activity" variant="rhythm" />
          <SnapshotCard label={t("profile.currentStreak")} value={formatOptionalNumber(streak.current_days, t("profile.unavailable"))} detail={availability.streak ? t("profile.daysInRow") : t("profile.streakUnavailable")} icon="flame" variant="streak" />
          <SnapshotCard label={t("profile.reviewQueue")} value={formatOptionalNumber(dueReviewCount, t("profile.unavailable"))} detail={dueReviewCount === null ? t("profile.reviewUnavailable") : dueReviewCount ? t("profile.readyForReview") : t("profile.allCaughtUp")} icon="target" variant="review" />
        </section>

        <section className={`profile-focus-grid profile-mobile-section profile-mobile-activity ${mobileSection === "activity" ? "is-active" : ""}`}>
          <article className="panel profile-activity-card profile-activity-card--wide">
            <div className="profile-card-heading"><div><p className="eyebrow">{t("profile.last13")}</p><h2>{t("profile.studyActivity")}</h2></div><span><Icon name="calendar" size={17} /></span></div>
            <ActivityHeatmap cells={recentActivity} onSelect={setSelectedActivity} />
            {selectedActivity && <p className="activity-cell-detail" role="status"><strong dir="auto">{selectedActivity.key}</strong><span dir="auto">{t("profile.awardsRecorded", { count: selectedActivity.value })}</span></p>}
            <div className="profile-heatmap-footer"><span>{t("profile.recentActivity")}</span><div><small>{t("profile.less")}</small>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`profile-heat-cell level-${level}`} />)}<small>{t("profile.more")}</small></div></div>
          </article>
        </section>

        <section className={`profile-utility-grid profile-mobile-section profile-mobile-personal ${mobileSection === "personal" ? "is-active" : ""}`}>
          <article className="panel profile-customization-card"><div className="profile-card-heading"><div><p className="eyebrow">{t("profile.yourWorkspace")}</p><h2>{t("profile.myCustomization")}</h2></div><Icon name="palette" size={17} /></div><div className="profile-customization-content"><dl><div><dt>{t("profile.currentTheme")}</dt><dd>{t(`theme.${theme.theme}`)}</dd></div><div><dt>{t("profile.mascotSkin")}</dt><dd>{theme.character === "white" ? "Starsea" : "Starmo"}</dd></div><div><dt>{t("profile.interfaceLanguage")}</dt><dd>{t(account?.preferredLanguage === "ar" ? "profile.arabic" : "profile.english")}</dd></div></dl><ResponsiveThemePreview character={theme.character} theme={theme.theme} alt={t("profile.themePreviewAlt", { theme: t(`theme.${theme.theme}`) })} sizes="96px" /></div></article>

          <article className="panel profile-companion-card"><div className="profile-card-heading"><div><p className="eyebrow">{t("profile.studyCompanion")}</p><h2>{t("profile.starmoCompanion")}</h2></div><span className="profile-heading-count">{t("profile.readyToFocus")}</span></div><div className="profile-companion-content"><ResponsiveMascot alt={t("profile.starmoAlt")} sizes="92px" /><div><p>{t("profile.companionCopy")}</p><ProgressLine value={levelProgress} /><small dir="auto">{t("profile.xpOf", { current: formatNumber(xp.level_progress), target: formatNumber(xp.level_target) })}</small></div></div></article>

          <article className="panel profile-rank-card"><div className="profile-card-heading"><div><p className="eyebrow">{t("profile.publishedRanking")}</p><h2>{t("profile.academyRank")}</h2></div><Icon name="trophy" size={18} /></div><strong className="profile-rank-number" dir="auto">{profileRank === null ? "—" : `#${formatNumber(profileRank)}`}</strong><p dir="auto">{ranking.definition?.title || t(profileRank === null ? "profile.noRanking" : "profile.currentPosition")}</p><div className="profile-rank-meta"><span dir="auto">{rankScore === null ? t("profile.pointsUnavailable") : t("profile.pointsValue", { count: rankScore })}</span><span dir="auto">{rankEvidence === null ? t("profile.evidenceUnavailable") : t("profile.evidenceValue", { count: rankEvidence })}</span></div></article>
        </section>

        <section className={`profile-bottom-grid profile-mobile-section profile-mobile-personal ${mobileSection === "personal" ? "is-active" : ""}`}>
          <article className="panel profile-consistency-card"><div className="profile-card-heading"><div><p className="eyebrow">{t("profile.learningRhythm")}</p><h2>{t("profile.learningConsistency")}</h2></div><Icon name="calendar" size={17} /></div><div className="profile-consistency-content"><div><span>{t("profile.activeDays")}</span><strong>{activeDays}</strong><small>{t("profile.inLast13")}</small></div><div><span>{t("profile.bestStreak")}</span><strong dir="auto">{formatNumber(streak.longest_days)}</strong><small>{t("profile.daysInRow")}</small></div><ActivityHeatmap cells={recentActivity.slice(-21)} onSelect={setSelectedActivity} compact /></div></article>

          <article className="panel profile-lock-card"><div className="profile-card-heading"><div><p className="eyebrow">{t("profile.storeWallet")}</p><h2>{t("profile.lockStatistics")}</h2></div><Icon name="coins" size={18} /></div><p className="profile-data-unavailable">{t("profile.walletUnavailable")}</p></article>
        </section>

      </section>
    </Page>
  );
}

function SnapshotCard({ label, value, detail, icon, variant }) {
  return <article className={`panel profile-snapshot-card profile-snapshot-card--${variant}`}><span className="profile-snapshot-icon"><Icon name={icon} size={18} /></span><div><span>{label}</span><strong dir="auto">{value}</strong><small dir="auto">{detail}</small></div></article>;
}

function StudyProgressChart({ values }) {
  const { t } = useI18n();
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

  return <div className="profile-progress-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("profile.chartLabel")}><defs><linearGradient id="profile-progress-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.42" /><stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" /></linearGradient><linearGradient id="profile-progress-line" x1="0" x2="1"><stop offset="0%" stopColor="var(--color-primary)" /><stop offset="100%" stopColor="var(--color-accent)" /></linearGradient></defs><path className="profile-chart-grid" d={`M ${padding} ${height - padding} H ${width - padding} M ${padding} ${height / 2} H ${width - padding} M ${padding} ${padding} H ${width - padding}`} /><path className="profile-chart-area" d={area} /><path className="profile-chart-line" d={line} /></svg><div><span dir="auto">{t("profile.week", { number: 1 })}</span><span dir="auto">{t("profile.week", { number: 7 })}</span><span dir="auto">{t("profile.week", { number: 13 })}</span></div></div>;
}
