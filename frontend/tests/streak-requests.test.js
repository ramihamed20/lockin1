import assert from "node:assert/strict";
import test from "node:test";
import { motivationApi } from "../src/api/motivation.js";
import { __testing } from "../src/api/client.js";

const originalFetch = globalThis.fetch;
const respond = (currentDays) => new Response(JSON.stringify({ current_days: currentDays }),
  { headers: { "content-type": "application/json" } });
test.afterEach(() => { globalThis.fetch = originalFetch; __testing.reset(); });

test("overlapping streak reads share a request but a settled result is fetched again", async () => {
  const scope = { id: "student" };
  const responses = [];
  globalThis.fetch = () => new Promise(resolve => responses.push(resolve));
  const first = motivationApi.streakSummary({ scope });
  const second = motivationApi.streakSummary({ scope });
  assert.equal(responses.length, 1);
  responses[0](respond(7));
  assert.deepEqual(await Promise.all([first, second]), [{ current_days: 7 }, { current_days: 7 }]);
  const fresh = motivationApi.streakSummary({ scope });
  assert.equal(responses.length, 2);
  responses[1](respond(8));
  assert.deepEqual(await fresh, { current_days: 8 });
});

test("another account and a new session for the same account do not reuse a pending read", async () => {
  const responses = [];
  globalThis.fetch = () => new Promise(resolve => responses.push(resolve));
  const reads = [{ id: "one" }, { id: "two" }, { id: "one" }].map(scope => motivationApi.streakSummary({ scope }));
  assert.equal(responses.length, 3);
  responses.forEach((resolve, index) => resolve(respond(index + 1)));
  assert.deepEqual(await Promise.all(reads), [{ current_days: 1 }, { current_days: 2 }, { current_days: 3 }]);
});

test("progress refresh bypasses a pending read and its older completion cannot remove the fresh read", async () => {
  const scope = { id: "student" };
  const responses = [];
  globalThis.fetch = () => new Promise(resolve => responses.push(resolve));
  const old = motivationApi.streakSummary({ scope });
  const forced = motivationApi.streakSummary({ scope, force: true });
  const fresh = motivationApi.streakSummary({ scope });
  assert.equal(responses.length, 3);
  responses[0](respond(1));
  await old;
  const shared = motivationApi.streakSummary({ scope });
  assert.equal(responses.length, 3);
  responses[1](respond(2));
  responses[2](respond(3));
  assert.deepEqual(await Promise.all([forced, fresh, shared]), [{ current_days: 2 }, { current_days: 3 }, { current_days: 3 }]);
});

test("a failed response reaches each consumer and a subsequent read retries", async () => {
  const scope = { id: "student" };
  let calls = 0;
  // Invalid object payloads must still use the existing API error contract.
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response("null", { headers: { "content-type": "application/json" } }) : respond(9);
  };
  const failed = await Promise.allSettled([motivationApi.streakSummary({ scope }), motivationApi.streakSummary({ scope })]);
  assert.equal(calls, 1);
  assert.ok(failed.every(result => result.status === "rejected" && result.reason.code === "invalid_response"));
  assert.deepEqual(await motivationApi.streakSummary({ scope }), { current_days: 9 });
  assert.equal(calls, 2);
});
