export const POMODORO_FOCUS_MS = 25 * 60 * 1000;
export const POMODORO_BREAK_MS = 5 * 60 * 1000;
export const POMODORO_MAX_QUESTIONS = 40;

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
  const capacity = Math.min(POMODORO_MAX_QUESTIONS, (endPage - range.start_page + 1) * 20);
  if (!Number.isInteger(count) || count < 1 || count > capacity) throw new Error(`Choose between 1 and ${capacity} questions for these pages.`);
  if (range.question_count != null) {
    if (endPage !== range.end_page || count !== range.question_count) throw new Error("A retry keeps the same Pomodoro pages and questions.");
    return ranges;
  }
  return [...ranges.slice(0, part - 1), { ...range, end_page: endPage, question_count: count },
    ...(endPage < range.end_page ? [{ part: part + 1, start_page: endPage + 1, end_page: range.end_page }] : [])];
}

export const pomodoroClockKey = (userId, runId) => `lock-in.pomodoro.${encodeURIComponent(userId)}.${encodeURIComponent(runId)}`;

export function newPomodoroClock(part, now, phase = "focus") {
  const duration = phase === "break" ? POMODORO_BREAK_MS : POMODORO_FOCUS_MS;
  return { version: 1, part, phase, deadline: now + duration, remainingMs: duration, endPage: null };
}

export function reconcilePomodoroClock(clock, run, now, blocked = false) {
  if (run.stage !== "reading") return clock.phase === "quiz" && clock.part === run.current_part
    ? clock : { ...clock, phase: "quiz", part: run.current_part, deadline: null, remainingMs: 0 };
  // Finishing a test earns a break before either new pages or studying the same pages again.
  if (blocked) return clock;
  if (clock.part < run.current_part || clock.phase === "quiz") return newPomodoroClock(run.current_part, now, "break");
  if (clock.part > run.current_part) return newPomodoroClock(run.current_part, now);
  return clock;
}

export function validPomodoroClock(value) {
  return Boolean(value && value.version === 1 && Number.isInteger(value.part) && value.part > 0
    && ["focus", "break", "waiting", "ready", "quiz"].includes(value.phase)
    && (value.deadline === null || Number.isFinite(value.deadline))
    && Number.isFinite(value.remainingMs) && value.remainingMs >= 0 && value.remainingMs <= POMODORO_FOCUS_MS
    && (value.endPage === null || (Number.isInteger(value.endPage) && value.endPage > 0)));
}

export function pomodoroRemaining(clock, now) {
  return Math.max(0, Math.min(POMODORO_FOCUS_MS, clock.deadline === null ? clock.remainingMs : clock.deadline - now));
}

export function tickPomodoroClock(clock, now) {
  if (!["focus", "break"].includes(clock.phase) || pomodoroRemaining(clock, now) > 0) return clock;
  return { ...clock, phase: clock.phase === "focus" ? "ready" : "waiting", deadline: null, remainingMs: 0 };
}

export function togglePomodoroClock(clock, now) {
  if (!["focus", "break"].includes(clock.phase)) return clock;
  const remainingMs = pomodoroRemaining(clock, now);
  return tickPomodoroClock({ ...clock, remainingMs, deadline: clock.deadline === null ? now + remainingMs : null }, now);
}

export function pomodoroClockLabel(clock, now) {
  const seconds = Math.ceil(pomodoroRemaining(clock, now) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
