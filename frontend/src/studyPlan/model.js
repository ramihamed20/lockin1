export function dateStamp(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function fromStamp(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function addDays(value, count) {
  const date = typeof value === "string" ? fromStamp(value) : new Date(value);
  date.setDate(date.getDate() + count);
  return dateStamp(date);
}

export function weekOf(stamp = dateStamp()) {
  const date = fromStamp(stamp);
  return addDays(stamp, -((date.getDay() + 6) % 7));
}

export function weekDays(start) {
  return Array.from({ length: 7 }, (_, day) => addDays(start, day));
}

export function profileDraft(profile) {
  return {
    mode: profile.mode, daily_minutes: profile.daily_minutes, session_minutes: profile.session_minutes,
    weekdays: [...profile.weekdays], subjects: profile.subjects.join(", "),
    timezone: profile.configured ? profile.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Tripoli"
  };
}

export function profileRequest(draft) {
  return { ...draft, daily_minutes: Number(draft.daily_minutes), session_minutes: Number(draft.session_minutes),
    subjects: draft.subjects.split(/[,،\n]/).map(value => value.trim()).filter(Boolean) };
}
