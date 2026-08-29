import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

const DEFAULT_VARIANTS = ["emerald", "indigo", "rose", "amber", "cyan"];

export function StatsGrid({ stats = null, cards: suppliedCards = null, className = "" }) {
  const { t } = useI18n();
  const rawCards = Array.isArray(suppliedCards)
    ? suppliedCards
    : [
      [t("stats.materials"), stats?.materialsCompleted ?? "—", "file", t("stats.materialsSub")],
      [t("stats.questions"), stats?.questionsSolved ?? "—", "help", t("stats.questionsSub")],
      [t("stats.accuracy"), typeof stats?.accuracy === "number" ? `${stats.accuracy}%` : "—", "check", t("stats.accuracySub")],
      [t("stats.dueReview"), stats?.dueReviewCount || 0, "target", t("stats.dueReviewSub")],
      [t("stats.saved"), stats?.savedItems ?? "—", "bookmark", t("stats.savedSub")]
    ];

  const handleMouseMove = (e) => {
    // Touch browsers can synthesize compatibility mouse events after a tap.
    // The spotlight is a desktop-only affordance, so avoid a synchronous
    // layout read on Android/iOS where it is never visible.
    if (typeof window === "undefined" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    e.currentTarget.style.setProperty("--mouse-x", `${x.toFixed(1)}%`);
    e.currentTarget.style.setProperty("--mouse-y", `${y.toFixed(1)}%`);
  };

  return (
    <section className={`stats-grid ${className}`.trim()} aria-label={t("stats.summary")}>
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
                <strong className="stat-card-value" dir="auto">{value}</strong>
                {badge && (
                  <span className={`stat-card-badge ${pulse ? "pulse" : ""}`.trim()}>
                    <span className="badge-dot" aria-hidden="true" />
                    {badge}
                  </span>
                )}
              </div>
              <div className="stat-card-meta">
                <span className="stat-card-label" dir="auto">{label}</span>
                {sub && <small className="stat-card-sub" dir="auto">{sub}</small>}
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
                aria-label={actionLabel || t("stats.openCard", { label, value, sub: sub || "" })}
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
