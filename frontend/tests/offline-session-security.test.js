import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { installOfflineEnvironment, signedLease } from "./helpers/offlineEnvironment.js";

const env = installOfflineEnvironment();
const { offlineDatabase } = await import("../src/offline/database.js");
const { saveVerifiedLease } = await import("../src/offline/lease.js");
const { downloadOfflineItem, fetchOfflineManifest } = await import("../src/offline/downloads.js");
const { forgetOfflineUser } = await import("../src/offline/profile.js");
const { synchronizeOffline } = await import("../src/offline/coordinator.js");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a PDF response arriving after logout cannot recreate private downloads", async () => {
  const userId = "late-pdf";
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  assert.equal(await saveVerifiedLease(userId, signedLease({ userId })), true);
  const started = deferred();
  const response = deferred();
  const bytes = Buffer.from("%PDF-1.7 synthetic private data");
  env.route("GET /files/late/view", () => { started.resolve(); return response.promise; });
  const item = {
    id: "late:sheet", type: "sheet", available: true, size: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    download_url: "/api/v1/files/late/view", dependencies: [],
  };
  const pending = downloadOfflineItem(userId, item);
  const outcome = pending.then(() => "saved", (error) => error.code);
  await started.promise;
  await forgetOfflineUser(userId);
  response.resolve(new Response(bytes, { headers: { "Content-Type": "application/pdf" } }));
  assert.equal(await outcome, "not_authenticated");
  assert.equal(await offlineDatabase.get(userId, `download:${item.id}`), undefined);
  assert.equal((await caches.keys()).some((key) => key.endsWith(userId)), false);
});

test("a manifest started by an old session cannot write into a new session of the same user", async () => {
  const userId = "late-manifest";
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  const started = deferred();
  const response = deferred();
  env.route("GET /offline/manifest/", () => { started.resolve(); return response.promise; });
  const pending = fetchOfflineManifest(userId).then(() => "saved", (error) => error.code);
  await started.promise;
  await forgetOfflineUser(userId);
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  response.resolve({ items: [], subjects: [] });
  assert.equal(await pending, "not_authenticated");
  assert.equal(await offlineDatabase.get(userId, "manifest"), undefined);
});

test("old-account automatic sync cannot send requests using the new account's cookies", async () => {
  localStorage.setItem("lock-in.offline-current-user-id", "current-account");
  const before = env.calls.length;
  await assert.rejects(synchronizeOffline("previous-account"), { code: "not_authenticated" });
  assert.equal(env.calls.length, before);
});


test("server Active Study reconciliation cannot populate the previous account after logout", async () => {
  const userId = "late-reconcile";
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  const { reconcileActiveStudyRuns } = await import("../src/offline/activeStudy.js");
  const started = deferred();
  const response = deferred();
  const pending = reconcileActiveStudyRuns(userId, new Set(["sheet:university:easy"]), () => {
    started.resolve(); return response.promise;
  });
  const outcome = pending.then(() => "saved", (error) => error.code);
  await started.promise;
  await forgetOfflineUser(userId);
  response.resolve({ difficulties: [{ difficulty: "easy", completed: true }] });
  assert.equal(await outcome, "not_authenticated");
  assert.equal(await offlineDatabase.get(userId, "as-completed:sheet:university:easy"), undefined);
});


test("an offline profile read completing after logout cannot restore the previous account", async () => {
  const userId = "late-profile";
  const profile = { id: userId, full_name: "Synthetic offline profile" };
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  assert.equal(await saveVerifiedLease(userId, signedLease({ userId })), true);
  await offlineDatabase.put(userId, "profile", profile);
  const { restoreOfflineUser } = await import("../src/offline/profile.js");
  const started = deferred();
  const response = deferred();
  const read = offlineDatabase.get;
  offlineDatabase.get = (account, key) => {
    if (account === userId && key === "profile") { started.resolve(); return response.promise; }
    return read(account, key);
  };
  try {
    const pending = restoreOfflineUser();
    await started.promise;
    await forgetOfflineUser(userId);
    response.resolve(profile);
    assert.equal(await pending, null);
  } finally { offlineDatabase.get = read; }
});


test("old-session JSON cleanup cannot remove a bundle downloaded in the next session", async () => {
  const userId = "late-json-cleanup";
  localStorage.setItem("lock-in.offline-current-user-id", userId);
  const item = { id: "questions:late", type: "questions", available: true, checksum: "old-version", download_url: "/api/v1/offline/questions/late/?source=exam", dependencies: [] };
  env.route("GET /offline/questions/late/?source=exam", () => ({ content_version: "old-version", count: 0, results: [], answer_keys: {} }));
  const started = deferred();
  const keys = deferred();
  const readKeys = offlineDatabase.keys;
  let paused = false;
  offlineDatabase.keys = (account) => {
    if (account === userId && !paused) { paused = true; started.resolve(); return keys.promise; }
    return readKeys(account);
  };
  try {
    const pending = downloadOfflineItem(userId, item).then(() => "saved", (error) => error.code);
    await started.promise;
    await forgetOfflineUser(userId);
    localStorage.setItem("lock-in.offline-current-user-id", userId);
    const newKey = `content:${item.id}:new-version`;
    const newBundle = { content_version: "new-version" };
    await offlineDatabase.put(userId, newKey, newBundle);
    keys.resolve([newKey]);
    assert.equal(await pending, "not_authenticated");
    assert.deepEqual(await offlineDatabase.get(userId, newKey), newBundle);
  } finally { offlineDatabase.keys = readKeys; }
});
