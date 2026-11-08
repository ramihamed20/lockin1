import assert from "node:assert/strict";
import test from "node:test";
import { installOfflineEnvironment, signedLease } from "./helpers/offlineEnvironment.js";
const env = installOfflineEnvironment();
const { rememberPlan, restorePlan, submitPlanProgress } = await import("../src/offline/studyPlan.js");
const { saveVerifiedLease } = await import("../src/offline/lease.js");
const { flushPendingOperations, pendingOfflineOperations } = await import("../src/offline/queue.js");

test("saved plans require the same account, cohort and an active offline lease", async () => {
  const user = { id: "plan-offline", cohort: { id: "dental2" } };
  localStorage.setItem("lock-in.offline-current-user-id", user.id);
  assert.equal(await saveVerifiedLease(user.id, signedLease({ userId: user.id })), true);
  await rememberPlan(user, "exams", { results: [{ id: "owned" }] });
  assert.equal((await restorePlan(user, "exams")).payload.results[0].id, "owned");
  assert.equal(await restorePlan({ ...user, cohort: { id: "other" } }, "exams"), null);
  localStorage.setItem("lock-in.offline-current-user-id", "different-account");
  assert.equal(await restorePlan(user, "exams"), null);
});

test("offline progress uses one retry-safe intent and replays the actual endpoint", async () => {
  const userId = "plan-progress", id = "12345678-1234-4234-8234-123456789abc";
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  assert.equal(await saveVerifiedLease(userId, signedLease({ userId })), true);
  const path = `/study-plan/items/${id}/progress`;
  let offline = true, calls = 0;
  env.route(`POST ${path}`, ({ body }) => {
    if (offline) throw new TypeError("Failed to fetch");
    calls++;
    assert.equal(body.client_request_id, id);
    return { saved: true };
  });
  const body = { client_request_id: id, expected_revision: 1, page_end: 3, minutes: 12 };
  assert.equal((await submitPlanProgress(userId, path, body)).pending, true);
  assert.equal((await pendingOfflineOperations(userId)).length, 1);
  await assert.rejects(submitPlanProgress(userId, path, { ...body, client_request_id: "different" }), error => error.code === "plan_progress_pending");
  offline = false;
  await flushPendingOperations(userId);
  assert.equal(calls, 1);
  assert.deepEqual(await pendingOfflineOperations(userId), []);
});
