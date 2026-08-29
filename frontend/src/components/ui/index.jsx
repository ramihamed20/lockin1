import { createContext, useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { usePageTitle } from "../../hooks/usePageTitle.js";
import { normalizeUserError } from "../../lib/errors.js";
import { routeMetadata } from "../../lib/routeMetadata.js";
import { translate } from "../../lib/i18n.js";
import { useI18n } from "../I18nProvider.jsx";
import { cssVars } from "../../lib/utils.js";

/** @type {import("react").Context<boolean>} */
const PageIdentityContext = createContext(false);

export function Page({ title, subtitle = "", children, showHeading = false, headingHandled = false }) {
  usePageTitle(title);
  const location = useLocation();
  const { t } = useI18n();
  const metadata = routeMetadata(location.pathname, t);
  const englishMetadata = routeMetadata(location.pathname, (key) => translate("en", key));
  const resolvedTitle = !title || title === englishMetadata.h1 ? metadata.h1 : title;
  return (
    <PageIdentityContext.Provider value={true}>
      <div className="page">
        {showHeading && <header className="section-heading"><h1 dir="auto">{resolvedTitle}</h1>{subtitle && <p dir="auto">{subtitle}</p>}</header>}
        {!showHeading && !headingHandled && <h1 className="visually-hidden" dir="auto">{resolvedTitle}</h1>}
        {children}
      </div>
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

export function EmptyState({ title, text }) {
  return <article className="empty-state"><Icon name="sparkles" /><h2 dir="auto">{title}</h2><p dir="auto">{text}</p></article>;
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
  return <div className="skeleton-page skeleton-page--dashboard"><CardGridSkeleton count={4} card="stat" /><section className="skeleton-dashboard-layout"><div><SkeletonCard className="skeleton-continue-card"><SkeletonText lines={2} /><Skeleton className="skeleton-progress" /><SkeletonButton /></SkeletonCard><SkeletonCard className="skeleton-list-card"><SkeletonText lines={1} />{Array.from({ length: 3 }, (_, index) => <div className="skeleton-list-row" key={index}><SkeletonAvatar /><SkeletonText lines={2} /></div>)}</SkeletonCard></div><div><SkeletonCard className="skeleton-visual-card"><Skeleton className="skeleton-visual" /></SkeletonCard><SkeletonCard><SkeletonText lines={3} /><SkeletonButton /></SkeletonCard></div></section></div>;
}

function ProfileSkeleton() {
  return <div className="skeleton-page skeleton-page--profile"><section className="skeleton-profile-hero"><SkeletonCard className="skeleton-id-card"><div className="skeleton-id-top"><Skeleton className="skeleton-logo" /><Skeleton className="skeleton-chip" /></div><div className="skeleton-id-body"><SkeletonAvatar className="skeleton-avatar--profile" /><SkeletonText lines={4} /></div><Skeleton className="skeleton-barcode" /></SkeletonCard><SkeletonCard className="skeleton-chart-card"><SkeletonText lines={2} /><Skeleton className="skeleton-chart" /><SkeletonText lines={3} /></SkeletonCard></section><CardGridSkeleton count={4} card="stat" /><section className="skeleton-two-column"><SkeletonCard><SkeletonText lines={2} /><Skeleton className="skeleton-heatmap" /></SkeletonCard><SkeletonCard><SkeletonText lines={4} /></SkeletonCard></section></div>;
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

function StandardSkeleton({ variant }) {
  if (variant === "dashboard") return <DashboardSkeleton />;
  if (variant === "profile") return <ProfileSkeleton />;
  if (variant === "progress") return <ProgressSkeleton />;
  if (variant === "quiz") return <QuizSkeleton />;
  if (variant === "result") return <QuizSkeleton result />;
  if (variant === "document") return <DocumentSkeleton />;
  return <div className="skeleton-page skeleton-page--grid"><SkeletonHeader /><CardGridSkeleton count={6} card={variant === "list" ? "row" : "standard"} /></div>;
}

function loadingVariant(pathname) {
  if (/^\/$/.test(pathname)) return "dashboard";
  if (/^\/profile/.test(pathname)) return "profile";
  if (/^\/progress/.test(pathname)) return "progress";
  if (/\/workspace|^\/focus\//.test(pathname)) return "document";
  if (/\/results?\//.test(pathname)) return "result";
  if (/\/attempts?\//.test(pathname)) return "quiz";
  if (/^\/(notifications|review|bookmarks|community)/.test(pathname)) return "list";
  return "grid";
}

export function LoadingPanel({ variant = "auto" }) {
  const hasPageIdentity = useContext(PageIdentityContext);
  const location = useLocation();
  const { t } = useI18n();
  const metadata = routeMetadata(location.pathname, t);
  const resolvedVariant = variant === "auto" ? loadingVariant(location.pathname) : variant;
  return (
    <section className={`loading-panel loading-panel--${resolvedVariant}`} aria-label="Loading content" aria-busy="true">
      {!hasPageIdentity && <h1 className="visually-hidden">{metadata.h1}</h1>}
      <StandardSkeleton variant={resolvedVariant} />
    </section>
  );
}

export function ErrorPanel({ message, onRetry = null }) {
  const hasPageIdentity = useContext(PageIdentityContext);
  const location = useLocation();
  const { t } = useI18n();
  const metadata = routeMetadata(location.pathname, t);
  const safeMessage = normalizeUserError(message, t("error.default"));
  return (
    <section className="panel error-panel" role="alert">
      {!hasPageIdentity && <h1 className="visually-hidden">{metadata.h1}</h1>}
      <p>{safeMessage}</p>
      {onRetry && <button className="btn btn-soft" type="button" onClick={onRetry}>{t("common.tryAgain")}</button>}
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

export function MiniFeature({ title, text, icon }) {
  return (
    <article className="mini-feature">
      <span className="stat-icon"><Icon name={icon} /></span>
      <div><h2>{title}</h2><p>{text}</p></div>
    </article>
  );
}
