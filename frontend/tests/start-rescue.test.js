import assert from "node:assert/strict";
import test from "node:test";
import { createRescueClock, proposeRescue, recoverRescue, sameRescueSource } from "../src/rescue/model.js";
import { createRescueStore } from "../src/rescue/storage.js";
import { CURRENT_USER_KEY, invalidateOfflineSession } from "../src/offline/sessionScope.js";

const source = { catalog_document_id: "doc", learning_object_version_id: "v1", managed_file_id: "file", edition: "university", page_start: 1, page_end: 1, task_type: "read" };
function clock() {
  let tick = 0, wall = "2026-10-14T12:00:00Z";
  const record = proposeRescue("a", source);
  const timer = createRescueClock(record, { tick: () => tick, wall: () => wall });
  return { timer, advance: (ms) => { tick += ms; }, setWall: (value) => { wall = value; } };
}
test("the optional target supports immediate stop, pause and continuation without task credit", () => {
  const { timer, advance, setWall } = clock();
  timer.transition("start"); advance(1500); timer.sample();
  timer.transition("pause", "user_pause"); advance(3600000);
  assert.equal(timer.sample().active_duration_seconds, 1.5);
  setWall("2026-10-14T13:00:02Z");
  timer.transition("resume"); advance(500);
  const result = timer.transition("continue", "continue");
  assert.equal(result.active_duration_seconds, 2);
  assert.equal(result.status, "continued");
  assert.equal(result.continued_into_study_session_id, null);
  advance(5000); assert.deepEqual(timer.sample(), result);
  assert.equal("learned" in result, false); assert.equal("xp" in result, false);
  const immediate = clock().timer.transition("stop", "user_stop");
  assert.equal(immediate.active_duration_seconds, 0);
});
test("wall clock changes and background gaps do not manufacture foreground time", () => {
  const { timer, advance, setWall } = clock();
  timer.transition("start"); advance(1000); timer.sample();
  setWall("2020-01-01T00:00:00Z"); advance(1000);
  assert.equal(timer.sample().active_duration_seconds, 2);
  advance(60000);
  assert.equal(timer.sample().active_duration_seconds, 2);
  assert.equal(timer.sample().status, "paused");
  assert.equal(timer.sample().exit_reason, "interrupted");
});
test("target completion pauses for a choice and never continues or marks learning itself", () => {
  const { timer, advance } = clock();
  timer.transition("start");
  for (let i = 0; i < 180; i++) { advance(1000); timer.sample(); }
  const record = timer.sample();
  assert.equal(record.status, "paused"); assert.equal(record.ended_at, null);
  assert.equal(record.active_duration_seconds, 180);
  assert.equal(timer.transition("resume").status, "paused");
  assert.equal(timer.transition("finish", "enough_today").status, "finished");
});
test("recovery pauses recorded activity and keeps the original source identity", () => {
  const record = { ...proposeRescue("a", source), status: "active", active_duration_seconds: 12 };
  const recovered = recoverRescue(record);
  assert.equal(recovered.active_duration_seconds, 12); assert.equal(recovered.status, "paused");
  assert.ok(sameRescueSource(recovered, source));
  assert.equal(sameRescueSource(recovered, { ...source, learning_object_version_id: "v2" }), false);
});

function storage(api = {}) {
  const scope = new Map([[CURRENT_USER_KEY, "a"]]);
  globalThis.localStorage = { getItem: (key) => scope.get(key) ?? null, setItem: (key, value) => scope.set(key, String(value)) };
  const records = new Map();
  const db = {
    get: async (_user, key) => globalThis.structuredClone(records.get(key)),
    updateEntriesScoped: async (_user, key, update, check) => {
      check(); const result = update(globalThis.structuredClone(records.get(key)));
      records.set(key, globalThis.structuredClone(result.value));
      for (const [id, value] of result.entries) records.set(id, globalThis.structuredClone(value));
      return globalThis.structuredClone(result.value);
    },
  };
  const store = createRescueStore("a", api, db);
  return { store, records, scope, db };
}
test("local sessions and sync intent are atomic, revision fenced, and single per account", async () => {
  const { store, records, db } = storage();
  const first = proposeRescue("a", source);
  await store.save(first);
  assert.ok(records.get(`operation:${first.id}`));
  assert.equal((await createRescueStore("a", {}, db).current()).record.id, first.id);
  await assert.rejects(store.save({ ...first, status: "active" }, 0), { code: "rescue_conflict" });
  await assert.rejects(store.save(proposeRescue("a", source)), { code: "rescue_conflict" });
  await store.save({ ...first, status: "stopped", ended_at: "2026-10-14T12:00:00Z" }, 1);
  const second = proposeRescue("a", source);
  await store.save(second);
  assert.ok(records.get("rescue:state").sessions[first.id]);
});
test("a lost acknowledgement reuses the frozen mutation and preserves later edits", async () => {
  const bodies = [];
  const { store } = storage({ save: async (_id, body) => {
    bodies.push(body);
    if (bodies.length === 1) throw Object.assign(new Error("offline"), { status: 0 });
    return { sync_revision: bodies.length - 1 };
  } });
  const record = proposeRescue("a", source);
  await store.save(record); await assert.rejects(store.sync(record.id));
  await store.save({ ...record, status: "active", started_at: "2026-10-14T12:00:00Z" }, 1);
  const acknowledged = await store.sync(record.id);
  assert.deepEqual(bodies[0], bodies[1]); assert.equal(acknowledged.dirty, true);
  assert.equal(acknowledged.record.status, "active");
  await store.sync(record.id);
  assert.equal(bodies[2].expected_revision, 1);
  assert.notEqual(bodies[2].device_mutation_id, bodies[0].device_mutation_id);
});
test("an in-flight acknowledgement cannot overwrite a newer local stop", async () => {
  let release, started;
  const called = new Promise((resolve) => { started = resolve; });
  const { store } = storage({ save: async () => {
    started(); await new Promise((resolve) => { release = resolve; }); return { sync_revision: 1 };
  } });
  const record = proposeRescue("a", source);
  await store.save(record);
  const syncing = store.sync(record.id); await called;
  await store.save({ ...record, status: "stopped" }, 1);
  release();
  const ack = await syncing;
  assert.equal(ack.record.status, "stopped"); assert.equal(ack.dirty, true);
});
test("account switching and same-account re-login invalidate old stores", async () => {
  const { store, scope } = storage();
  const record = proposeRescue("a", source);
  scope.set(CURRENT_USER_KEY, "b");
  await assert.rejects(store.save(record), { code: "not_authenticated" });
  scope.set(CURRENT_USER_KEY, "a"); invalidateOfflineSession();
  await assert.rejects(store.current(), { code: "not_authenticated" });
});
test("server conflicts retain the full local record and stop automatic rewriting", async () => {
  const { store, records } = storage({ save: async () => { throw Object.assign(new Error("conflict"), { status: 409 }); } });
  const record = proposeRescue("a", source);
  await store.save(record); await assert.rejects(store.sync(record.id));
  assert.equal(records.get("rescue:state").sessions[record.id].conflict, true);
  assert.deepEqual(records.get("rescue:state").sessions[record.id].record, record);
  await assert.rejects(store.save(record, 1), { code: "rescue_conflict" });
});
