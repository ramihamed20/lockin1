import assert from "node:assert/strict";
import test from "node:test";
import { selectPageQuestions } from "../src/lib/activeStudyPages.js";
import { pausePomodoroAway, resumeAbandonedPomodoroClock, resumePomodoroBack } from "../src/lib/pomodoroStudy.js";
import { closePomodoroRange, initialPomodoroRanges, newerPomodoroClock, newPomodoroClock, samePomodoroClock, POMODORO_BREAK_MS, POMODORO_FOCUS_MS, POMODORO_LONG_BREAK_MS, pomodoroCycleDots, pomodoroPageScores, pomodoroProgress, pomodoroClockKey, pomodoroClockLabel, pomodoroRemaining, reconcilePomodoroClock, tickPomodoroClock, togglePomodoroClock, validPomodoroClock } from "../src/lib/pomodoroStudy.js";

test("the timer runs only while the student is on the page", () => {
  const start = 1_000_000;
  const running = newPomodoroClock(1, start);
  // Ten minutes read, then the student leaves for an hour and comes back.
  const left = pausePomodoroAway(running, start + 10 * 60_000);
  assert.equal(left.deadline, null);
  assert.equal(left.away, true);
  assert.equal(left.remainingMs, POMODORO_FOCUS_MS - 10 * 60_000);
  const back = resumePomodoroBack(left, start + 70 * 60_000);
  assert.equal(back.away, undefined);
  assert.equal(pomodoroClockLabel(back, start + 70 * 60_000), "15:00");
  // A pause the student chose stays paused when they come back.
  const chosen = togglePomodoroClock(running, start + 60_000);
  assert.equal(pausePomodoroAway(chosen, start + 120_000), chosen);
  assert.equal(resumePomodoroBack(chosen, start + 600_000), chosen);
  // A page closed without saving its pause gets the time it was gone back.
  const abandoned = resumeAbandonedPomodoroClock(running, start + 5 * 60_000, start + 65 * 60_000);
  assert.equal(pomodoroClockLabel(abandoned, start + 65 * 60_000), "20:00");
  assert.equal(resumeAbandonedPomodoroClock(running, start + 5 * 60_000, start + 5 * 60_000 + 3000), running, "a quick reload is not a departure");
});

test("one cycle closes at page seven and the next begins at page eight", () => {
  const initial = initialPomodoroRanges([{ part: 1, start_page: 1, end_page: 5 }, { part: 2, start_page: 6, end_page: 15 }]);
  const closed = closePomodoroRange(initial, { part: 1, end_page: 7, question_count: 40 });
  assert.deepEqual(initial, [{ part: 1, start_page: 1, end_page: 15 }]);
  assert.deepEqual(closed, [{ part: 1, start_page: 1, end_page: 7, question_count: 40 }, { part: 2, start_page: 8, end_page: 15 }]);
  assert.deepEqual(closePomodoroRange(closed, { part: 1, end_page: 7, question_count: 40 }), closed);
  assert.throws(() => closePomodoroRange(closed, { part: 1, end_page: 7, question_count: 10 }), /same Pomodoro/);
  const next = closePomodoroRange(closed, { part: 2, end_page: 15, question_count: 5 });
  assert.equal(next.length, 2);
  assert.equal(next[0], closed[0]);
  assert.equal(next[1].question_count, 5);
});

test("forty questions are unique, evenly distributed and supported by the selected pages", () => {
  const bank = { pages: Array.from({ length: 10 }, (_, page) => ({ page: page + 1,
    questions: Array.from({ length: 20 }, (_, index) => ({ question: `Page ${page + 1}, question ${index}` })) })) };
  const selected = selectPageQuestions(bank, 1, 7, 40);
  const distribution = new Map();
  for (const item of selected) {
    const page = Number(item.source_key.split(":")[1]);
    distribution.set(page, (distribution.get(page) || 0) + 1);
  }
  assert.equal(selected.length, 40);
  assert.equal(new Set(selected.map((item) => item.source_key)).size, 40);
  assert.deepEqual([...distribution.keys()], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(Math.max(...distribution.values()) - Math.min(...distribution.values()), 1);
  for (const choices of [{ part: 1, end_page: 1, question_count: 40 }, { part: 1, end_page: 7, question_count: 41 }, { part: 2, end_page: 7, question_count: 5 }, { part: 1, end_page: 11, question_count: 5 }]) {
    assert.throws(() => closePomodoroRange([{ part: 1, start_page: 1, end_page: 10 }], choices));
  }
});

test("a delayed browser tick or reload expires at the original 25-minute deadline", () => {
  const now = 1_000_000;
  const clock = { ...newPomodoroClock(1, now), endPage: 7 };
  assert.equal(pomodoroClockLabel(clock, now), "25:00");
  assert.equal(pomodoroClockLabel(clock, now + 1_000), "24:59");
  assert.equal(tickPomodoroClock(clock, now + POMODORO_FOCUS_MS - 1), clock);
  const expired = tickPomodoroClock(JSON.parse(JSON.stringify(clock)), now + POMODORO_FOCUS_MS + 100_000);
  assert.equal(expired.phase, "ready");
  assert.equal(expired.endPage, 7);
  assert.equal(expired.deadline, null);
  assert.equal(pomodoroClockLabel(expired, now), "00:00");
  assert.equal(tickPomodoroClock(expired, now + POMODORO_FOCUS_MS * 2), expired);
});

test("pause preserves remaining time and resume never grants a new 25 minutes", () => {
  const now = 1000;
  const clock = newPomodoroClock(3, now);
  const paused = togglePomodoroClock(clock, now + 300_000);
  assert.equal(paused.deadline, null);
  assert.equal(pomodoroRemaining(paused, now + 3_000_000), 1_200_000);
  const resumed = togglePomodoroClock(paused, now + 3_000_000);
  assert.equal(resumed.deadline, now + 3_000_000 + 1_200_000);
  assert.equal(tickPomodoroClock(resumed, resumed.deadline).phase, "ready");
});

test("a five-minute break ends ready for an explicit next cycle", () => {
  const clock = newPomodoroClock(2, 100, "break");
  assert.equal(pomodoroClockLabel(clock, 100), "05:00");
  assert.equal(tickPomodoroClock(clock, 100 + POMODORO_BREAK_MS).phase, "waiting");
  assert.equal(newPomodoroClock(2, 100 + POMODORO_BREAK_MS).remainingMs, POMODORO_FOCUS_MS);
});

test("review stays open before a break; passing or retrying both receive a break without repeated resets", () => {
  const quiz = { ...newPomodoroClock(1, 100), phase: "quiz", deadline: null, remainingMs: 0 };
  const next = { stage: "reading", current_part: 2 };
  assert.equal(reconcilePomodoroClock(quiz, next, 200, true), quiz);
  const breakClock = reconcilePomodoroClock(quiz, next, 300);
  assert.equal(breakClock.phase, "break");
  assert.equal(breakClock.part, 2);
  assert.equal(breakClock.deadline, 300 + POMODORO_BREAK_MS);
  assert.equal(reconcilePomodoroClock(breakClock, next, 500), breakClock);
  const retry = reconcilePomodoroClock(quiz, { stage: "reading", current_part: 1 }, 600);
  assert.equal(retry.phase, "break");
  assert.equal(retry.part, 1);
  const stopped = reconcilePomodoroClock(breakClock, { stage: "checkpoint_result", current_part: 2 }, 700);
  assert.equal(stopped.phase, "quiz");
  assert.equal(stopped.deadline, null);
});

test("timer persistence is account/run scoped and malformed state is rejected", () => {
  const clock = newPomodoroClock(1, 100);
  assert.ok(validPomodoroClock(JSON.parse(JSON.stringify(clock))));
  for (const broken of [null, {}, { ...clock, part: -1 }, { ...clock, phase: "complete" }, { ...clock, deadline: Infinity }, { ...clock, remainingMs: -1 }, { ...clock, endPage: "7" }]) assert.equal(validPomodoroClock(broken), false);
  assert.notEqual(pomodoroClockKey("student-one", "run"), pomodoroClockKey("student-two", "run"));
  assert.notEqual(pomodoroClockKey("student-one", "run"), pomodoroClockKey("student-one", "run-two"));
});

test("every fourth finished page test earns a 15-minute break, once", () => {
  const quiz = { ...newPomodoroClock(4, 100), phase: "quiz", deadline: null, remainingMs: 0 };
  const long = reconcilePomodoroClock(quiz, { stage: "reading", current_part: 5, completed: 4 }, 200);
  assert.equal(long.phase, "break");
  assert.equal(long.long, true);
  assert.equal(long.remainingMs, POMODORO_LONG_BREAK_MS);
  assert.equal(validPomodoroClock(long), true);
  const short = reconcilePomodoroClock(quiz, { stage: "reading", current_part: 5, completed: 3 }, 200);
  assert.equal(short.remainingMs, POMODORO_BREAK_MS);
  const focus = newPomodoroClock(5, 300, "focus", { longAt: long.longAt });
  const retried = reconcilePomodoroClock({ ...focus, phase: "quiz", deadline: null, remainingMs: 0 }, { stage: "reading", current_part: 5, completed: 4 }, 400);
  assert.equal(retried.remainingMs, POMODORO_BREAK_MS);
});

test("page results flag pages under two thirds and leave unpaged reviews alone", () => {
  const review = [{ page: 2, correct: true }, { page: 2, correct: false }, { page: 2, correct: false }, { page: 1, correct: true }, { correct: false }];
  assert.deepEqual(pomodoroPageScores(review), [{ page: 1, correct: 1, total: 1, weak: false }, { page: 2, correct: 1, total: 3, weak: true }]);
  assert.deepEqual(pomodoroPageScores([{ correct: true }]), []);
});

test("the clock bar fills with the phase and the dots count toward the long break", () => {
  const clock = newPomodoroClock(1, 0);
  assert.equal(pomodoroProgress(clock, 0), 0);
  assert.equal(pomodoroProgress(clock, POMODORO_FOCUS_MS / 2), 0.5);
  assert.equal(pomodoroProgress({ ...clock, phase: "ready", deadline: null, remainingMs: 0 }, 0), 1);
  const longBreak = newPomodoroClock(5, 0, "break", { long: true, longAt: 4 });
  assert.equal(pomodoroProgress(longBreak, POMODORO_LONG_BREAK_MS / 4), 0.25);
  assert.equal(pomodoroCycleDots(longBreak, 4), 4);
  assert.equal(pomodoroCycleDots(clock, 6), 2);
  assert.equal(pomodoroCycleDots(clock, undefined), 0);
});

test("a longer preset times every phase, survives validation, and the newest copy wins", () => {
  const deep = newPomodoroClock(1, 0, "focus", { preset: "deep" });
  assert.equal(deep.remainingMs, 50 * 60 * 1000);
  assert.equal(pomodoroClockLabel(deep, 0), "50:00");
  assert.equal(validPomodoroClock(deep), true);
  assert.equal(newPomodoroClock(1, 0, "break", { preset: "deep", long: true }).remainingMs, 30 * 60 * 1000);
  assert.equal(newPomodoroClock(1, 0, "focus", { preset: "nonsense" }).remainingMs, POMODORO_FOCUS_MS);
  assert.equal(validPomodoroClock({ ...deep, preset: "nonsense" }), false);
  const quiz = { ...deep, phase: "quiz", deadline: null, remainingMs: 0 };
  assert.equal(reconcilePomodoroClock(quiz, { stage: "reading", current_part: 2, completed: 1 }, 0).remainingMs, 10 * 60 * 1000);
  const local = { ...deep, updatedAt: 10 };
  const server = { ...deep, phase: "break", updatedAt: 20 };
  assert.equal(newerPomodoroClock(local, server), server);
  assert.equal(newerPomodoroClock({ ...local, updatedAt: 30 }, server).updatedAt, 30);
  assert.equal(newerPomodoroClock(null, server), server);
  assert.equal(newerPomodoroClock(local, { nonsense: true }), local);
  assert.equal(samePomodoroClock(local, { ...local, updatedAt: 99 }), true);
});
