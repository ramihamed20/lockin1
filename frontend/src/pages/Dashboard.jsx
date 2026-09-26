import { Link } from "react-router-dom";
import { dashboardApi } from "../api/learning.js";
import { progressApi } from "../api/progress.js";
import { motivationApi } from "../api/motivation.js";
import { reviewApi } from "../api/review.js";
import { Icon } from "../lib/icons.jsx";
import { getRecentOpenedCatalogSheets } from "../lib/materialCatalog.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { StatsGrid } from "../components/shared/StatsGrid.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { MyGroupCard } from "../components/myGroup/MyGroupCard.jsx";

// Each card keeps a stable id so its destination and styling never depend on
// the label, which changes with the interface language.
const STAT_CARDS = [
  { id: "completed", labelKey: "dashboard.completed", subKey: "dashboard.completedSub", icon: "check", to: "/materials", actionKey: "dashboard.openCompleted", variant: "emerald", badgeKey: "dashboard.badgeDone", pulse: false },
  // Progress, not account security: active sessions are managed in Settings.
  { id: "level", labelKey: "dashboard.level", subKey: "dashboard.levelSub", icon: "sparkles", to: "/progress", variant: "amber", badgeKey: "dashboard.badgeXp", pulse: false },
  { id: "streak", labelKey: "dashboard.streak", subKey: "dashboard.streakSub", icon: "flame", to: "/progress", variant: "amber", badgeKey: "dashboard.badgeActive", pulse: false },
  { id: "reviewBank", labelKey: "dashboard.reviewBank", subKey: "dashboard.reviewBankSub", icon: "target", to: "/review", actionKey: "dashboard.openReviewCenter", variant: "rose" },
  { id: "saved", labelKey: "dashboard.saved", subKey: "dashboard.savedSub", icon: "bookmark", to: "/bookmarks", actionKey: "dashboard.openSaved", variant: "indigo", badgeKey: "dashboard.badgeSaved", pulse: false }
];

async function loadDashboard() {
  const [accountResult, learningResult, reviewResult, bankResult, xpResult, streakResult] = await Promise.allSettled([
    dashboardApi.accountDashboard(),
    progressApi.learningDashboard(),
    reviewApi.getQueue(),
    reviewApi.getBank(),
    motivationApi.xpSummary(),
    motivationApi.streakSummary()
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

export default function Dashboard({ themeSettings, activeTheme }) {
  const { t } = useI18n();
  const dashboard = useAsyncData(loadDashboard, []);

  if (dashboard.loading) return <LoadingPanel variant="dashboard" />;
  if (dashboard.error) return <ErrorPanel message={dashboard.error} onRetry={dashboard.reload} />;

  const { accountError, learning, learningError, review, reviewError, bank, bankError, xp, streak } = dashboard.data;
  const hasMascot = themeSettings.character !== "none";
  const recentOpenedSheets = getRecentOpenedCatalogSheets();
  const reviewItems = review?.results || [];
  const activeReviewCount = bank?.active_count;
  const values = {
    completed: learning?.completed_count ?? "—",
    saved: learning?.bookmark_count ?? "—",
    reviewBank: Number.isInteger(activeReviewCount) ? activeReviewCount : "—",
    level: Number.isInteger(xp?.level) ? t("dashboard.levelValue", { level: xp.level }) : "—",
    streak: Number.isInteger(streak?.current_days) ? t("dashboard.dayValue", { count: streak.current_days }) : "—"
  };
  const dashboardCards = STAT_CARDS.map((card) => ({
    label: t(card.labelKey),
    value: values[card.id],
    icon: card.icon,
    sub: card.id === "level" && xp
      ? t("dashboard.levelProgress", { progress: xp.level_progress ?? 0, target: xp.level_target ?? 0 })
      : card.id === "streak" && streak
        ? t("dashboard.streakBest", { count: streak.longest_days ?? 0 })
        : t(card.subKey),
    to: card.to,
    actionLabel: card.actionKey ? t(card.actionKey) : undefined,
    variant: card.variant,
    badge: card.id === "reviewBank" ? t(activeReviewCount > 0 ? "dashboard.badgeDue" : "dashboard.badgeClear") : t(card.badgeKey),
    pulse: card.id === "reviewBank" ? activeReviewCount > 0 : card.pulse
  }));
  return (
    <Page title="Dashboard" showHeading={false}>
      <div className="dashboard-layout">
        <StatsGrid cards={dashboardCards} className="dashboard-stats-grid" />
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
        <p>{t("dashboard.openSheetHint")}</p>
        <Link className="btn btn-primary" to="/materials">{t("dashboard.browseMaterials")}</Link>
      </>}
    </article>
  );
}

function RecentContent({ sheetEntries }) {
  const { t } = useI18n();
  const visibleSheets = sheetEntries.slice(0, 4);
  return (
    <article className="panel dashboard-review-card dashboard-recent-sheets">
      <div className="panel-title"><h2>{t("dashboard.recentSheets")}</h2><span><Icon name="layers" size={16} /></span></div>
      <div className="dashboard-review-list">
        {visibleSheets.length ? visibleSheets.map((entry) => <RecentSheetLink key={entry.path} entry={entry} />) : <p>{t("dashboard.recentEmpty")}</p>}
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
