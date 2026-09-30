export function periodLabel(start, end, locale = "en") {
  const first = new Date(start);
  const last = new Date(new Date(end).getTime() - 1);
  const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${formatter.format(first)} – ${formatter.format(last)}`;
}

export function countdownDays(end, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(end).getTime() - now) / 86400000));
}

export function groupHistory(history, locale = "en") {
  const formatter = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const groups = new Map();
  for (const report of history) {
    const month = formatter.format(new Date(new Date(report.period_end).getTime() - 1));
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(report);
  }
  return [...groups].map(([month, reports]) => ({ month, reports }));
}
