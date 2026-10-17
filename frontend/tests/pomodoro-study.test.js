import assert from "node:assert/strict";
import test from "node:test";
import { selectPageQuestions } from "../src/lib/activeStudyPages.js";
import { closePomodoroRange, initialPomodoroRanges, newPomodoroClock, POMODORO_BREAK_MS, POMODORO_FOCUS_MS, pomodoroClockKey, pomodoroClockLabel, pomodoroRemaining, reconcilePomodoroClock, tickPomodoroClock, togglePomodoroClock, validPomodoroClock } from "../src/lib/pomodoroStudy.js";

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
