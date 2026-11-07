const dateFromKey = key => new Date(`${key}T12:00:00Z`);
const dateKey = date => date.toISOString().slice(0, 10);

/** Calendar evidence is supplied by the server, never by a paged XP ledger. */
export function activityCalendar(calendar, lastQualifiedOn, t, formatDate) {
  if (!calendar || !/^\d{4}-\d{2}-\d{2}$/.test(calendar.today || "") || !/^\d{4}-\d{2}-\d{2}$/.test(calendar.start || "") || !Array.isArray(calendar.qualified_days)) return null;
  const start = dateFromKey(calendar.start);
  const today = dateFromKey(calendar.today);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(today.getTime())) return null;
  const activityDays = new Set(calendar.qualified_days);
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return formatDate(date, { weekday: "short", timeZone: "UTC" });
  });
  let activeDays = 0;
  let elapsedDays = 0;
  const cells = Array.from({ length: 4 }, (_, rowIndex) => ({
    label: t(rowIndex === 0 ? "progress.weekThis" : rowIndex === 1 ? "progress.weekLast" : "progress.weeksAgo", { count: rowIndex }),
    weekdays,
    days: weekdays.map((day, index) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + (3 - rowIndex) * 7 + index);
      const key = dateKey(date);
      const future = key > calendar.today;
      const active = !future && activityDays.has(key);
      if (!future) elapsedDays += 1;
      if (active) activeDays += 1;
      return { day, key, state: future ? "future" : active && key === lastQualifiedOn ? "qualified" : active ? "active" : "empty" };
    })
  }));
  return { cells, weekdays, activeDays, elapsedDays, consistencyRate: elapsedDays ? Math.round(activeDays * 100 / elapsedDays) : 0 };
}
