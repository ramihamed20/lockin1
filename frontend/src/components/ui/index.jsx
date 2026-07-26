import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { usePageTitle } from "../../hooks/usePageTitle.js";

export function Page({ title, subtitle, children, showHeading = false }) {
  usePageTitle(title);
  return (
    <div className="page">
      {showHeading && <header className="section-heading"><h2>{title}</h2><p>{subtitle}</p></header>}
      {children}
    </div>
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
      <div><h2>{title}</h2><p>{meta}</p></div>
      {action || <Icon name="chevron-right" size={18} />}
    </article>
  );
}

export function EmptyState({ title, text }) {
  return <article className="empty-state"><Icon name="sparkles" /><h2>{title}</h2><p>{text}</p></article>;
}

export function LoadingPanel() {
  return (
    <section className="panel loading-panel" aria-label="Loading content" aria-busy="true">
      <div className="loading-orb" />
      <div className="loading-copy">
        <span />
        <span />
      </div>
      <div className="loading-skeleton-grid" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}

export function ErrorPanel({ message, onRetry }) {
  return (
    <section className="panel error-panel" role="alert">
      <p>{message}</p>
      {onRetry && <button className="btn btn-soft" type="button" onClick={onRetry}>Try again</button>}
    </section>
  );
}

export function SessionConfetti() {
  return (
    <div className="session-confetti" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => <span key={index} style={{ "--i": index }} />)}
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

export function BreadcrumbBar({ items, current }) {
  return (
    <nav className="breadcrumb-bar" aria-label="Breadcrumb">
      {items.map(([label, path]) => (
        <Link key={`${label}-${path}`} to={path}>
          {label}
        </Link>
      ))}
      <span aria-current="page">{current}</span>
    </nav>
  );
}
