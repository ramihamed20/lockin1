import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { installOfflineEnvironment, signedLease } from "./helpers/offlineEnvironment.js";

const env = installOfflineEnvironment();
const { offlineDatabase: db } = await import("../src/offline/database.js");
const { saveVerifiedLease } = await import("../src/offline/lease.js");
const { synchronizeOffline, refreshAutomaticDownloads, readOfflinePreferences, saveOfflinePreferences } = await import("../src/offline/coordinator.js");
const { downloadOfflineItem, fetchOfflineManifest, readDownloadMetadata, readOfflinePdfBytes, storeOpenedPdf, prioritizePdfRead } = await import("../src/offline/downloads.js");
const { enqueueOperation, pendingOfflineOperations } = await import("../src/offline/queue.js");
const { removeOfflineItem, clearOfflineDownloads, findDownloadedPdfItem, setStoredPdfAccess } = await import("../src/offline/downloads.js");
const { invalidateOfflineSession } = await import("../src/offline/sessionScope.js");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function pdf(index, version = 1) {
  const bytes = new globalThis.TextEncoder().encode(`%PDF-1.7 complete file ${index} version ${version}`);
  const fileId = `${String(index * 10 + version).padStart(8, "0")}-1111-4111-8111-111111111111`;
  return {
    bytes,
    item: {
      id: `doc-${index}:sheet`, type: "sheet", document_id: `doc-${index}`, document_version_id: `version-${index}-${version}`,
      sheet_id: `sheet-${index}`, material_slug: "anatomy", sheet_slug: `sheet-${index}`, edition: "university", version,
      download_url: `/api/v1/files/${fileId}/view`, available: true, dependencies: [], size: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex")
    }
  };
}

async function setup(files = [pdf(1), pdf(2)]) {
  const user = randomUUID();
  localStorage.setItem("lock-in.offline-current-user-id", user);
  env.routes.clear();
  env.goOnline();
  document.visibilityState = "visible";
  navigator.storage = null;
  delete navigator.connection;
  delete navigator.locks;
  await saveVerifiedLease(user, signedLease({ userId: user }));
  const state = { files, user };
  env.route("GET /offline/lease/", () => ({ lease: signedLease({ userId: user }) }));
  env.route("GET /catalog/materials", () => ({ results: [] }));
  env.route("GET /catalog/questions?source=exam", () => ({ results: [] }));
  env.route("GET /catalog/questions?source=ai-sheet", () => ({ results: [] }));
  env.route("GET /offline/review/", () => ({ bank: {}, queue: {}, subjects: {}, weekly: {}, answer_keys: {}, version: "r1" }));
  env.route("GET /offline/manifest/", () => ({ items: state.files.map(({ item }) => item), subjects: [] }));
  env.route("GET /files/*", ({ path }) => {
    const file = state.files.find(({ item }) => item.download_url === `/api/v1${path}`);
    return new Response(file?.bytes || "missing", { status: file ? 200 : 404 });
  });
  env.calls.length = 0;
  return state;
}

const fileRequests = () => env.calls.filter((call) => call.startsWith("GET /files/"));

test("a student gets every authorized PDF automatically without opening Downloads", async () => {
  const { user, files } = await setup();
  const preferences = await readOfflinePreferences(user);
  assert.equal(preferences.automatic, true);
  assert.equal(preferences.network, "any");
  assert.equal(preferences.types.active_study, false);
  await synchronizeOffline(user);
  assert.equal(fileRequests().length, 2);
  env.goOffline();
  for (const file of files) assert.deepEqual(await readOfflinePdfBytes(user, file.item.id), file.bytes);
});

test("later syncs fetch only new or replaced PDFs and keep the unchanged copy", async () => {
  const state = await setup();
  await synchronizeOffline(state.user);
  env.calls.length = 0;
  await synchronizeOffline(state.user);
  assert.deepEqual(fileRequests(), []);
  const unchanged = state.files[0];
  state.files = [unchanged, pdf(2, 2), pdf(3)];
  env.calls.length = 0;
  await synchronizeOffline(state.user);
  assert.deepEqual(fileRequests(), state.files.slice(1).map(({ item }) => `GET ${item.download_url.slice(7)}`));
  assert.deepEqual(await readOfflinePdfBytes(state.user, unchanged.item.id), unchanged.bytes);
  assert.equal((await readDownloadMetadata(state.user, state.files[1].item.id)).version, 2);
});

test("a periodic check discovers new PDFs without fetching quiz directories or Review", async () => {
  const state = await setup([pdf(1)]);
  await synchronizeOffline(state.user);
  state.files.push(pdf(2));
  env.calls.length = 0;
  await refreshAutomaticDownloads(state.user);
  assert.deepEqual(env.calls, ["GET /offline/manifest/", `GET ${state.files[1].item.download_url.slice(7)}`]);
  env.calls.length = 0;
  await refreshAutomaticDownloads(state.user);
  assert.deepEqual(env.calls, [], "bursts of periodic checks are throttled");
});

test("a hidden, disconnected or opted-out app makes no periodic requests", async () => {
  const { user } = await setup();
  document.visibilityState = "hidden";
  await refreshAutomaticDownloads(user);
  document.visibilityState = "visible";
  env.goOffline();
  await refreshAutomaticDownloads(user);
  env.goOnline();
  await saveOfflinePreferences(user, { automatic: false });
  await refreshAutomaticDownloads(user);
  assert.deepEqual(env.calls, []);
});

test("stored opt-out, content choices, and Wi-Fi-only choices are preserved", async () => {
  const { user } = await setup();
  await saveOfflinePreferences(user, { automatic: false, network: "wifi", types: { sheet: false, questions: true } });
  await synchronizeOffline(user);
  assert.deepEqual(fileRequests(), []);
  const preferences = await readOfflinePreferences(user);
  assert.equal(preferences.automatic, false);
  assert.equal(preferences.types.questions, true);
  await saveOfflinePreferences(user, { automatic: true, network: "wifi" });
  navigator.connection = { type: "cellular" };
  await synchronizeOffline(user);
  assert.deepEqual(fileRequests(), []);
  navigator.connection = { type: "wifi" };
  await synchronizeOffline(user);
  assert.equal(fileRequests().length, 2);
});

test("failed files retry independently without redownloading successful files", async () => {
  const { user, files } = await setup();
  const path = files[0].item.download_url.slice(7);
  env.route(`GET ${path}`, () => new Response("unavailable", { status: 503 }));
  await synchronizeOffline(user);
  assert.equal((await db.get(user, "syncCursor")).failedDownloads, 1);
  assert.deepEqual(await readOfflinePdfBytes(user, files[1].item.id), files[1].bytes);
  env.route(`GET ${path}`, () => new Response(files[0].bytes));
  env.calls.length = 0;
  await synchronizeOffline(user);
  assert.deepEqual(fileRequests(), [`GET ${path}`]);
  assert.equal((await db.get(user, "syncCursor")).failedDownloads, 0);
});

test("automatic downloading stops between files while hidden and catches up on resume", async () => {
  const { user, files } = await setup();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => {
    document.visibilityState = "hidden";
    return new Response(files[0].bytes);
  });
  await synchronizeOffline(user);
  assert.equal(fileRequests().length, 1);
  document.visibilityState = "visible";
  await synchronizeOffline(user);
  assert.equal(fileRequests().length, 2);
});

test("turning automatic downloads off during a batch stops the following files", async () => {
  const { user, files } = await setup();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, async () => {
    await saveOfflinePreferences(user, { automatic: false });
    return new Response(files[0].bytes);
  });
  await synchronizeOffline(user);
  assert.equal(fileRequests().length, 1);
});

test("a full device stops a bulk batch without deleting already stored study files", async () => {
  const { user, files } = await setup([pdf(1)]);
  await synchronizeOffline(user);
  const extra = pdf(2);
  const current = { items: [files[0].item, extra.item], subjects: [] };
  env.route("GET /offline/manifest/", () => current);
  navigator.storage = { estimate: async () => ({ quota: 10, usage: 0 }) };
  env.calls.length = 0;
  await synchronizeOffline(user);
  assert.deepEqual(fileRequests(), []);
  assert.equal((await db.get(user, "syncCursor")).failedDownloads, 1);
  assert.deepEqual(await readOfflinePdfBytes(user, files[0].item.id), files[0].bytes);
});

test("concurrent manual and bulk requests share one complete transfer", async () => {
  const { user, files } = await setup([pdf(1)]);
  const manifest = await fetchOfflineManifest(user);
  const started = deferred(), gate = deferred();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  const first = downloadOfflineItem(user, files[0].item, () => {}, { manifest });
  await started.promise;
  const second = downloadOfflineItem(user, files[0].item, () => {}, { manifest, manual: true });
  gate.resolve(new Response(files[0].bytes));
  const results = await Promise.all([first, second]);
  assert.equal(fileRequests().length, 1);
  assert.equal(results[0].storedSize, files[0].bytes.length);
  assert.deepEqual(results[0], results[1]);
});

test("two editions sharing one summary file download it once and retain their own metadata", async () => {
  const file = pdf(1);
  file.item.type = "summary";
  const alias = { bytes: file.bytes, item: { ...file.item, id: "lockin-doc:summary", edition: "lockin", document_id: "lockin-doc" } };
  const { user } = await setup([file, alias]);
  const manifest = await fetchOfflineManifest(user);
  await Promise.all(manifest.items.map((item) => downloadOfflineItem(user, item, () => {}, { manifest })));
  assert.equal(fileRequests().length, 1);
  assert.equal((await readDownloadMetadata(user, alias.item.id)).document_id, "lockin-doc");
  assert.deepEqual(await readOfflinePdfBytes(user, alias.item.id), file.bytes);
  // Coalesced callers must also receive the metadata for their own edition.
  const extra = { ...alias.item, id: "third-doc:summary", document_id: "third-doc" };
  await db.put(user, "manifest", { ...manifest, items: [...manifest.items, extra] });
  const result = await downloadOfflineItem(user, extra);
  assert.equal(result.id, extra.id);
  assert.equal(fileRequests().length, 1);
});

test("separate tabs share a transfer through Web Locks and the committed cache", async () => {
  const { user, files } = await setup([pdf(1)]);
  const manifest = await fetchOfflineManifest(user);
  const queues = new Map();
  navigator.locks = { request(name, options, action = options) {
    const previous = queues.get(name) || Promise.resolve();
    const result = previous.catch(() => {}).then(action);
    queues.set(name, result);
    return result;
  } };
  const otherTab = await import("../src/offline/downloads.js?second-tab");
  const started = deferred(), gate = deferred();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  const first = downloadOfflineItem(user, files[0].item, () => {}, { manifest });
  await started.promise;
  const second = otherTab.downloadOfflineItem(user, files[0].item, () => {}, { manifest });
  gate.resolve(new Response(files[0].bytes));
  await Promise.all([first, second]);
  assert.equal(fileRequests().length, 1);
});

test("an alias never labels an older stored file with a new checksum", async () => {
  const state = await setup([pdf(1)]);
  await synchronizeOffline(state.user);
  const fresh = pdf(1, 2);
  const alias = { bytes: fresh.bytes, item: { ...fresh.item, id: "alias:summary", type: "summary" } };
  state.files = [fresh, alias];
  await fetchOfflineManifest(state.user);
  await downloadOfflineItem(state.user, alias.item);
  assert.deepEqual(await readOfflinePdfBytes(state.user, alias.item.id), fresh.bytes);
  assert.equal(fileRequests().length, 2);
});

test("a server denial discovered by a background refresh also blocks its old local copy", async () => {
  const state = await setup([pdf(1)]);
  await synchronizeOffline(state.user);
  state.files[0] = { ...state.files[0], item: { ...state.files[0].item, version: 2 } };
  env.route(`GET ${state.files[0].item.download_url.slice(7)}`, () => new Response("denied", { status: 403 }));
  await synchronizeOffline(state.user);
  assert.equal(await readOfflinePdfBytes(state.user, state.files[0].item.id), null);
  assert.equal((await readDownloadMetadata(state.user, state.files[0].item.id)).blocked, true);
  env.calls.length = 0;
  await synchronizeOffline(state.user);
  assert.deepEqual(fileRequests(), [], "known denials are not downloaded repeatedly");
});

test("the visible reader cancels its background transfer and saves its own transport", async () => {
  const { user, files } = await setup([pdf(1)]);
  const file = files[0];
  await fetchOfflineManifest(user);
  const started = deferred();
  env.route(`GET ${file.item.download_url.slice(7)}`, ({ signal }) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(file.bytes.slice(0, 6));
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      started.resolve();
    }
  })));
  const pending = downloadOfflineItem(user, file.item);
  const interrupted = assert.rejects(pending, { name: "AbortError" });
  await started.promise;
  const release = prioritizePdfRead(user, file.item.download_url);
  await interrupted;
  assert.equal(await readDownloadMetadata(user, file.item.id), undefined);
  assert.equal(await downloadOfflineItem(user, file.item), null);
  assert.equal(fileRequests().length, 1, "no second background transfer while the reader owns this PDF");
  await storeOpenedPdf(user, file.item.download_url, file.bytes);
  release();
  await downloadOfflineItem(user, file.item);
  assert.equal(fileRequests().length, 1);
  assert.deepEqual(await readOfflinePdfBytes(user, file.item.id), file.bytes);
});

test("an old response cannot overwrite a newer version saved during the download", async () => {
  const state = await setup([pdf(1)]);
  const old = state.files[0];
  await fetchOfflineManifest(state.user);
  const started = deferred(), gate = deferred();
  env.route(`GET ${old.item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  const pending = downloadOfflineItem(state.user, old.item);
  await started.promise;
  const fresh = pdf(1, 2);
  state.files = [fresh];
  await fetchOfflineManifest(state.user);
  await storeOpenedPdf(state.user, fresh.item.download_url, fresh.bytes);
  gate.resolve(new Response(old.bytes));
  await pending;
  assert.equal((await readDownloadMetadata(state.user, fresh.item.id)).version, 2);
  assert.deepEqual(await readOfflinePdfBytes(state.user, fresh.item.id), fresh.bytes);
});

test("a large background PDF does not hold up a new answer's upload", async () => {
  const { user, files } = await setup([pdf(1)]);
  const started = deferred(), gate = deferred(), finished = deferred();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  await synchronizeOffline(user, () => {}, { backgroundDownloads: true });
  await started.promise;
  await enqueueOperation(user, { type: "question_answer", entityType: "question", entityId: "q1", payload: { sheet_id: "sheet-1", question_id: "q1", choice_ids: ["a"] } });
  env.route("POST /offline/sync/", ({ body }) => ({ accepted: body.operations.map((operation) => ({ operation_id: operation.operation_id, result: { question_id: "q1", is_correct: true, xp_awarded: 5 } })), rejected: [] }));
  await synchronizeOffline(user, () => {}, { backgroundDownloads: true });
  assert.deepEqual(await pendingOfflineOperations(user), []);
  const listener = (event) => { if (event.detail.userId === user && ["synced", "partial"].includes(event.detail.state)) finished.resolve(); };
  window.addEventListener("lock-in:offline-sync", listener);
  gate.resolve(new Response(files[0].bytes));
  await finished.promise;
  window.removeEventListener("lock-in:offline-sync", listener);
  assert.equal(fileRequests().length, 1);
  assert.deepEqual(await readOfflinePdfBytes(user, files[0].item.id), files[0].bytes);
});

test("a stalled PDF request times out instead of holding every following download", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { user, files } = await setup([pdf(1)]);
  await fetchOfflineManifest(user);
  const started = deferred(), gate = deferred();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  let outcome;
  const pending = downloadOfflineItem(user, files[0].item).then(() => { outcome = "saved"; }, (error) => { outcome = error.code; });
  await started.promise;
  t.mock.timers.tick(60_001);
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  const result = outcome;
  gate.resolve(new Response(files[0].bytes));
  await pending;
  assert.equal(result, "timeout");
});

test("a transfer that stops sending body bytes times out too", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { user, files } = await setup([pdf(1)]);
  await fetchOfflineManifest(user);
  const started = deferred();
  let stream, outcome;
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => new Response(new ReadableStream({
    start(controller) { stream = controller; controller.enqueue(files[0].bytes.slice(0, 6)); started.resolve(); }
  })));
  const pending = downloadOfflineItem(user, files[0].item).then(() => { outcome = "saved"; }, (error) => { outcome = error.code; });
  await started.promise;
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  t.mock.timers.tick(60_001);
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  const result = outcome;
  try { stream.close(); } catch { /* A timed-out body is already cancelled. */ }
  await pending;
  assert.equal(result, "timeout");
  assert.equal(await readDownloadMetadata(user, files[0].item.id), undefined);
});

test("an oversized endless body is rejected before it fills device memory", async () => {
  const { user, files } = await setup([pdf(1)]);
  await fetchOfflineManifest(user);
  const started = deferred();
  let stream, outcome;
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => new Response(new ReadableStream({
    start(controller) { stream = controller; controller.enqueue(new Uint8Array(files[0].bytes.length + 1)); started.resolve(); }
  })));
  const pending = downloadOfflineItem(user, files[0].item).then(() => { outcome = "saved"; }, (error) => { outcome = error.message; });
  await started.promise;
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  const result = outcome;
  try { stream.close(); } catch { /* An oversized body is already cancelled. */ }
  await pending;
  assert.match(result || "still waiting", /integrity/);
});

test("a valid checksum cannot turn a non-PDF response into a ready download", async () => {
  const file = pdf(1);
  file.bytes = new globalThis.TextEncoder().encode("<html>wrong response</html>");
  file.item = { ...file.item, checksum: createHash("sha256").update(file.bytes).digest("hex"), size: file.bytes.length };
  const { user } = await setup([file]);
  await fetchOfflineManifest(user);
  await assert.rejects(downloadOfflineItem(user, file.item), /PDF|integrity/);
  assert.equal(await readDownloadMetadata(user, file.item.id), undefined);
});

test("a slow large-file transfer keeps going while new bytes keep arriving", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { user, files } = await setup([pdf(1)]);
  const file = files[0];
  await fetchOfflineManifest(user);
  const started = deferred();
  let stream;
  env.route(`GET ${file.item.download_url.slice(7)}`, () => new Response(new ReadableStream({
    start(controller) { stream = controller; controller.enqueue(file.bytes.slice(0, 6)); started.resolve(); }
  })));
  const pending = downloadOfflineItem(user, file.item);
  await started.promise;
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  for (let index = 6; index < file.bytes.length; index += 6) {
    t.mock.timers.tick(45_000);
    stream.enqueue(file.bytes.slice(index, index + 6));
    await new Promise((resolve) => globalThis.setImmediate(resolve));
  }
  stream.close();
  await pending;
  assert.deepEqual(await readOfflinePdfBytes(user, file.item.id), file.bytes);
});

test("a missing authoritative file size is rejected before starting an unbounded stream", async () => {
  const file = pdf(1);
  file.item.size = null;
  const { user } = await setup([file]);
  await fetchOfflineManifest(user);
  await assert.rejects(downloadOfflineItem(user, file.item), /integrity/);
  assert.deepEqual(fileRequests(), []);
});

test("metadata failure while relabeling the same file preserves the previous copy", async () => {
  const state = await setup([pdf(1)]);
  await synchronizeOffline(state.user);
  const file = state.files[0];
  file.item = { ...file.item, version: 2 };
  await fetchOfflineManifest(state.user);
  const put = db.putScoped;
  db.putScoped = async (owner, key, value, assertCurrent) => {
    if (owner === state.user && key === `download:${file.item.id}`) throw new Error("metadata write failed");
    return put(owner, key, value, assertCurrent);
  };
  try { await assert.rejects(downloadOfflineItem(state.user, file.item), /metadata write failed/); }
  finally { db.putScoped = put; }
  assert.equal((await readDownloadMetadata(state.user, file.item.id)).version, 1);
  assert.deepEqual(await readOfflinePdfBytes(state.user, file.item.id), file.bytes);
});

test("overlapping manifest refreshes share one snapshot instead of overwriting out of order", async () => {
  const { user, files } = await setup([pdf(1)]);
  const started = deferred(), gate = deferred();
  let reads = 0;
  env.route("GET /offline/manifest/", () => {
    reads++;
    if (reads === 1) { started.resolve(); return gate.promise; }
    return { items: [pdf(2).item], subjects: [] };
  });
  const first = fetchOfflineManifest(user);
  await started.promise;
  const second = fetchOfflineManifest(user);
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  gate.resolve({ items: [files[0].item], subjects: [] });
  const results = await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.deepEqual(results[0], results[1]);
});

test("one broken dependency graph does not stop other authorized PDFs", async () => {
  const files = [pdf(1), pdf(2)];
  files[0].item.dependencies = ["missing-file"];
  const { user } = await setup(files);
  await synchronizeOffline(user);
  assert.deepEqual(await readOfflinePdfBytes(user, files[1].item.id), files[1].bytes);
  assert.equal((await db.get(user, "syncCursor")).failedDownloads, 1);
});

test("a new login for the same user does not inherit the previous login's sync", async () => {
  const { user } = await setup([pdf(1)]);
  const started = deferred(), gate = deferred();
  let leases = 0;
  env.route("GET /offline/lease/", () => {
    leases++;
    if (leases === 1) { started.resolve(); return gate.promise; }
    return { lease: signedLease({ userId: user }) };
  });
  const oldSync = synchronizeOffline(user);
  const oldResult = oldSync.then(() => "finished", (error) => error.code);
  await started.promise;
  invalidateOfflineSession();
  const newSync = synchronizeOffline(user);
  const newResult = newSync.then(() => "finished", (error) => error.code);
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  gate.resolve({ lease: signedLease({ userId: user }) });
  assert.equal(await oldResult, "not_authenticated");
  assert.equal(await newResult, "finished");
  assert.equal(leases, 2);
});

test("a manual bulk check cannot hold up newly queued answers either", async () => {
  const { user, files } = await setup([pdf(1)]);
  const started = deferred(), gate = deferred();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  const manual = synchronizeOffline(user);
  await started.promise;
  await enqueueOperation(user, { type: "question_answer", entityType: "question", entityId: "q1", payload: { sheet_id: "sheet-1", question_id: "q1", choice_ids: ["a"] } });
  env.route("POST /offline/sync/", ({ body }) => ({ accepted: body.operations.map((operation) => ({ operation_id: operation.operation_id, result: { question_id: "q1", is_correct: true } })), rejected: [] }));
  const second = synchronizeOffline(user, () => {}, { backgroundDownloads: true });
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  gate.resolve(new Response(files[0].bytes));
  await Promise.all([manual, second]);
  assert.deepEqual(await pendingOfflineOperations(user), []);
});

test("removing an in-progress file prevents a late response from restoring it", async () => {
  const { user, files } = await setup([pdf(1)]);
  const file = files[0];
  await fetchOfflineManifest(user);
  const started = deferred(), gate = deferred();
  env.route(`GET ${file.item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  const pending = downloadOfflineItem(user, file.item).catch(() => null);
  await started.promise;
  await removeOfflineItem(user, file.item.id);
  gate.resolve(new Response(file.bytes));
  await pending;
  assert.equal(await readDownloadMetadata(user, file.item.id), undefined);
  assert.equal(await readOfflinePdfBytes(user, file.item.id), null);
  env.calls.length = 0;
  await synchronizeOffline(user);
  assert.deepEqual(fileRequests(), [], "the automatic queue respects a deliberate removal");
  await downloadOfflineItem(user, file.item, () => {}, { manual: true });
  assert.deepEqual(await readOfflinePdfBytes(user, file.item.id), file.bytes);
});

test("clearing downloads while a transfer is running leaves the device empty", async () => {
  const { user, files } = await setup([pdf(1)]);
  await fetchOfflineManifest(user);
  const started = deferred(), gate = deferred();
  env.route(`GET ${files[0].item.download_url.slice(7)}`, () => { started.resolve(); return gate.promise; });
  const pending = downloadOfflineItem(user, files[0].item).catch(() => null);
  await started.promise;
  await clearOfflineDownloads(user);
  gate.resolve(new Response(files[0].bytes));
  await pending;
  assert.equal(await readDownloadMetadata(user, files[0].item.id), undefined);
  assert.equal((await readOfflinePreferences(user)).automatic, false);
});

test("explicitly turning automatic downloads back on restores files cleared from the device", async () => {
  const { user, files } = await setup([pdf(1)]);
  await synchronizeOffline(user);
  await clearOfflineDownloads(user);
  const preferences = await readOfflinePreferences(user);
  await saveOfflinePreferences(user, { ...preferences, automatic: true });
  await synchronizeOffline(user);
  assert.deepEqual(await readOfflinePdfBytes(user, files[0].item.id), files[0].bytes);
});

test("a shared file can reopen locally when only its second edition was downloaded", async () => {
  const first = pdf(1);
  const second = { bytes: first.bytes, item: { ...first.item, id: "second-edition:sheet", edition: "lockin" } };
  const { user } = await setup([first, second]);
  await fetchOfflineManifest(user);
  await downloadOfflineItem(user, second.item);
  assert.equal((await findDownloadedPdfItem(user, first.item.download_url))?.id, second.item.id);
});

test("a known denial locks every downloaded edition of the same protected file", async () => {
  const first = pdf(1);
  const second = { bytes: first.bytes, item: { ...first.item, id: "second-edition:sheet", edition: "lockin" } };
  const { user } = await setup([first, second]);
  await synchronizeOffline(user);
  await setStoredPdfAccess(user, first.item.download_url, false);
  assert.equal(await readOfflinePdfBytes(user, first.item.id), null);
  assert.equal(await readOfflinePdfBytes(user, second.item.id), null);
});
