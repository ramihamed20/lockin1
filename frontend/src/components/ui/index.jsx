import { createContext, useContext, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { LockinIcon } from "../../lib/lockinIcons.jsx";
import { usePageTitle } from "../../hooks/usePageTitle.js";
import { normalizeUserError } from "../../lib/errors.js";
import { routeMetadata } from "../../lib/routeMetadata.js";
import { translate } from "../../lib/i18n.js";
import { useI18n } from "../I18nProvider.jsx";
import { cssVars } from "../../lib/utils.js";

/** @type {import("react").Context<boolean>} */
const PageIdentityContext = createContext(false);
/** True inside a Page that prints its own visible title. */
/** @type {import("react").Context<boolean>} */
const PageHeadingContext = createContext(false);

/**
 * `width="reading"` sets the page in the one reading column list and detail
 * screens share (catalogue, questions, review, inbox, account). Pages that lay
 * content side by side (dashboard, progress, settings, workspaces) leave it off.
 */
export function Page({ title, subtitle = "", children, showHeading = false, headingHandled = false, width = "" }) {
  usePageTitle(title);
  const location = useLocation();
  const { t } = useI18n();
  const metadata = routeMetadata(location.pathname, t);
  const englishMetadata = routeMetadata(location.pathname, (key) => translate("en", key));
  const resolvedTitle = !title || title === englishMetadata.h1 ? metadata.h1 : title;
  return (
    <PageIdentityContext.Provider value={true}>
      <PageHeadingContext.Provider value={Boolean(showHeading || headingHandled)}>
        <div className={width ? `page page--${width}` : "page"}>
          {showHeading && <header className="section-heading"><h1 dir="auto">{resolvedTitle}</h1>{subtitle && <p dir="auto">{subtitle}</p>}</header>}
          {!showHeading && !headingHandled && <h1 className="visually-hidden" dir="auto">{resolvedTitle}</h1>}
          {children}
        </div>
      </PageHeadingContext.Provider>
    </PageIdentityContext.Provider>
  );
}

export function ProgressLine({ value }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="progress-line" role="progressbar" aria-label={`${safeValue}% complete`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}>
      <span style={{ width: `${safeValue}%` }}>{safeValue >= 30 ? `${safeValue}%` : ""}</span>
    </div>
  );
}

export function ListRow({ title, meta, icon, action }) {
  return (
    <article className="list-row">
      <span className="stat-icon"><Icon name={icon} /></span>
      <div><h2 dir="auto">{title}</h2><p dir="auto">{meta}</p></div>
      {action || <Icon name="chevron-right" size={18} />}
    </article>
  );
}

/**
 * An empty state is one of the few places worth a concept icon: it is large,
 * it is the only thing on screen, and it is naming a part of the product
 * rather than an action. Pass `icon` with a Lock-in concept name to say which
 * part. Callers that pass nothing keep the generic mark they already had.
 *
 * The icon is decorative here -- the heading and the body text carry the
 * meaning, so it stays out of the accessibility tree.
 */
export function EmptyState({ title, text, icon = "", action = null }) {
  // `action` ({ label, to }) turns an ending into a next step: an empty list
  // offers the one place that would fill it.
  return <article className="empty-state">{icon ? <LockinIcon name={icon} size={30} /> : <Icon name="sparkles" />}<h2 dir="auto">{title}</h2><p dir="auto">{text}</p>{action && <Link className="btn btn-soft compact empty-state-action" to={action.to}>{action.label}</Link>}</article>;
}

export function Skeleton({ className = "", style = undefined }) {
  return <span className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

export function SkeletonText({ lines = 2, className = "" }) {
  return <span className={`skeleton-text ${className}`.trim()} aria-hidden="true">{Array.from({ length: lines }, (_, index) => <Skeleton key={index} />)}</span>;
}

export function SkeletonAvatar({ className = "" }) {
  return <Skeleton className={`skeleton-avatar ${className}`.trim()} />;
}

export function SkeletonButton({ className = "" }) {
  return <Skeleton className={`skeleton-button ${className}`.trim()} />;
}

function SkeletonCard({ children, className = "" }) {
  return <article className={`skeleton-card ${className}`.trim()} aria-hidden="true">{children}</article>;
}

function SkeletonHeader() {
  // Under a page that already prints its real title, placeholder bars for a
  // title would only stack a second, fake heading beneath the real one.
  const headingVisible = useContext(PageHeadingContext);
  if (headingVisible) return null;
  return <header className="skeleton-page-heading"><Skeleton className="skeleton-kicker" /><Skeleton className="skeleton-title" /><Skeleton className="skeleton-subtitle" /></header>;
}

function CardGridSkeleton({ count = 6, card = "standard" }) {
  return <section className={`skeleton-card-grid skeleton-card-grid--${card}`} aria-hidden="true">{Array.from({ length: count }, (_, index) => (
    <SkeletonCard key={index} className={`skeleton-card--${card}`}>
      <div className="skeleton-card-heading"><SkeletonAvatar /><SkeletonText lines={2} /></div>
      <Skeleton className="skeleton-card-meta" />
      <SkeletonButton />
    </SkeletonCard>
  ))}</section>;
}

function DashboardSkeleton() {
  // Same order as the screen it stands in for: the state row (Level twice as
  // wide), then Continue and Recent beside the scene, so nothing reflows when
  // the numbers arrive.
  const rows = Array.from({ length: 3 }, (_, index) => <div className="skeleton-list-row" key={index}><SkeletonAvatar /><SkeletonText lines={2} /></div>);
  return <div className="skeleton-page skeleton-page--dashboard">
    <section className="skeleton-dashboard-stats">{Array.from({ length: 5 }, (_, index) => <SkeletonCard key={index} className={index === 0 ? "skeleton-stat is-wide" : "skeleton-stat"}><Skeleton className="skeleton-stat-value" /><Skeleton className="skeleton-stat-label" /></SkeletonCard>)}</section>
    <section className="skeleton-dashboard-layout">
      <div><SkeletonCard className="skeleton-continue-card"><SkeletonText lines={2} /><SkeletonButton /></SkeletonCard><SkeletonCard className="skeleton-list-card"><SkeletonText lines={1} />{rows}</SkeletonCard></div>
      <div><SkeletonCard className="skeleton-visual-card"><Skeleton className="skeleton-visual" /></SkeletonCard></div>
    </section>
  </div>;
}

function MaterialsListSkeleton({ sheets = false }) {
  return <div className={`skeleton-page skeleton-page--materials${sheets ? " is-sheets" : ""}`}><SkeletonHeader /><section className="skeleton-material-grid">{Array.from({ length: sheets ? 6 : 5 }, (_, index) => <SkeletonCard className="skeleton-material-row" key={index}><SkeletonAvatar /><div><SkeletonText lines={2} /></div><Skeleton className="skeleton-row-end" /></SkeletonCard>)}</section></div>;
}

function SheetSkeleton() {
  return <div className="skeleton-page skeleton-page--sheet"><Skeleton className="skeleton-breadcrumb" /><SkeletonCard className="skeleton-sheet-primary"><div className="skeleton-card-heading"><SkeletonAvatar /><SkeletonText lines={3} /></div><SkeletonButton /></SkeletonCard><section className="skeleton-sheet-options">{Array.from({ length: 3 }, (_, index) => <SkeletonCard className="skeleton-material-row" key={index}><SkeletonAvatar /><SkeletonText lines={2} /><Skeleton className="skeleton-row-end" /></SkeletonCard>)}</section></div>;
}

function ProfileSkeleton() {
  return <div className="skeleton-page skeleton-page--profile skeleton-profile-v2"><SkeletonCard className="skeleton-profile-v2-card"><SkeletonAvatar className="skeleton-avatar--profile" /><SkeletonText lines={4} /></SkeletonCard><SkeletonCard className="skeleton-profile-v2-activity"><Skeleton className="skeleton-heatmap" /></SkeletonCard></div>;
}

function ProgressSkeleton() {
  return <div className="skeleton-page skeleton-page--progress"><SkeletonCard className="skeleton-level-hero"><Skeleton className="skeleton-level-orb" /><SkeletonText lines={3} /><Skeleton className="skeleton-arc" /></SkeletonCard><CardGridSkeleton count={3} card="stat" /><section className="skeleton-two-column"><SkeletonCard><SkeletonText lines={2} />{Array.from({ length: 5 }, (_, index) => <div className="skeleton-list-row" key={index}><SkeletonAvatar /><SkeletonText lines={2} /></div>)}</SkeletonCard><SkeletonCard><SkeletonText lines={2} /><Skeleton className="skeleton-calendar" /></SkeletonCard></section></div>;
}

function QuizSkeleton({ result = false }) {
  return <div className="skeleton-page skeleton-page--quiz">{result ? <><SkeletonCard className="skeleton-result-hero"><SkeletonText lines={3} /><CardGridSkeleton count={3} card="stat" /></SkeletonCard><CardGridSkeleton count={4} card="row" /></> : <><SkeletonCard className="skeleton-question-card"><SkeletonText lines={3} />{Array.from({ length: 4 }, (_, index) => <div className="skeleton-answer" key={index}><Skeleton className="skeleton-radio" /><Skeleton className="skeleton-answer-line" /></div>)}<div className="skeleton-question-actions"><SkeletonButton /><SkeletonButton /></div></SkeletonCard></>}</div>;
}

function DocumentSkeleton() {
  return <div className="skeleton-page skeleton-page--document"><SkeletonCard className="skeleton-document-toolbar"><Skeleton className="skeleton-tool-group" /><Skeleton className="skeleton-tool-group" /><SkeletonButton /></SkeletonCard><SkeletonCard className="skeleton-document-sheet"><Skeleton className="skeleton-document-title" /><SkeletonText lines={6} /><Skeleton className="skeleton-document-image" /><SkeletonText lines={5} /></SkeletonCard></div>;
}

function AdminOverviewSkeleton() {
  const rows = (count) => Array.from({ length: count }, (_, index) => (
    <div className="skeleton-admin-row" key={index}>
      <SkeletonAvatar />
      <SkeletonText lines={2} />
      <Skeleton className="skeleton-admin-count" />
    </div>
  ));
  return <div className="skeleton-page skeleton-admin-overview">
    <SkeletonCard className="skeleton-admin-attention"><div className="skeleton-admin-heading"><Skeleton className="skeleton-admin-title" /><Skeleton className="skeleton-chip" /></div>{rows(5)}</SkeletonCard>
    <SkeletonCard className="skeleton-admin-glance"><Skeleton className="skeleton-admin-title" /><div className="skeleton-admin-stats">{Array.from({ length: 4 }, (_, index) => <div key={index}><Skeleton className="skeleton-admin-label" /><Skeleton className="skeleton-admin-value" /><Skeleton className="skeleton-admin-meta" /></div>)}</div></SkeletonCard>
    <div className="skeleton-admin-secondary">
      <SkeletonCard className="skeleton-admin-health"><Skeleton className="skeleton-admin-title" /><div className="skeleton-admin-stats">{Array.from({ length: 3 }, (_, index) => <div key={index}><Skeleton className="skeleton-admin-label" /><Skeleton className="skeleton-admin-value" /></div>)}</div>{rows(2)}</SkeletonCard>
      <SkeletonCard className="skeleton-admin-chart-card"><div className="skeleton-admin-heading"><SkeletonText lines={2} /><Skeleton className="skeleton-admin-range" /></div><Skeleton className="skeleton-admin-chart" /><Skeleton className="skeleton-admin-chart-meta" /></SkeletonCard>
    </div>
    <SkeletonCard className="skeleton-admin-recent"><Skeleton className="skeleton-admin-title" />{rows(3)}</SkeletonCard>
  </div>;
}

function StandardSkeleton({ variant }) {
  if (variant === "admin-detail") return <div className="skeleton-page"><SkeletonText lines={3} /><SkeletonCard><SkeletonText lines={6} /></SkeletonCard><SkeletonCard><SkeletonText lines={4} /></SkeletonCard></div>;
  if (variant === "admin-list") return <div className="skeleton-page"><SkeletonCard className="skeleton-list-card">{Array.from({ length: 5 }, (_, index) => <div className="skeleton-list-row" key={index}><SkeletonAvatar /><SkeletonText lines={2} /><SkeletonButton /></div>)}</SkeletonCard></div>;
  if (variant === "admin-form") return <div className="skeleton-page"><SkeletonCard><SkeletonText lines={2} />{Array.from({ length: 4 }, (_, index) => <div className="skeleton-list-row" key={index}><SkeletonText lines={2} /><SkeletonButton /></div>)}</SkeletonCard></div>;
  if (variant === "admin-overview") return <AdminOverviewSkeleton />;
  if (variant === "dashboard") return <DashboardSkeleton />;
  if (variant === "profile") return <ProfileSkeleton />;
  if (variant === "progress") return <ProgressSkeleton />;
  if (variant === "quiz") return <QuizSkeleton />;
  if (variant === "result") return <QuizSkeleton result />;
  if (variant === "document") return <DocumentSkeleton />;
  if (variant === "material-list") return <MaterialsListSkeleton />;
  if (variant === "card-list") return <MaterialsListSkeleton sheets />;
  if (variant === "sheet") return <SheetSkeleton />;
  return <div className="skeleton-page skeleton-page--grid"><SkeletonHeader /><CardGridSkeleton count={6} card={variant === "list" ? "row" : "standard"} /></div>;
}

function loadingVariant(pathname) {
  if (/^\/operations\/admin\/(overview|analytics)/.test(pathname)) return "admin-overview";
  if (/^\/operations\/admin\/(settings|system)/.test(pathname)) return "admin-form";
  if (/^\/operations\/admin\//.test(pathname)) return "admin-list";
  if (/^\/(dashboard)?$/.test(pathname)) return "dashboard";
  if (/^\/profile/.test(pathname)) return "profile";
  if (/^\/progress/.test(pathname)) return "progress";
  if (/\/workspace|^\/focus\//.test(pathname)) return "document";
  if (/\/results?\//.test(pathname)) return "result";
  if (/\/attempts?\//.test(pathname)) return "quiz";
  if (/^\/(materials|questions)$/.test(pathname)) return "material-list";
  if (/^\/(notifications|review|bookmarks|community|achievements|subscription|my-group|analysis)/.test(pathname)) return "list";
  return "grid";
}

export function LoadingPanel({ variant = "auto" }) {
  const hasPageIdentity = useContext(PageIdentityContext);
  const location = useLocation();
  const { t } = useI18n();
  const metadata = routeMetadata(location.pathname, t);
  const resolvedVariant = variant === "auto" ? loadingVariant(location.pathname) : variant;
  return (
    <section className={`loading-panel loading-panel--${resolvedVariant}`} aria-label={t("common.loading")} aria-busy="true">
      {!hasPageIdentity && <h1 className="visually-hidden">{metadata.h1}</h1>}
      <StandardSkeleton variant={resolvedVariant} />
    </section>
  );
}

/**
 * The Suspense fallback for a route whose code is still arriving. A chunk from
 * the cache resolves in a frame or two, and flashing a skeleton for that long
 * reads as flicker, so nothing is drawn for the first ~300 ms. Past that (a
 * cold start on a slow connection) the route's own skeleton appears, shaped
 * like the screen that is coming, instead of an empty content area.
 */
export function DeferredLoadingPanel({ delay = 300 }) {
  const [visible, setVisible] = useState(false);
  const location = useLocation();
  const { t } = useI18n();
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  if (!visible) return null;
  // Screens with a large title wait inside the same column under the same
  // title they will show, so the arrival changes only the content.
  const frame = ROUTE_LOADING_FRAMES[location.pathname];
  if (frame) return <Page width={frame.width} title={frame.titleKey ? t(frame.titleKey) : ""} showHeading><LoadingPanel /></Page>;
  return <div className="route-loading-fallback"><LoadingPanel /></div>;
}

/** Routes whose loaded screen opens with a large title (the route's own name
 * unless `titleKey` says otherwise) and the column it sits in. */
const ROUTE_LOADING_FRAMES = {
  "/materials": { width: "reading" },
  "/questions": { width: "reading" },
  "/review": { width: "reading" },
  "/bookmarks": { width: "reading" },
  "/achievements": { width: "reading" },
  "/notifications": { width: "reading" },
  "/analysis": { width: "reading" },
  "/subscription": { width: "reading" },
  "/my-group": { width: "reading" },
  "/progress": { width: "", titleKey: "progress.title" }
};

export function ErrorPanel({ message, onRetry = null }) {
  const hasPageIdentity = useContext(PageIdentityContext);
  const location = useLocation();
  const { t } = useI18n();
  const metadata = routeMetadata(location.pathname, t);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  // Offline, "Network error" is true but useless: say what still works.
  const safeMessage = offline ? t("offline.pageNeedsConnection") : normalizeUserError(message, t("error.default"));
  const materialsHere = location.pathname === "/materials" || location.pathname.startsWith("/materials/");
  return (
    <section className="panel error-panel" role="alert">
      {!hasPageIdentity && <h1 className="visually-hidden">{metadata.h1}</h1>}
      <span className="error-panel-icon" aria-hidden="true"><Icon name="alert-triangle" size={20} /></span>
      <p dir="auto">{safeMessage}</p>
      {offline && !materialsHere && <Link className="btn btn-soft" to="/materials">{t("nav.materials")}</Link>}
      {onRetry && !offline && <button className="btn btn-soft" type="button" onClick={onRetry}>{t("common.tryAgain")}</button>}
    </section>
  );
}

export function NotFoundPage({ variant = "default" }) {
  const { t } = useI18n();
  const materialLink = variant === "material-catalog";
  return (
    <Page title={t("route.notFound")} showHeading>
      <section className="panel error-panel route-not-found" role="status">
        <Icon name="alert-triangle" size={24} />
        <p>{t(materialLink ? "error.materialCatalog" : "error.notFound")}</p>
        <Link className="btn btn-soft" to={materialLink ? "/materials" : "/"}>
          {t(materialLink ? "error.backToMaterials" : "error.backToDashboard")}
        </Link>
      </section>
    </Page>
  );
}

export function SessionConfetti() {
  return (
    <div className="session-confetti" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => <span key={index} style={cssVars({ "--i": index })} />)}
    </div>
  );
}

export {
  Button,
  IconButton,
  MenuItem,
  NavItem,
  RadioGroup,
  RadioOption,
  SegmentedControl,
  SelectableRow,
  Switch,
  Tab,
  TabList,
  ToggleButton,
  ToolbarButton
} from "./interactive.jsx";
