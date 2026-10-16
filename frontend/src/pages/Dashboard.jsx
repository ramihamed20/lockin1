import { Link } from "react-router-dom";
import RescueEntry from "../rescue/RescueEntry.jsx";
import { RESCUE_ENABLED } from "../rescue/model.js";
import "../rescue/rescue.css";
import OfflineIndicator from "../offline/OfflineIndicator.jsx";
import { progressApi } from "../api/progress.js";
import { motivationApi } from "../api/motivation.js";
import { reviewApi } from "../api/review.js";
import { Icon } from "../lib/icons.jsx";
import { getRecentOpenedCatalogSheets } from "../lib/materialCatalog.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { Page } from "../components/ui/index.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { formatNumber } from "../lib/i18n.js";
import { MyGroupCard } from "../components/myGroup/MyGroupCard.jsx";

/**
 * Next action first: Continue (or a first step), then a quiet summary, then
 * the latest mistakes and the other recent sheets. Each section loads on its
 * own, so one failed read never blanks the sections that succeeded.
 */
export default function Dashboard({ user, themeSettings, activeTheme }) {
  const { t } = useI18n();
  const learning = useAsyncData(signal => progressApi.learningDashboard({ signal }), [user?.id]);
  const bank = useAsyncData(signal => reviewApi.getBank("", { signal }), [user?.id]);
  const xp = useAsyncData(signal => motivationApi.xpSummary({ signal }), [user?.id]);
  const streak = useAsyncData(() => motivationApi.streakSummary({ scope: user }), [user?.id]);
  const review = useAsyncData(signal => reviewApi.getQueue("", { signal }), [user?.id]);
  const summaries = [learning, bank, xp, streak];
  const summaryLoading = summaries.some(section => section.loading);
  const failedSummaries = summaries.filter(section => section.error);
  const recent = getRecentOpenedCatalogSheets(user?.id);
  const hasActivity = learning.data?.completed_count > 0 || xp.data?.total_xp > 0;
  const emptyState = hasActivity && bank.data?.active_count === 0 ? "cleared" : "new";
  // Continue already offers the latest sheet, so the list below starts with the
  // one before it; a student with no sheets sees Continue's invitation alone.
  const otherRecent = recent.slice(1);
  return <Page title="Dashboard" showHeading={false}>
    <div className="dashboard">
      <OfflineIndicator userId={user?.id} inline />
      <ContinueCard sheetEntry={recent[0] || null} character={themeSettings.character} theme={activeTheme} />
      {RESCUE_ENABLED && user?.id && <RescueEntry key={user.id} userId={user.id} />}
      <StudyStates learning={learning.data} bank={bank.data} xp={xp.data} streak={streak.data} loading={summaryLoading} />
      {failedSummaries.length > 0 && <div className="dashboard-summary-error">
        <p role="status">{t("dashboard.summaryUnavailable")}</p>
        <button className="btn btn-soft compact" type="button" disabled={failedSummaries.some(section => section.refreshing)} onClick={() => failedSummaries.forEach(section => section.reload())}>{t("common.tryAgain")}</button>
      </div>}
      <section className={`dashboard-secondary${recent.length ? "" : " is-single"}`} aria-label={t("dashboard.studyAndReview")}>
        <ReviewQueue items={review.data?.results || []} loading={review.loading} refreshing={review.refreshing} error={review.error} onRetry={review.reload} emptyState={emptyState} />
        {recent.length > 0 && <RecentContent sheetEntries={otherRecent} />}
      </section>
      {/* Preserve the timetable's existing request priority after summary reads. */}
      {!summaryLoading && <MyGroupCard />}
    </div>
  </Page>;
}

/**
 * The five numbers a student checks on arrival, each opening the page that
 * holds the detail. Colour appears only where it means something (a review
 * queue with work in it, the level's progress). The values are the same fields
 * the dashboard always read; nothing here recalculates them.
 */
function StudyStates({ learning, bank, xp, streak, loading }) {
  const { t, direction } = useI18n();
  const whole = (value) => (Number.isInteger(value) ? value : null);
  const shown = (value) => (value === null ? "—" : formatNumber(value));
  const level = whole(xp?.level);
  const levelProgress = Number(xp?.level_progress) || 0;
  const levelTarget = Number(xp?.level_target) || 0;
  const levelPercent = levelTarget ? Math.min(100, Math.round((levelProgress / levelTarget) * 100)) : 0;
  const streakDays = whole(streak?.current_days);
  const bestDays = whole(streak?.longest_days);
  const reviewCount = whole(bank?.active_count);
  const completed = whole(learning?.completed_count);
  const saved = whole(learning?.bookmark_count);

  return (
    <section className="dash-states" aria-label={t("stats.summary")} aria-busy={loading}>
      {loading && <p className="visually-hidden" role="status">{t("common.loading")}</p>}
      <ul className="dash-states-grid">
        <li className="dash-states-item dash-states-item--wide">
          <Link className="dash-state" to="/progress">
            <strong className="dash-state-value">{shown(level)}</strong>
            <span className="dash-state-label">{t("dashboard.level")}</span>
            {xp && <span className="dash-state-foot">
              <small className="dash-state-note"><bdi dir={direction}>{t("dashboard.xpProgress", { progress: formatNumber(levelProgress), target: formatNumber(levelTarget) })}</bdi></small>
              <span className="progress-line dash-state-meter" aria-hidden="true"><span style={{ width: `${levelPercent}%` }} /></span>
            </span>}
          </Link>
        </li>
        <li className="dash-states-item">
          <Link className="dash-state" to="/progress">
            <strong className="dash-state-value">{shown(streakDays)}{streakDays !== null && <small>{t("progress.dayCount", { count: streakDays })}</small>}</strong>
            <span className="dash-state-label">{t("dashboard.streak")}</span>
            {bestDays !== null && streakDays !== null && bestDays > streakDays && <small className="dash-state-note" dir="auto">{t("dashboard.streakBest", { count: bestDays })}</small>}
          </Link>
        </li>
        <li className="dash-states-item">
          <Link className={`dash-state${reviewCount > 0 ? " dash-state--due" : ""}`} to="/review">
            <strong className="dash-state-value">{shown(reviewCount)}</strong>
            <span className="dash-state-label">{t("dashboard.stateReview")}</span>
          </Link>
        </li>
        <li className="dash-states-item">
          <Link className="dash-state" to="/materials">
            <strong className="dash-state-value">{shown(completed)}</strong>
            <span className="dash-state-label">{t("dashboard.stateCompleted")}</span>
          </Link>
        </li>
        <li className="dash-states-item">
          <Link className="dash-state" to="/bookmarks">
            <strong className="dash-state-value">{shown(saved)}</strong>
            <span className="dash-state-label">{t("dashboard.stateSaved")}</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

function ContinueCard({ sheetEntry, character = "none", theme }) {
  const { t, direction } = useI18n();
  const sheet = sheetEntry?.sheet;
  const material = sheetEntry?.material;
  return (
    <article className="panel continue-card">
      <p className="eyebrow">{t(sheet ? "dashboard.continueStudying" : "dashboard.startStudying")}</p>
      <h2 dir="auto">{sheet?.title || t("dashboard.welcomeStudy")}</h2>
      {sheet && material ? <>
        <p className="progress-meta"><bdi dir={direction}>{t("dashboard.sheetName", { name: material.title, number: sheet.number })}</bdi></p>
        <Link className="btn btn-primary" to={sheetEntry.path}>{t("dashboard.continue")}<Icon className="dashboard-forward" name="arrow-up-right" size={18} aria-hidden="true" /></Link>
      </> : <>
        <p>{t("dashboard.openSheetHint")}</p>
        <Link className="btn btn-primary" to="/materials">{t("dashboard.browseMaterials")}</Link>
      </>}
      {character !== "none" && <div className="dashboard-art"><DashboardHero character={character} theme={theme} /></div>}
    </article>
  );
}

function RecentContent({ sheetEntries }) {
  const { t } = useI18n();
  const visibleSheets = sheetEntries.slice(0, 4);
  return (
    <article className={`panel dashboard-review-card dashboard-recent-sheets${visibleSheets.length ? "" : " is-empty"}`}>
      <div className="panel-title"><h2>{t("dashboard.recentSheets")}</h2><span><Icon name="layers" size={16} /></span></div>
      <div className="dashboard-review-list">
        {visibleSheets.length
          ? visibleSheets.map((entry) => <RecentSheetLink key={entry.path} entry={entry} />)
          : <p className="dashboard-recent-empty"><span aria-hidden="true"><Icon name="layers" size={20} /></span>{t("dashboard.recentOthersEmpty")}</p>}
      </div>
    </article>
  );
}

function RecentSheetLink({ entry }) {
  const { t, direction } = useI18n();
  const { material, sheet, path } = entry;
  const displayName = t("dashboard.sheetName", { name: material.title, number: sheet.number });
  const accessibleName = sheet.title ? `${sheet.title} · ${displayName}` : displayName;
  return <Link className="dashboard-review-item dashboard-recent-material" to={path} aria-label={t("materials.openNamed", { name: accessibleName })}><span><strong dir="auto">{sheet.title}</strong><small><bdi dir={direction}>{displayName}</bdi></small></span><Icon className="dashboard-forward" name="arrow-up-right" size={15} aria-hidden="true" /></Link>;
}

function ReviewQueue({ items, loading, error, onRetry, refreshing = false, emptyState = "new" }) {
  const { t } = useI18n();
  const visibleItems = items.slice(0, 4);
  return (
    <article className="panel dashboard-review-card dashboard-review-queue" aria-busy={loading}>
      <header className="review-queue-header">
        <div className="review-queue-title"><span><Icon name="target" size={18} /></span><h2>{loading || error || items.length ? t("dashboard.latestMistakes") : t("dashboard.noRecentMistakes")}</h2></div>
      </header>
      {loading ? <div className="review-queue-empty" role="status"><p>{t("common.loading")}</p></div>
        : error ? <div className="review-queue-empty"><div><p role="status">{t("dashboard.reviewUnavailable")}</p><button className="btn btn-soft compact" type="button" onClick={onRetry} disabled={refreshing}>{t(refreshing ? "common.loading" : "common.tryAgain")}</button></div></div>
          : items.length ? <div className="review-queue-list">
            {visibleItems.map((item) => {
              const contents = <><div className="review-queue-item-copy"><h3 dir="auto">{item.prompt || t("dashboard.questionUnavailable")}</h3>{item.subject_label && <p dir="auto">{item.subject_label}</p>}</div><Icon className="review-queue-chevron" name="chevron-right" size={18} /></>;
              if (!item.subject_key) return <div key={item.id} className="review-queue-item">{contents}</div>;
              return <Link key={item.id} className="review-queue-item review-queue-link" to={`/review/bank/${encodeURIComponent(item.subject_key)}`} aria-label={t("dashboard.reviewNamed", { name: item.prompt || t("dashboard.missedQuestion") })}>
                {contents}
              </Link>;
            })}
          </div>
            : <div className="review-queue-empty"><span><Icon name={emptyState === "new" ? "target" : "check"} size={18} /></span><div><h3>{t(emptyState === "cleared" ? "dashboard.reviewCleared" : "dashboard.reviewFirstStep")}</h3><p>{t(emptyState === "cleared" ? "dashboard.reviewClearedBody" : "dashboard.reviewFirstStepBody")}</p></div></div>}
      <Link className="btn btn-soft compact" to="/review">{t("dashboard.openReviewCenter")} <Icon className="dashboard-forward" name="arrow-up-right" size={15} aria-hidden="true" /></Link>
    </article>
  );
}

function DashboardHero({ character, theme }) {
  const { t } = useI18n();
  const characterLabel = t(character === "white" ? "dashboard.whiteCat" : "dashboard.blackCat");
  return <article className="scene-card" aria-label={t("dashboard.mascotScene")}><ResponsiveThemePreview className="scene-theme" character={character} theme={theme} alt={t("dashboard.mascotAlt", { character: characterLabel, theme })} sizes="(max-width: 639px) 64px, 144px" priority /></article>;
}
