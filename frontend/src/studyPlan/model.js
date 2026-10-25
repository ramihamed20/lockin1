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

export const MAX_SUBJECTS = 12;
// Monday-first indexes. Friday is the weekend for most of our students, so a
// new plan leaves it free; the student can still tick it.
export const DEFAULT_STUDY_DAYS = [0, 1, 2, 3, 5, 6];
export const QUICK_MINUTES = [15, 25, 45, 60];
export const QUICK_TITLES = ["plan.typeRead", "plan.typeQuestions", "plan.typeReview", "plan.typeSummary"];

const subjectKey = value => value.trim().toLocaleLowerCase();

export function parseSubjects(text) {
  return text.split(/[,،\n]/).map(value => value.trim()).filter(Boolean);
}

/** Keeps the first spelling of each subject, ignoring case, up to the server's limit. */
export function mergeSubjects(...lists) {
  const seen = new Set();
  const result = [];
  for (const value of lists.flat()) {
    const key = subjectKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value.trim());
  }
  return result.slice(0, MAX_SUBJECTS);
}

export function hasSubject(list, value) {
  return list.some(item => subjectKey(item) === subjectKey(value));
}

export function toggleSubject(list, value) {
  return hasSubject(list, value) ? list.filter(item => subjectKey(item) !== subjectKey(value)) : mergeSubjects(list, [value]);
}

/** The student's catalog material whose title is this subject, if any. */
export function materialFor(subject, materials = []) {
  if (!subject) return null;
  return materials.find(material => material?.title && subjectKey(material.title) === subjectKey(subject)) || null;
}

export function weekProgress(summary) {
  const total = summary?.planned_minutes || 0;
  const done = summary?.completed_minutes || 0;
  return { done, total, percent: total ? Math.min(100, Math.round(done / total * 100)) : 0 };
}

export function dayState(items, stamp) {
  const day = items.filter(item => item.scheduled_date === stamp);
  if (!day.length) return "empty";
  return day.every(item => item.status === "completed") ? "done" : "planned";
}

export function profileDraft(profile) {
  return {
    mode: profile.mode, daily_minutes: profile.daily_minutes, session_minutes: profile.session_minutes,
    weekdays: profile.configured ? [...profile.weekdays] : [...DEFAULT_STUDY_DAYS],
    subjectList: [...profile.subjects], subjects: "",
    timezone: profile.configured ? profile.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Tripoli"
  };
}

/** `subjects` is the free-text box; anything still typed there is saved too. */
export function profileRequest(draft) {
  const { subjectList = [], ...rest } = draft;
  return { ...rest, daily_minutes: Number(draft.daily_minutes), session_minutes: Number(draft.session_minutes),
    subjects: mergeSubjects(subjectList, parseSubjects(draft.subjects || "")) };
}

/** Refresh untouched fields from the server while preserving the student's edits. */
export function rebaseTaskDraft(draft, previous, latest) {
  const fields = { title: "title", subject: "subject", scheduledDate: "scheduled_date", durationMinutes: "duration_minutes" };
  const next = { ...draft };
  for (const [local, remote] of Object.entries(fields)) {
    if (String(draft[local]) === String(previous[remote])) next[local] = latest[remote];
  }
  return next;
}
