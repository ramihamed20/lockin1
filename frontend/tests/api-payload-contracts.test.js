import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, __testing } from "../src/api/client.js";
import { assessmentsApi } from "../src/api/assessments.js";
import { billingApi } from "../src/api/billing.js";
import { communityApi } from "../src/api/community.js";
import { focusApi } from "../src/api/focus.js";
import { educationApi } from "../src/api/learning.js";
import { managementApi } from "../src/api/management.js";
import { motivationApi } from "../src/api/motivation.js";
import { progressApi } from "../src/api/progress.js";

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  __testing.reset();
});

function serve(payload) {
  __testing.reset();
  globalThis.fetch = async () => new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" }
  });
}

const readers = [
  [() => assessmentsApi.listQuizzes(), "The quiz list response was incomplete."],
  [() => billingApi.currentEntitlements(), "The entitlement response was incomplete."],
  [() => communityApi.listDiscussions(), "The discussion list response was incomplete."],
  [() => focusApi.listSessions(), "The Focus session-history response was incomplete."],
  [() => educationApi.listNodes(), "The education-node list response was incomplete."],
  [() => managementApi.listNodes(), "The education-node list response was incomplete."],
  [() => motivationApi.xpSummary(), "The XP summary response was incomplete."],
  [() => progressApi.listBookmarks(), "The bookmark list response was incomplete."]
];

test("API readers retain invalid-response status, payload and endpoint-specific messages", async () => {
  for (const [read, message] of readers) {
    for (const payload of [null, "unexpected", 42]) {
      serve(payload);
      await assert.rejects(read(), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 500);
        assert.equal(error.code, "invalid_response");
        assert.equal(error.message, message);
        assert.deepEqual(error.payload, payload);
        return true;
      });
    }
  }
});

test("numbered pagination remains strict while the XP ledger keeps its optional count", async () => {
  for (const read of [() => assessmentsApi.listQuizzes(), () => focusApi.listSessions(), () => educationApi.listNodes(), () => progressApi.listBookmarks()]) {
    for (const payload of [{ results: [] }, { count: "0", results: [] }, { count: 0, results: {} }]) {
      serve(payload);
      await assert.rejects(read(), (error) => error instanceof ApiError && error.code === "invalid_response");
    }
    serve({ count: 1, results: [{ id: "item" }], next: "?page=2", previous: null });
    assert.deepEqual(await read(), { count: 1, results: [{ id: "item" }], next: "?page=2", previous: null });
  }
  serve({ results: [] });
  assert.deepEqual(await motivationApi.xpLedger(), { count: 0, results: [], next: null, previous: null });
});
