import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  UPDATE_CHECK_MIN_GAP_MS,
  scheduleUpdateChecks,
  shouldCheckForUpdate
} from "../src/pwa/updateChecks.js";

function fakeEnvironment() {
  const listeners = new Map();
  const target = (name) => ({
    addEventListener: (type, handler) => listeners.set(`${name}:${type}`, handler),
    removeEventListener: (type) => listeners.delete(`${name}:${type}`)
  });
  globalThis.document = { visibilityState: "visible", ...target("document") };
  globalThis.window = { ...target("window"), setInterval: () => 1, clearInterval: () => {} };
  return listeners;
}

test("update checks are throttled", () => {
  assert.equal(shouldCheckForUpdate(null, 1000), true);
  assert.equal(shouldCheckForUpdate(1000, 1000 + UPDATE_CHECK_MIN_GAP_MS - 1), false);
  assert.equal(shouldCheckForUpdate(1000, 1000 + UPDATE_CHECK_MIN_GAP_MS), true);
});

test("returning to the app checks for a new worker, at most once per gap", () => {
  const listeners = fakeEnvironment();
  let clock = 0;
  let updates = 0;
  const registration = { installing: null, waiting: null, update: async () => { updates += 1; } };
  const stop = scheduleUpdateChecks(registration, { now: () => clock });

  listeners.get("document:visibilitychange")();
  assert.equal(updates, 0, "no check right after registration");
  clock += UPDATE_CHECK_MIN_GAP_MS;
  listeners.get("document:visibilitychange")();
  listeners.get("document:visibilitychange")();
  assert.equal(updates, 1);

  clock += UPDATE_CHECK_MIN_GAP_MS;
  registration.waiting = {};
  listeners.get("document:visibilitychange")();
  assert.equal(updates, 1, "a waiting worker is already the update");

  stop();
  assert.equal(listeners.has("document:visibilitychange"), false);
});

test("the lifecycle provider starts update checks on registration", async () => {
  const source = await readFile(new URL("../src/pwa/PwaLifecycleProvider.jsx", import.meta.url), "utf8");
  assert.match(source, /updateChecksRef\.current = scheduleUpdateChecks\(registration\)/);
});
