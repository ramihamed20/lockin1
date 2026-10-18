import { QUESTIONS_PER_PAGE } from "./activeStudyPages.js";

export const POMODORO_FOCUS_MS = 25 * 60 * 1000;
export const POMODORO_BREAK_MS = 5 * 60 * 1000;
export const POMODORO_LONG_BREAK_MS = 15 * 60 * 1000;
/** Every fourth finished page test earns the long break. */
export const POMODORO_LONG_BREAK_EVERY = 4;
export const POMODORO_MAX_QUESTIONS = 40;
const MINUTE = 60 * 1000;
/** Timer lengths in minutes; mirrored by focus.pomodoro.PRESETS on the server. */
export const POMODORO_PRESETS = {
  classic: { focus: 25, break: 5, long: 15 },
  extended: { focus: 45, break: 10, long: 20 },
  deep: { focus: 50, break: 10, long: 30 }
};
const LONGEST_MS = Math.max(...Object.values(POMODORO_PRESETS).flatMap((item) => [item.focus, item.break, item.long])) * MINUTE;
const PRESET_KEY = "lock-in.pomodoro.preset";
const SOUND_KEY = "lock-in.pomodoro.sound";

export const pomodoroPreset = (name) => POMODORO_PRESETS[name] ? name : "classic";

/** This device's choice for new cycles; a running clock keeps its own length. */
export function readPomodoroPreferences() {
  try {
    return { preset: pomodoroPreset(window.localStorage.getItem(PRESET_KEY)), sound: window.localStorage.getItem(SOUND_KEY) !== "off" };
  } catch {
    return { preset: "classic", sound: true };
  }
}

export function writePomodoroPreferences({ preset, sound }) {
  try {
    if (preset) window.localStorage.setItem(PRESET_KEY, pomodoroPreset(preset));
    if (typeof sound === "boolean") window.localStorage.setItem(SOUND_KEY, sound ? "on" : "off");
  } catch { /* Preferences stay at their defaults without storage. */ }
}

export function initialPomodoroRanges(ranges) {
  return [{ part: 1, start_page: ranges[0].start_page, end_page: ranges.at(-1).end_page }];
}

/**
 * Mirrors focus.pomodoro.close_range; closed cycles never change on retry.
 * @param {Array<{part: number, start_page: number, end_page: number, question_count?: number}>} ranges
 * @param {{part?: number, end_page?: number, question_count?: number}} choices
 */
export function closePomodoroRange(ranges, { part, end_page: endPage, question_count: count }) {
  if (!Number.isInteger(part) || part < 1 || part > ranges.length) throw new Error("This Pomodoro cycle is no longer current. Resume the saved session.");
  const range = ranges[part - 1];
  if (!Number.isInteger(endPage) || endPage < range.start_page || endPage > range.end_page) throw new Error("Choose a page in the current Pomodoro reading range.");
  const capacity = Math.min(POMODORO_MAX_QUESTIONS, (endPage - range.start_page + 1) * QUESTIONS_PER_PAGE);
  if (!Number.isInteger(count) || count < 1 || count > capacity) throw new Error(`Choose between 1 and ${capacity} questions for these pages.`);
  if (range.question_count != null) {
    if (endPage !== range.end_page || count !== range.question_count) throw new Error("A retry keeps the same Pomodoro pages and questions.");
    return ranges;
  }
  return [...ranges.slice(0, part - 1), { ...range, end_page: endPage, question_count: count },
    ...(endPage < range.end_page ? [{ part: part + 1, start_page: endPage + 1, end_page: range.end_page }] : [])];
}

export const pomodoroClockKey = (userId, runId) => `lock-in.pomodoro.${encodeURIComponent(userId)}.${encodeURIComponent(runId)}`;

/**
 * `longAt` remembers the last long break so a retried part cannot earn it twice;
 * `preset` picks the timer length.
 */
export function newPomodoroClock(part, now, phase = "focus", { long = false, longAt = 0, preset = "classic" } = {}) {
  const name = pomodoroPreset(preset);
  const duration = pomodoroPhaseMs({ phase, long, preset: name });
  return { version: 1, part, phase, deadline: now + duration, remainingMs: duration, endPage: null, ...(name !== "classic" ? { preset: name } : {}), ...(long ? { long: true } : {}), ...(longAt ? { longAt } : {}) };
}

/** Of this device's clock and the server's copy, the one changed last wins. */
export function newerPomodoroClock(local, server) {
  if (!validPomodoroClock(server)) return local;
  if (!validPomodoroClock(local)) return server;
  return (server.updatedAt || 0) > (local.updatedAt || 0) ? server : local;
}

/** Equal clocks apart from when they were saved need no new save. */
export const samePomodoroClock = (a, b) => JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });

export function earnsLongBreak(clock, completed) {
  return Number.isInteger(completed) && completed > 0 && completed % POMODORO_LONG_BREAK_EVERY === 0 && completed > (clock.longAt || 0);
}

export function reconcilePomodoroClock(clock, run, now, blocked = false) {
  if (run.stage !== "reading") return clock.phase === "quiz" && clock.part === run.current_part
    ? clock : { ...clock, phase: "quiz", part: run.current_part, deadline: null, remainingMs: 0 };
  // Finishing a test earns a break before either new pages or studying the same pages again.
  if (blocked) return clock;
  if (clock.part < run.current_part || clock.phase === "quiz") {
    const long = earnsLongBreak(clock, run.completed);
    return newPomodoroClock(run.current_part, now, "break", { long, longAt: long ? run.completed : clock.longAt, preset: clock.preset });
  }
  if (clock.part > run.current_part) return newPomodoroClock(run.current_part, now, "focus", { longAt: clock.longAt, preset: clock.preset });
  return clock;
}

export function validPomodoroClock(value) {
  return Boolean(value && value.version === 1 && Number.isInteger(value.part) && value.part > 0
    && ["focus", "break", "waiting", "ready", "quiz"].includes(value.phase)
    && (value.deadline === null || Number.isFinite(value.deadline))
    && Number.isFinite(value.remainingMs) && value.remainingMs >= 0 && value.remainingMs <= LONGEST_MS
    && (value.preset === undefined || Boolean(POMODORO_PRESETS[value.preset]))
    && (value.endPage === null || (Number.isInteger(value.endPage) && value.endPage > 0)));
}

export function pomodoroRemaining(clock, now) {
  return Math.max(0, Math.min(pomodoroPhaseMs(clock), clock.deadline === null ? clock.remainingMs : clock.deadline - now));
}

export function tickPomodoroClock(clock, now) {
  if (!["focus", "break"].includes(clock.phase) || pomodoroRemaining(clock, now) > 0) return clock;
  return { ...clock, phase: clock.phase === "focus" ? "ready" : "waiting", deadline: null, remainingMs: 0 };
}

export function togglePomodoroClock(clock, now) {
  if (!["focus", "break"].includes(clock.phase)) return clock;
  const { away: _away, ...rest } = clock;
  const remainingMs = pomodoroRemaining(rest, now);
  return tickPomodoroClock({ ...rest, remainingMs, deadline: rest.deadline === null ? now + remainingMs : null }, now);
}

/**
 * The timer runs only while the student is on the page. Leaving stops it and
 * marks it `away`, so coming back starts it again; a pause the student chose
 * themselves is left alone.
 */
export function pausePomodoroAway(clock, now) {
  if (!["focus", "break"].includes(clock.phase) || clock.deadline === null) return clock;
  const paused = togglePomodoroClock(clock, now);
  return paused.deadline === null && ["focus", "break"].includes(paused.phase) ? { ...paused, away: true } : paused;
}

export function resumePomodoroBack(clock, now) {
  if (!clock.away) return clock;
  return togglePomodoroClock(clock, now);
}

/**
 * A page closed before it could save its pause leaves a running deadline. The
 * time since the page was last seen did not count, so the deadline moves on by it.
 */
export function resumeAbandonedPomodoroClock(clock, lastSeen, now) {
  if (!["focus", "break"].includes(clock.phase) || clock.deadline === null || !lastSeen) return clock;
  const gone = now - lastSeen;
  if (gone <= ABANDONED_AFTER_MS || clock.deadline <= lastSeen) return clock;
  return { ...clock, deadline: clock.deadline + gone };
}

const ABANDONED_AFTER_MS = 15 * 1000;

/** The full length of the clock's current phase, so the bar can show how much has gone. */
export function pomodoroPhaseMs(clock) {
  const lengths = POMODORO_PRESETS[pomodoroPreset(clock.preset)];
  return (clock.phase === "break" ? (clock.long ? lengths.long : lengths.break) : lengths.focus) * MINUTE;
}

export function pomodoroProgress(clock, now) {
  if (!["focus", "break"].includes(clock.phase)) return clock.phase === "ready" ? 1 : 0;
  return Math.min(1, Math.max(0, 1 - pomodoroRemaining(clock, now) / pomodoroPhaseMs(clock)));
}

/** Filled dots on the way to the long break; the long break itself shows all four. */
export function pomodoroCycleDots(clock, completed) {
  if (clock.phase === "break" && clock.long) return POMODORO_LONG_BREAK_EVERY;
  return Number.isInteger(completed) ? completed % POMODORO_LONG_BREAK_EVERY : 0;
}

export function pomodoroClockLabel(clock, now) {
  const seconds = Math.ceil(pomodoroRemaining(clock, now) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Groups graded questions by page; a page under two-thirds correct is flagged to be read again. */
export function pomodoroPageScores(review) {
  const pages = new Map();
  for (const item of Array.isArray(review) ? review : []) {
    if (!Number.isInteger(item.page)) continue;
    const entry = pages.get(item.page) || { page: item.page, correct: 0, total: 0 };
    entry.total += 1;
    if (item.correct) entry.correct += 1;
    pages.set(item.page, entry);
  }
  return [...pages.values()].sort((a, b) => a.page - b.page).map((entry) => ({ ...entry, weak: entry.correct * 3 < entry.total * 2 }));
}
