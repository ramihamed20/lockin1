import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";

const DEFAULT_VARIANTS = ["emerald", "indigo", "rose", "amber", "cyan"];

export function StatsGrid({ stats, cards: suppliedCards, className = "" }) {
  const rawCards = Array.isArray(suppliedCards)
    ? suppliedCards
    : [
      ["Materials", stats?.materialsCompleted ?? "—", "file", "completed"],
      ["Questions", stats?.questionsSolved ?? "—", "help", "solved"],
      ["Accuracy", typeof stats?.accuracy === "number" ? `${stats.accuracy}%` : "—", "check", "correct"],
      ["Due Review", stats?.dueReviewCount || 0, "target", "ready"],
      ["Saved", stats?.savedItems ?? "—", "bookmark", "items"]
    ];

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    e.currentTarget.style.setProperty("--mouse-x", `${x.toFixed(1)}%`);
    e.currentTarget.style.setProperty("--mouse-y", `${y.toFixed(1)}%`);
  };

  return (
    <section className={`stats-grid ${className}`.trim()} aria-label="Study summary">
      {rawCards.map((entry, index) => {
        const card = Array.isArray(entry)
          ? { label: entry[0], value: entry[1], icon: entry[2], sub: entry[3] }
          : entry;
        
        const { label, value, icon, sub, to, actionLabel, variant, badge, pulse } = card;
        const cardVariant = variant || DEFAULT_VARIANTS[index % DEFAULT_VARIANTS.length];

        const cardContent = (
          <>
            <div className="stat-card-spotlight" aria-hidden="true" />
            <span className="stat-icon">
              <Icon name={icon} />
            </span>
            <div className="stat-card-copy">
              <div className="stat-card-top-row">
                <strong className="stat-card-value">{value}</strong>
                {badge && (
                  <span className={`stat-card-badge ${pulse ? "pulse" : ""}`.trim()}>
                    <span className="badge-dot" aria-hidden="true" />
                    {badge}
                  </span>
                )}
              </div>
              <div className="stat-card-meta">
                <span className="stat-card-label">{label}</span>
                {sub && <small className="stat-card-sub">{sub}</small>}
              </div>
            </div>

            {to && (
              <span className="stat-card-chevron" aria-hidden="true">
                <Icon name="chevron-right" size={14} />
              </span>
            )}
          </>
        );

        const cardClasses = `stat-card stat-card--${cardVariant} ${to ? "stat-card--interactive" : ""}`.trim();

        return (
          <article
            className={cardClasses}
            key={label}
            onMouseMove={handleMouseMove}
          >
            {to ? (
              <Link
                className="stat-card-action"
                to={to}
                aria-label={actionLabel || `Open ${label}: ${value} ${sub || ""}`}
              >
                {cardContent}
              </Link>
            ) : (
              <div className="stat-card-static">{cardContent}</div>
            )}
          </article>
        );
      })}
    </section>
  );
}

