import assert from "node:assert/strict";
import test from "node:test";
import { createKnowledgeStore } from "../src/workspace/knowledge/storage.js";
import { createArtifact } from "../src/workspace/knowledge/model.js";
import { CURRENT_USER_KEY, invalidateOfflineSession } from "../src/offline/sessionScope.js";

function setup(api = {}) {
  const storage = new Map([[CURRENT_USER_KEY, "student-a"]]);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const accounts = new Map();
  const account = (id) => {
    if (!accounts.has(id)) accounts.set(id, new Map());
    return accounts.get(id);
  };
  const clone = (value) => value === undefined ? undefined : globalThis.structuredClone(value);
  const db = {
    get: async (user, key) => clone(account(user).get(key)),
    keys: async (user) => [...account(user).keys()],
    deleteScoped: async (user, key, check) => { check(); account(user).delete(key); },
    getMany: async (user, keys) => keys.map((key) => clone(account(user).get(key))),
    putScoped: async (user, key, value, check) => { check(); account(user).set(key, clone(value)); },
  };
  const source = { document_id: "document-a", source_version_id: "version-a", source_file_id: "file-a" };
  const record = createArtifact("summary", source);
  const store = createKnowledgeStore("student-a", "document-a", api, db);
  return { store, db, storage, record, accounts };
}

test("local editing survives restart; another tab cannot overwrite an unseen edit", async () => {
  const { store, db, record } = setup();
  await store.edit({ ...record, content: { ...record.content, text: "first" } });
  const reopened = createKnowledgeStore("student-a", "document-a", {}, db);
  assert.equal((await reopened.drafts())[0].record.content.text, "first");
  await assert.rejects(reopened.edit({ ...record, title: "other tab" }, 0), { code: "knowledge_conflict" });
  assert.equal((await store.drafts())[0].record.title, "");
});

test("edits made while syncing survive acknowledgement and use the next server revision", async () => {
  let release;
  let started;
  const called = new Promise((resolve) => { started = resolve; });
  const bodies = [];
  const api = { save: async (_document, id, body) => {
    bodies.push(body);
    if (bodies.length === 1) { started(); await new Promise((resolve) => { release = resolve; }); }
    return { id, ...body, revision: bodies.length, content: body.content };
  } };
  const { store, record } = setup(api);
  await store.edit({ ...record, content: { ...record.content, text: "before" } });
  const syncing = store.sync(record.id);
  await called;
  await store.edit({ ...record, content: { ...record.content, text: "during" } }, 1);
  release();
  const ack = await syncing;
  assert.equal(ack.record.content.text, "during");
  assert.equal(ack.dirty, true);
  assert.equal(ack.baseRevision, 1);
  const final = await store.sync(record.id);
  assert.equal(bodies[1].expected_revision, 1);
  assert.equal(bodies[1].content.text, "during");
  assert.equal(final.dirty, false);
});

test("a lost acknowledgement replays the same mutation and frozen body", async () => {
  const bodies = [];
  const { store, record } = setup({ save: async (_doc, id, body) => {
    bodies.push(body);
    if (bodies.length === 1) throw Object.assign(new Error("lost response"), { status: 0 });
    return { id, ...body, revision: 1 };
  } });
  await store.edit(record);
  await assert.rejects(store.sync(record.id));
  await store.edit({ ...record, title: "new local edit" }, 1);
  const result = await store.sync(record.id);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(result.record.title, "new local edit");
  assert.equal(result.dirty, true);
});

test("server conflict keeps the local draft and never retries by changing the expected revision", async () => {
  let calls = 0;
  const { store, record } = setup({ save: async () => {
    calls += 1; throw Object.assign(new Error("conflict"), { status: 409 });
  } });
  await store.edit({ ...record, title: "my work" });
  await assert.rejects(store.sync(record.id));
  assert.equal((await store.drafts())[0].record.title, "my work");
  assert.equal((await store.drafts())[0].conflict, true);
  assert.equal(await store.sync(record.id), null);
  assert.equal(calls, 1);
});

test("account changes fence in-flight acknowledgements and isolate local records", async () => {
  let release, start;
  const started = new Promise((resolve) => { start = resolve; });
  const { store, record, storage, db } = setup({ save: async (_document, id, body) => {
    start(); await new Promise((resolve) => { release = resolve; });
    return { id, ...body, revision: 1 };
  } });
  await store.edit(record);
  const inFlight = store.sync(record.id);
  await started;
  storage.set(CURRENT_USER_KEY, "student-b"); invalidateOfflineSession();
  release();
  await assert.rejects(inFlight, { code: "not_authenticated" });
  const second = createKnowledgeStore("student-b", "document-a", {}, db);
  assert.deepEqual(await second.drafts(), []);
  await assert.rejects(store.edit(record, 1), { code: "not_authenticated" });
});

test("unfinished explanations remain pending until a real server response", async () => {
  const { store } = setup({ attempt: async (_doc, id, body) => ({
    id, ...body, evaluation_status: "self_review", feedback: { essential_points: ["source point"] },
  }) });
  await store.queueAttempt("attempt-1", { question_id: "question-1", answer: "answer" });
  const pending = (await store.drafts())[0];
  assert.equal(pending.pendingAttempt, true);
  assert.equal(pending.response, undefined);
  const result = await store.syncAttempt("attempt-1");
  assert.equal(result.evaluation_status, "self_review");
  assert.equal((await store.drafts())[0].pendingAttempt, false);
});


test("clean drafts rebase on a newer server record which the student explicitly opened", async () => {
  const bodies = [];
  const { store, record } = setup({ save: async (_document, id, body) => {
    bodies.push(body); return { id, ...body, revision: bodies.length };
  } });
  await store.edit(record);
  await store.sync(record.id);
  await store.edit({ ...record, revision: 5, title: "edit after opening revision five" }, 1);
  await store.sync(record.id);
  assert.equal(bodies[1].expected_revision, 5);
});

test("conflict recovery archives the old draft after a separate copy is durably saved", async () => {
  const { store, record, db } = setup();
  await store.edit({ ...record, title: "original draft" });
  const copy = { ...record, id: globalThis.crypto.randomUUID(), title: "kept copy" };
  await store.edit(copy);
  await store.archiveDraft(record.id);
  const drafts = await store.drafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].record.title, "kept copy");
  const key = (await db.keys("student-a")).find((item) => item.includes(":recovery:"));
  assert.equal((await db.get("student-a", key)).record.title, "original draft");
});

test("UI drafts reject an unseen write from another tab", async () => {
  const { store, db } = setup();
  await store.readUI();
  const other = createKnowledgeStore("student-a", "document-a", {}, db);
  await other.readUI();
  await store.saveUI({ explanationDrafts: { "q:1": "my answer" } });
  await assert.rejects(other.saveUI({ tool: "map", explanationDrafts: {} }), { code: "knowledge_conflict" });
  assert.equal((await store.readUI()).explanationDrafts["q:1"], "my answer");
});
