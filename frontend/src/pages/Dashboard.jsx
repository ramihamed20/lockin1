import { Link } from "react-router-dom";
import { dashboardApi } from "../api/learning.js";
import { progressApi } from "../api/progress.js";
import { motivationApi } from "../api/motivation.js";
import { reviewApi } from "../api/review.js";
import { Icon } from "../lib/icons.jsx";
import { getRecentOpenedCatalogSheets } from "../lib/materialCatalog.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { formatNumber } from "../lib/i18n.js";
import { MyGroupCard } from "../components/myGroup/MyGroupCard.jsx";

async function loadDashboard(user) {
  const [accountResult, learningResult, reviewResult, bankResult, xpResult, streakResult] = await Promise.allSettled([
    dashboardApi.accountDashboard(),
    progressApi.learningDashboard(),
    reviewApi.getQueue(),
    reviewApi.getBank(),
    motivationApi.xpSummary(),
    motivationApi.streakSummary({ scope: user })
  ]);
  if (accountResult.status === "rejected" && learningResult.status === "rejected" && reviewResult.status === "rejected" && bankResult.status === "rejected") {
    throw accountResult.reason;
  }
  return {
    account: accountResult.status === "fulfilled" ? accountResult.value : null,
    accountError: accountResult.status === "rejected" ? accountResult.reason : null,
    learning: learningResult.status === "fulfilled" ? learningResult.value : null,
    learningError: learningResult.status === "rejected" ? learningResult.reason : null,
    review: reviewResult.status === "fulfilled" ? reviewResult.value : null,
    reviewError: reviewResult.status === "rejected" ? reviewResult.reason : null,
    bank: bankResult.status === "fulfilled" ? bankResult.value : null,
    bankError: bankResult.status === "rejected" ? bankResult.reason : null,
    xp: xpResult.status === "fulfilled" ? xpResult.value : null,
    streak: streakResult.status === "fulfilled" ? streakResult.value : null
  };
}

export default function Dashboard({ user, themeSettings, activeTheme }) {
  const { t } = useI18n();
  const dashboard = useAsyncData(() => loadDashboard(user), []);

  if (dashboard.loading) return <LoadingPanel variant="dashboard" />;
  if (dashboard.error) return <ErrorPanel message={dashboard.error} onRetry={dashboard.reload} />;

  const { accountError, learning, learningError, review, reviewError, bank, bankError, xp, streak } = dashboard.data;
  const hasMascot = themeSettings.character !== "none";
  const recentOpenedSheets = getRecentOpenedCatalogSheets();
  const reviewItems = review?.results || [];
  return (
    <Page title="Dashboard" showHeading={false}>
      <div className="dashboard-layout">
        <StudyStates learning={learning} bank={bank} xp={xp} streak={streak} />
        <section className={`dashboard-main${hasMascot ? "" : " dashboard-main--no-mascot"}`}>
          <div className="dashboard-left">
            <ContinueCard sheetEntry={recentOpenedSheets[0] || null} />
            <RecentContent sheetEntries={recentOpenedSheets} />
          </div>
          {hasMascot && <div className="dashboard-right">
            <DashboardHero character={themeSettings.character} theme={activeTheme} />
          </div>}
        </section>
        <ReviewQueue items={reviewItems} />
        <MyGroupCard />
        {(accountError || learningError || reviewError || bankError) && <p className="save-hint">{t("dashboard.partialData")}</p>}
      </div>
    </Page>
  );
}

/**
 * The five numbers a student checks on arrival, each a card that opens the
 * page holding the detail. A card carries one value, one label and at most
 * one short note; colour appears only where it means something (a review
 * queue that has work in it, the level's progress). The values are the same
 * fields the dashboard always read; nothing here recalculates them.
 */
function StudyStates({ learning, bank, xp, streak }) {
  const { t } = useI18n();
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
    <section className="dash-states" aria-label={t("stats.summary")}>
      <ul className="dash-states-grid">
        <li className="dash-states-item dash-states-item--wide">
          <Link className="dash-state" to="/progress">
            <strong className="dash-state-value">{shown(level)}</strong>
            <span className="dash-state-label">{t("dashboard.level")}</span>
            {xp && <span className="dash-state-foot">
              <small className="dash-state-note" dir="auto">{t("dashboard.levelProgress", { progress: formatNumber(levelProgress), target: formatNumber(levelTarget) })}</small>
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

function ContinueCard({ sheetEntry }) {
  const { t } = useI18n();
  const sheet = sheetEntry?.sheet;
  const material = sheetEntry?.material;
  return (
    <article className="panel continue-card">
      <p className="eyebrow">{t("dashboard.continueStudying")}</p>
      <h2 dir="auto">{sheet?.title || t("dashboard.noSheetYet")}</h2>
      {sheet && material ? <>
        <div className="progress-meta"><span>{t("dashboard.lastOpenedSheet")}</span><strong dir="auto">{material.title}</strong></div>
        <Link className="btn btn-primary" to={sheetEntry.path}>{t("dashboard.continue")}</Link>
      </> : <>
        {/* The title already says nothing is open, and Recent Sheets beside it
            explains where sheets will appear; the button is the whole answer. */}
        <Link className="btn btn-primary" to="/materials">{t("dashboard.browseMaterials")}</Link>
      </>}
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
          : <p className="dashboard-recent-empty"><span aria-hidden="true"><Icon name="layers" size={20} /></span>{t("dashboard.recentEmpty")}</p>}
      </div>
    </article>
  );
}

function RecentSheetLink({ entry }) {
  const { t } = useI18n();
  const { material, sheet, path } = entry;
  const displayName = t("dashboard.sheetName", { name: material.title, number: sheet.number });
  return <Link className="dashboard-review-item dashboard-recent-material" to={path} aria-label={t("materials.openNamed", { name: displayName })}><span dir="auto">{displayName}</span><Icon name="arrow-up-right" size={15} aria-hidden="true" /></Link>;
}

function ReviewQueue({ items }) {
  const { t } = useI18n();
  const visibleItems = items.slice(0, 4);
  return (
    <article className="panel dashboard-review-card dashboard-review-queue">
      <header className="review-queue-header">
        <div className="review-queue-title"><span><Icon name="target" size={18} /></span><div><p className="eyebrow">{t("dashboard.reviewQueue")}</p><h2>{items.length ? t("dashboard.latestMistakes") : t("dashboard.noRecentMistakes")}</h2></div></div>
        <span className={`review-queue-count ${items.length ? "has-items" : ""}`}><strong>{items.length}</strong><small>{t("dashboard.itemCount", { count: items.length })}</small></span>
      </header>
      {items.length ? <>
        <div className="review-queue-list">
          {visibleItems.map((item) => {
            const contents = <><span className="review-queue-item-icon"><Icon name="help" size={17} /></span><div className="review-queue-item-copy"><h3 dir="auto">{item.prompt || t("dashboard.questionUnavailable")}</h3>{item.subject_label && <p dir="auto">{item.subject_label}</p>}</div><Icon className="review-queue-chevron" name="chevron-right" size={18} /></>;
            if (!item.subject_key) return <div key={item.id} className="review-queue-item">{contents}</div>;
            return <Link key={item.id} className="review-queue-item review-queue-link" to={`/review/bank/${encodeURIComponent(item.subject_key)}`} aria-label={t("dashboard.reviewNamed", { name: item.prompt || t("dashboard.missedQuestion") })}>
              {contents}
            </Link>;
          })}
        </div>
        <Link className="btn btn-soft compact" to="/review">{t("dashboard.openReviewCenter")} <Icon name="arrow-up-right" size={15} /></Link>
      </> : <div className="review-queue-empty"><span><Icon name="check" size={18} /></span><div><h3>{t("dashboard.niceWork")}</h3><p>{t("dashboard.reviewEmptyBody")}</p></div></div>}
    </article>
  );
}

function DashboardHero({ character, theme }) {
  const { t } = useI18n();
  const characterLabel = t(character === "white" ? "dashboard.whiteCat" : "dashboard.blackCat");
  return <article className="scene-card" aria-label={t("dashboard.mascotScene")}><ResponsiveThemePreview className="scene-theme" character={character} theme={theme} alt={t("dashboard.mascotAlt", { character: characterLabel, theme })} sizes="(max-width: 639px) 92vw, (max-width: 1199px) 52vw, 620px" priority /></article>;
}
