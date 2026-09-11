import assert from "node:assert/strict";
import test from "node:test";

import { flushAttemptChanges, pendingAttemptChanges, queueAttemptChange } from "../src/workspace/assessment/offlineAttemptQueue.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)) };
}

test("offline quiz changes are owner-scoped, revision-safe, and acknowledged exactly once", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage(), sessionStorage: { getItem: () => JSON.stringify({ id: "student-a" }) } };
  try {
    queueAttemptChange("attempt-1", { kind: "answer", questionId: "q1", selectedOptionIds: ["a"], clientRevision: 1 });
    queueAttemptChange("attempt-1", { kind: "answer", questionId: "q1", selectedOptionIds: ["b"], clientRevision: 2 });
    queueAttemptChange("attempt-1", { kind: "resume", questionPosition: 7, clientRevision: 3 });
    const calls = [];
    const api = { saveAnswer: async (...args) => calls.push(["answer", ...args]), saveResume: async (...args) => calls.push(["resume", ...args]) };
    assert.equal((await flushAttemptChanges("attempt-1", api)).pending, 0);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0][3].selectedOptionIds, ["a"]);
    assert.deepEqual(calls[1][3].selectedOptionIds, ["b"]);
    assert.equal(pendingAttemptChanges("attempt-1").length, 0);
    globalThis.window.sessionStorage = { getItem: () => JSON.stringify({ id: "student-b" }) };
    assert.equal(pendingAttemptChanges("attempt-1").length, 0, "another account cannot read queued work");
  } finally { globalThis.window = previousWindow; }
});
