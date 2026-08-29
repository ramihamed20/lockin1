const STREAK_TIER_COLORS = [
  "var(--color-accent)",
  "var(--color-primary)",
  "var(--color-secondary)",
  "var(--color-success)"
];

/** Returns a repeatable 30-day visual tier for a streak length. */
export function getStreakTier(days) {
  const safeDays = Math.max(0, Number(days) || 0);
  const tier = Math.floor(safeDays / 30) % STREAK_TIER_COLORS.length;
  return {
    tier,
    color: STREAK_TIER_COLORS[tier],
    progress: safeDays % 30 === 0 && safeDays > 0 ? 100 : (safeDays % 30) / 30 * 100
  };
}
