import { Icon } from "../../lib/icons.jsx";

export function StatsGrid({ stats, cards: suppliedCards }) {
  const cards = Array.isArray(suppliedCards)
    ? suppliedCards
    : [
      ["Materials", stats?.materialsCompleted ?? "—", "file", "completed"],
      ["Questions", stats?.questionsSolved ?? "—", "help", "solved"],
      ["Accuracy", typeof stats?.accuracy === "number" ? `${stats.accuracy}%` : "—", "check", "correct"],
      ["Due Review", stats?.dueReviewCount || 0, "target", "ready"],
      ["Saved", stats?.savedItems ?? "—", "bookmark", "items"]
    ];
  return (
    <section className="stats-grid">
      {cards.map(([label, value, icon, sub]) => (
        <article className="stat-card" key={label}>
          <span className="stat-icon"><Icon name={icon} /></span>
          <div>
            <strong>{value}</strong>
            <p>{label}<small>{sub}</small></p>
          </div>
        </article>
      ))}
    </section>
  );
}
