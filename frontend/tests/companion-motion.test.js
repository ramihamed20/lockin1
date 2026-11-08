import assert from "node:assert/strict";
import test from "node:test";
import { companionMotionReducer as reduce, companionMotionState as state, initialCompanionMotion } from "../src/lib/companionMotion.js";

const event = (type, rest = {}) => ({ type, scope: "page-1", ...rest });

test("opening a question, writing, waiting and closing follow interaction ownership", () => {
  let current = reduce(initialCompanionMotion("page-1"), event("surface", { surface: "idea" }));
  assert.equal(state(current), "thinking");
  current = reduce(current, event("phase", { phase: "speaking" }));
  assert.equal(state(current), "speaking");
  current = reduce(current, event("phase", { phase: "thinking" }));
  assert.equal(state(current), "thinking");
  current = reduce(current, event("surface", { surface: "" }));
  assert.equal(state(current), "settle");
  assert.strictEqual(reduce(current, event("phase", { phase: "speaking" })), current);
  current = reduce(current, event("finish", { token: current.token }));
  assert.equal(state(current), "idle");
});

test("only confirmed saves celebrate and typing continues after a finite celebration", () => {
  let current = reduce(initialCompanionMotion("page-1", "idea"), event("phase", { phase: "speaking" }));
  assert.strictEqual(reduce(current, event("saved", { confirmed: false })), current);
  current = reduce(current, event("saved", { confirmed: true }));
  assert.equal(state(current), "saved");

  current = reduce(current, event("finish", { token: current.token }));
  assert.equal(state(current), "speaking");
});

test("stale page events and superseded cue timers cannot change the current motion", () => {
  let current = initialCompanionMotion("page-1", "idea");
  current = reduce(current, event("saved", { confirmed: true }));
  const oldToken = current.token;
  current = reduce(current, event("surface", { surface: "" }));
  assert.strictEqual(reduce(current, event("finish", { token: oldToken })), current);
  current = reduce(current, { type: "reset", scope: "page-2", surface: "" });
  for (const stale of [event("saved", { confirmed: true }), event("phase", { phase: "speaking" }), event("finish", { token: current.token })]) assert.strictEqual(reduce(current, stale), current);
});
