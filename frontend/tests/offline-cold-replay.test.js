import assert from "node:assert/strict";
import test from "node:test";
import { installOfflineEnvironment, signedLease } from "./helpers/offlineEnvironment.js";

// A cold app restores already saved work without loading a reader or Focus API.
const env = installOfflineEnvironment();
const { offlineDatabase } = await import("../src/offline/database.js");
const { saveVerifiedLease } = await import("../src/offline/lease.js");
const { enqueueOperation, pendingOfflineOperations } = await import("../src/offline/queue.js");
const { synchronizeOffline } = await import("../src/offline/coordinator.js");

test("cold replay adopts server IDs for every saved Active Study kind before acknowledging it", async () => {
  const userId = "cold-replay";
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  const lease = signedLease({ userId });
  assert.equal(await saveVerifiedLease(userId, lease), true);
  const saved = [];
  for (const [index, type] of ["active_study_attempt", "active_study_continue", "active_study_restart"].entries()) {
    const key = `sheet-${index}:university:medium`;
    const run = { key, id: `local-${index}`, sheet_id: `sheet-${index}`, server_id: null, xp_awarded: 0, dirty: true };
    await offlineDatabase.putMany(userId, [[`as-run:${key}`, run], [`as-runid:${run.id}`, key]]);
    const operation = await enqueueOperation(userId, { type, entityType: "active_study_run", entityId: key, payload: { run_id: run.id } });
    saved.push({ run, operation });
  }
  let syncCalls = 0;
  const denyRenewal = () => env.json({ error: { code: "subscription_required", message: "Access ended; signed work may still upload" } }, 403);
  env.route("GET /offline/lease/", denyRenewal);
  env.route("POST /offline/sync/", ({ body }) => {
    syncCalls++;
    assert.equal(body.lease_token, lease.token);
    assert.deepEqual(body.operations.map(item => item.operation_type), saved.map(item => item.operation.operation_type));
    assert.ok(body.operations.every(item => item.payload.xp_awarded === undefined));
    return { accepted: body.operations.map((operation, index) => ({ operation_id: operation.operation_id, result: { run: { id: `server-${index}` }, result: { xp_awarded: 7 + index } } })), rejected: [], xp_total: 24 };
  });
  for (const { run } of saved) env.route(`GET /focus/managed-active-study/sheets/${run.sheet_id}`, denyRenewal);
  await synchronizeOffline(userId, () => {}, { force: true });
  assert.equal(syncCalls, 1);
  assert.deepEqual(await pendingOfflineOperations(userId), []);
  for (const [index, { run }] of saved.entries()) {
    const restored = await offlineDatabase.get(userId, `as-run:${run.key}`);
    assert.equal(restored.id, run.id);
    assert.equal(restored.server_id, `server-${index}`);
    assert.equal(restored.xp_awarded, 7 + index);
    assert.equal(await offlineDatabase.get(userId, `as-runid:server-${index}`), run.key);
  }
  await assert.rejects(synchronizeOffline(userId, () => {}, { force: true }));
  assert.equal(syncCalls, 1, "an acknowledged attempt is never sent or rewarded twice");
});
