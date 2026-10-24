import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { installOfflineEnvironment, signedLease } from "./helpers/offlineEnvironment.js";

const env = installOfflineEnvironment();
const { offlineDatabase: db } = await import("../src/offline/database.js");
const { saveVerifiedLease } = await import("../src/offline/lease.js");
const { storeOpenedPdf, readDownloadMetadata, findDownloadedPdfItem, readOfflinePdfBytes } = await import("../src/offline/downloads.js");
const { pdfDocumentSource, rememberOpenedPdf } = await import("../src/offline/pdfSource.js");
const { loadReaderDocument } = await import("../src/offline/readerDocument.js");
const { resolveOfflineDocument } = await import("../src/offline/documents.js");
const { invalidateOfflineSession } = await import("../src/offline/sessionScope.js");
const bytes = new globalThis.TextEncoder().encode("%PDF-1.7 complete PDF transport bytes");
const coords = { materialSlug: "anatomy", sheetSlug: "cranial", view: "study" };
const url = "/api/v1/files/11111111-1111-4111-8111-111111111111/view";
const item = {
  id: "doc:sheet", type: "sheet", document_id: "doc", document_version_id: "version-1", version: 1,
  material_slug: coords.materialSlug, sheet_slug: coords.sheetSlug,
  available: true, download_url: url, size: bytes.length,
  checksum: createHash("sha256").update(bytes).digest("hex"), dependencies: []
};
const descriptor = { document: { id: "doc", document_version_id: "version-1", view_url: url } };
async function setup({ lease = true, stored = true } = {}) {
  const user = randomUUID();
  localStorage.setItem("lock-in.offline-current-user-id", user);
  env.goOnline();
  if (lease) await saveVerifiedLease(user, signedLease({ userId: user }));
  await db.put(user, "manifest", { items: [item], subjects: [] });
  if (stored) await storeOpenedPdf(user, url, bytes);
  return user;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("an explicitly opened PDF is stored from PDF.js transport without another file request", async () => {
  const user = await setup({ stored: false });
  const before = env.calls.length;
  let reads = 0;
  await rememberOpenedPdf(url, { getData: async () => { reads++; return bytes; } });
  assert.equal((await readDownloadMetadata(user, item.id)).storedSize, bytes.length);
  await rememberOpenedPdf(url, { getData: async () => { reads++; return bytes; } });
  assert.equal(reads, 1);
  assert.equal(env.calls.length, before);
  const first = await pdfDocumentSource(url);
  const second = await pdfDocumentSource(url);
  assert.deepEqual(first.data, bytes);
  assert.notEqual(first.data.buffer, second.data.buffer, "PDF.js gets fresh transferable bytes each open");
});

test("stored reader opens before online metadata finishes and then revalidates", async () => {
  const user = await setup();
  const pending = deferred(), refreshed = deferred();
  const local = await loadReaderDocument(user, coords, () => pending.promise, refreshed.resolve);
  assert.equal(local.document.offline, true);
  assert.equal(local.document.view_url, url);
  assert.deepEqual((await pdfDocumentSource(url)).data, bytes);
  pending.resolve(descriptor);
  assert.deepEqual(await refreshed.promise, { payload: descriptor });
});

test("known permission denial blocks future cached access without deleting student work", async () => {
  const user = await setup();
  await db.put(user, "annotations:pending", { text: "keep my note" });
  const pending = deferred(), refreshed = deferred();
  await loadReaderDocument(user, coords, () => pending.promise, refreshed.resolve);
  const error = Object.assign(new Error("Access denied"), { status: 403 });
  pending.reject(error);
  assert.equal((await refreshed.promise).error, error);
  assert.equal((await readDownloadMetadata(user, item.id)).blocked, true);
  assert.equal(await readOfflinePdfBytes(user, item.id), null);
  assert.equal(await resolveOfflineDocument(user, coords), null);
  assert.deepEqual(await db.get(user, "annotations:pending"), { text: "keep my note" });
  await storeOpenedPdf(user, url, bytes); // A late transport cannot undo denial.
  assert.equal((await readDownloadMetadata(user, item.id)).blocked, true);
  await loadReaderDocument(user, coords, async () => descriptor);
  assert.deepEqual((await pdfDocumentSource(url)).data, bytes);
});

test("without an offline lease a server grant is required before reusing local bytes", async () => {
  const user = await setup({ lease: false });
  assert.deepEqual(await pdfDocumentSource(url), { url });
  const pending = deferred();
  let ready = false;
  const loading = loadReaderDocument(user, coords, () => pending.promise).then((result) => { ready = true; return result; });
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.equal(ready, false);
  pending.resolve(descriptor);
  await loading;
  assert.deepEqual((await pdfDocumentSource(url)).data, bytes);
});

test("manifest refresh preserves old version identity and never supplies its bytes for a new URL", async () => {
  const user = await setup();
  const newUrl = "/api/v1/files/22222222-2222-4222-8222-222222222222/view";
  await db.put(user, "manifest", { items: [{ ...item, download_url: newUrl, document_version_id: "version-2", version: 2 }], subjects: [] });
  assert.equal((await resolveOfflineDocument(user, coords)).document.document_version_id, "version-1");
  assert.equal(await findDownloadedPdfItem(user, newUrl), null);
  assert.deepEqual(await pdfDocumentSource(newUrl), { url: newUrl });
  assert.deepEqual((await pdfDocumentSource(url)).data, bytes);
  const refreshed = deferred();
  const fresh = { document: { ...descriptor.document, document_version_id: "version-2", view_url: newUrl } };
  await loadReaderDocument(user, coords, async () => fresh, refreshed.resolve);
  assert.deepEqual(await refreshed.promise, { payload: fresh });
});

test("incomplete or corrupt transport never becomes a saved PDF", async () => {
  const user = await setup({ stored: false });
  await assert.rejects(storeOpenedPdf(user, url, bytes.slice(0, -1)), /integrity/);
  const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(storeOpenedPdf(user, url, corrupt), /integrity/);
  assert.equal(await readDownloadMetadata(user, item.id), undefined);
});

test("same-size cache corruption falls back to the server and is repaired after opening", async () => {
  const user = await setup();
  const cache = await caches.open(`lock-in-private-offline-v1-${user}`);
  const key = (await cache.keys())[0];
  const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
  await cache.put(key, new Response(corrupt));
  assert.deepEqual(await pdfDocumentSource(url), { url });
  await rememberOpenedPdf(url, { getData: async () => bytes });
  assert.deepEqual((await pdfDocumentSource(url)).data, bytes);
});

test("account switches fence late downloads and local reads", async () => {
  const user = await setup({ stored: false });
  const pending = deferred();
  const saving = rememberOpenedPdf(url, { getData: () => pending.promise });
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  localStorage.setItem("lock-in.offline-current-user-id", "another-user");
  invalidateOfflineSession();
  pending.resolve(bytes);
  await assert.rejects(saving, /Sign in/);
  assert.equal(await readDownloadMetadata(user, item.id), undefined);
  assert.deepEqual(await pdfDocumentSource(url), { url });
});

test("an offline fallback does not pretend to be fresh online authorization", async () => {
  const user = await setup();
  const refreshed = deferred();
  const local = await loadReaderDocument(user, coords, async () => ({ document: { ...descriptor.document, offline: true, view_url: "/__offline_pdf__/doc" } }), refreshed.resolve);
  assert.deepEqual((await refreshed.promise).payload, local);
});
