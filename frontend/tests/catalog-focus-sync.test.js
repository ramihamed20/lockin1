import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  catalogAnnotationToFocus,
  focusAnnotationToCatalog,
  isServerSyncableAnnotation
} from "../src/workspace/catalog/focusAnnotationAdapter.js";
import {
  createCatalogServerSync,
  fingerprint,
  isTransientSyncError,
  mergeById
} from "../src/workspace/catalog/catalogServerSync.js";
import { parseCatalogDocument } from "../src/hooks/useCatalogDocument.js";

const DOCUMENT_ID = "9a3c4ab0-7a8e-4a55-9a26-1d8a4f0e2b11";
const VERSION_ID = "2f7d6c1e-0b4a-4d3c-8e21-6b5a4c3d2e1f";
const ids = [
  "a03e6717-1c6d-4b6e-9ac5-c95835641c62",
  "b14f7828-2d7e-4c7f-8bd6-d06946752d73",
  "c2508939-3e8f-4d80-9ce7-e17a57863e84"
];

const stroke = {
  id: ids[0],
  page: 2,
  type: "highlighter",
  color: "#ffee00",
  width: 12,
  opacity: 0.34,
  points: [
    { x: 100, y: 200, p: 0.3, t: 10, pointer: "pen" },
    { x: 300, y: 400, p: 0.6, t: 20, pointer: "pen" }
  ]
};

function strokeWith(id, x) {
  return { ...stroke, id, points: stroke.points.map((point) => ({ ...point, x: point.x + x })) };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Fake backend with the real rules: revisions, 409 on conflict, replay by key. */
function fakeServer() {
  const server = {
    annotations: new Map(),
    collectionRevision: 0,
    workspace: { revision: 0, state: {} },
    receipts: new Map(),
    calls: [],
    failNext: null,
    dropNextAnnotationResponse: false,
    documentVersionId: VERSION_ID,
    focus: {
      async getAnnotations(_version, { pages }) {
        server.calls.push({ kind: "annotation-read", pages });
        const results = [...server.annotations.values()].filter((item) => pages.includes(item.page_number));
        return { collection_revision: server.collectionRevision, count: results.length, next: null, results };
      },
      async syncAnnotations(_version, body) {
        server.calls.push({ kind: "annotations", ...body });
        if (server.failNext) { const error = server.failNext; server.failNext = null; throw error; }
        if (server.receipts.has(body.idempotencyKey)) return server.receipts.get(body.idempotencyKey);
        if (body.expectedCollectionRevision !== server.collectionRevision) throw Object.assign(new Error("conflict"), { status: 409 });
        for (const item of body.annotations) server.annotations.set(item.id, clone(item));
        for (const id of body.deletedIds) server.annotations.delete(id);
        server.collectionRevision += 1;
        const result = { collection_revision: server.collectionRevision };
        server.receipts.set(body.idempotencyKey, result);
        if (server.dropNextAnnotationResponse) {
          server.dropNextAnnotationResponse = false;
          throw Object.assign(new Error("response lost"), { code: "network_error", status: 0 });
        }
        return result;
      }
    },
    catalog: {
      async get() { server.calls.push({ kind: "workspace-read" }); return clone(server.workspace); },
      async probe() {
        server.calls.push({ kind: "probe" });
        return {
          revision: server.workspace.revision,
          collection_revision: server.collectionRevision,
          document_version_id: server.documentVersionId,
          checksum_sha256: "checksum"
        };
      },
      async save(_document, expected, state, key) {
        server.calls.push({ kind: "workspace", expected, state, key });
        if (server.receipts.has(key)) return server.receipts.get(key);
        if (expected !== server.workspace.revision) throw Object.assign(new Error("conflict"), { status: 409 });
        server.workspace = { revision: expected + 1, state: clone(state) };
        const result = { revision: server.workspace.revision, state };
        server.receipts.set(key, result);
        return result;
      }
    }
  };
  return server;
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

// Unique across sync instances, as real UUID keys are.
let keyCounter = 0;

function syncFor(server, storage = memoryStorage()) {
  return createCatalogServerSync({
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    owner: "user:reader",
    storage,
    catalog: server.catalog,
    focus: server.focus,
    idFactory: () => `key-${++keyCounter}`
  });
}

const annotationCalls = (server) => server.calls.filter((call) => call.kind === "annotations");

test("catalog strokes round-trip through the Focus annotation wire contract", () => {
  const wire = catalogAnnotationToFocus(stroke);
  assert.equal(wire.tool, "highlighter");
  assert.deepEqual(wire.payload.samples.map(({ x, y }) => ({ x, y })), [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 }
  ]);
  const restored = focusAnnotationToCatalog({ ...wire, created_at: "2026-01-01T00:00:00.000Z" });
  assert.equal(restored.id, stroke.id);
  assert.equal(restored.page, 2);
  assert.equal(restored.type, "highlighter");
  assert.deepEqual(restored.points.map(({ x, y }) => ({ x, y })), [
    { x: 100, y: 200 },
    { x: 300, y: 400 }
  ]);
  // Reading an annotation back yields exactly the mutation that wrote it.
  assert.deepEqual(catalogAnnotationToFocus(restored), wire);
});

test("the wire format only carries values the server accepts", () => {
  const wire = catalogAnnotationToFocus({
    ...stroke,
    width: 3.456,
    opacity: 0.12345,
    color: "rgba(0, 0, 0, 1)",
    points: stroke.points.map((point) => ({ ...point, pointer: "stylus", t: undefined }))
  });
  assert.equal(wire.thickness, 3.46);
  assert.equal(wire.opacity, 0.123);
  assert.equal(wire.color, "#8b5cf6");
  assert.ok(wire.payload.samples.every((sample) => sample.pointer === "unknown" && sample.timestamp === 0));

  const text = catalogAnnotationToFocus({ id: ids[1], page: 1, type: "text", text: "Note", x: 250, y: 500, width: 4 });
  assert.equal(text.bounds.x, 0.25);
  assert.equal(text.bounds.y, 0.5);
});

test("images, triangles and pre-UUID annotations stay on the device", () => {
  assert.equal(isServerSyncableAnnotation(stroke), true);
  assert.equal(isServerSyncableAnnotation({ ...stroke, id: "legacy-stroke" }), false);
  assert.equal(isServerSyncableAnnotation({ id: ids[1], page: 1, type: "image", src: "data:image/png;base64,AA" }), false);
  assert.equal(isServerSyncableAnnotation({ id: ids[1], page: 1, type: "shape", shape: "triangle", start: { x: 1, y: 1 }, end: { x: 9, y: 9 } }), false);
});

test("a three-way merge tells local deletions from remote additions", () => {
  const print = (item) => fingerprint(JSON.stringify(item));
  const a = strokeWith(ids[0], 0);
  const b = strokeWith(ids[1], 0);
  const c = strokeWith(ids[2], 0);
  const base = new Map([[a.id, print(a)], [b.id, print(b)]]);

  // b was deleted here; c was added on another device.
  const merged = mergeById({ local: [a], remote: [a, b, c], base, print });
  assert.deepEqual(merged.items.map((item) => item.id), [a.id, c.id]);
  assert.equal(merged.localChanged, true);

  // b was deleted on another device and untouched here.
  assert.deepEqual(mergeById({ local: [a, b], remote: [a], base, print }).items.map((item) => item.id), [a.id]);

  // A concurrent edit wins over a delete regardless of which side made it.
  const editedB = strokeWith(ids[1], 70);
  assert.equal(mergeById({ local: [a], remote: [a, editedB], base, print }).items[1], editedB);
  assert.equal(mergeById({ local: [a, editedB], remote: [a], base, print }).items[1], editedB);

  // A clean second device takes everything the server holds.
  assert.deepEqual(mergeById({ local: [], remote: [a, b], base: new Map(), print }).items.map((item) => item.id), [a.id, b.id]);
});

test("a three-way merge resolves edits by which side changed", () => {
  const print = (item) => fingerprint(JSON.stringify(item));
  const original = strokeWith(ids[0], 0);
  const base = new Map([[original.id, print(original)]]);
  const editedThere = strokeWith(ids[0], 50);
  const editedHere = strokeWith(ids[0], 90);

  assert.equal(mergeById({ local: [original], remote: [editedThere], base, print }).items[0], editedThere);
  assert.equal(mergeById({ local: [editedHere], remote: [editedThere], base, print }).items[0], editedHere);
  // Equal content keeps this device's own object, which holds more detail.
  const same = { ...original };
  assert.equal(mergeById({ local: [same], remote: [original], base, print }).items[0], same);
});

test("offline work is pushed with the key it was first sent with", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 4 });
  const merged = sync.reconcile({ annotations: [stroke], notes: [] });
  assert.equal(merged.localChanged, false);

  server.failNext = Object.assign(new Error("offline"), { code: "network_error", status: 0 });
  const offline = await sync.push({ savedAt: "2026-09-11T10:00:00Z", view: { page: 2, zoom: 1 }, notes: [], annotations: [stroke] });
  assert.equal(offline.status, "offline");
  assert.equal(sync.hasPending(), true);

  const recovered = await sync.retry();
  assert.equal(recovered.status, "synced");
  const [first, second] = annotationCalls(server);
  assert.equal(first.idempotencyKey, second.idempotencyKey, "a retried payload replays under its original key");
  assert.deepEqual([...server.annotations.keys()], [stroke.id]);
  assert.equal(server.workspace.state.view.page, 2);
  assert.equal(sync.hasPending(), false);
});

test("a cold second device receives the first device's ink notes and page state", async () => {
  const server = fakeServer();
  const first = syncFor(server, memoryStorage());
  await first.load({ pageCount: 20 });
  first.reconcile({ annotations: [], notes: [] });
  const annotations = [strokeWith(ids[0], 0), { ...strokeWith(ids[1], 5), page: 4 }, { ...strokeWith(ids[2], 10), page: 17 }];
  const notes = [{ id: "note-17", page: 17, body: "Device A" }];
  assert.equal((await first.push({ savedAt: "t1", view: { page: 17, zoom: 1.2 }, notes, annotations })).status, "synced");

  const second = syncFor(server, memoryStorage());
  await second.load({ pageCount: 20 });
  const cold = second.reconcile({ annotations: [], notes: [] });

  assert.deepEqual(cold.annotations.map((item) => item.page), [2, 4, 17]);
  assert.deepEqual(cold.notes, notes);
  assert.equal(server.workspace.state.view.page, 17);
});

test("a lost response retries one logical mutation with the same idempotency key", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 4 });
  sync.reconcile({ annotations: [], notes: [] });
  server.dropNextAnnotationResponse = true;

  assert.equal((await sync.push({ savedAt: "t1", view: null, notes: [], annotations: [stroke] })).status, "offline");
  assert.equal(server.annotations.size, 1);
  assert.equal(server.collectionRevision, 1);
  assert.equal((await sync.retry()).status, "synced");
  const calls = annotationCalls(server);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(server.annotations.size, 1);
  assert.equal(server.collectionRevision, 1);
});

test("a revision conflict refreshes and merges before replay so both devices converge", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 4 });
  sync.reconcile({ annotations: [], notes: [] });

  // Another device adds a stroke after this one loaded.
  const other = catalogAnnotationToFocus(strokeWith(ids[1], 10));
  server.annotations.set(other.id, other);
  server.collectionRevision += 1;

  const local = { annotations: [stroke], notes: [] };
  const result = await sync.push({ savedAt: "2026-09-11T10:00:00Z", view: null, ...local });
  assert.equal(result.status, "failed");
  const refreshed = await sync.refresh({ pageCount: 4, local });
  assert.equal(refreshed.changed, true);
  assert.deepEqual(refreshed.annotations.map((item) => item.id).sort(), [ids[0], ids[1]].sort());
  const converged = await sync.push({ savedAt: "2026-09-11T10:01:00Z", view: null, notes: [], annotations: refreshed.annotations });
  assert.equal(converged.status, "synced");
  assert.deepEqual([...server.annotations.keys()].sort(), [ids[0], ids[1]].sort(), "the other device's stroke survives");
});

test("an unchanged revision probe does not download workspace or annotation state", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 20 });
  sync.reconcile({ annotations: [], notes: [] });
  server.calls.length = 0;

  const result = await sync.refresh({ pageCount: 20, local: { annotations: [], notes: [] } });

  assert.equal(result.changed, false);
  assert.deepEqual(server.calls.map((call) => call.kind), ["probe"]);
});

test("offline reconnect drains more than one bounded annotation batch", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 4 });
  sync.reconcile({ annotations: [], notes: [] });
  const annotations = Array.from({ length: 150 }, (_, index) => strokeWith(
    `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    index
  ));
  server.failNext = Object.assign(new Error("offline"), { code: "network_error", status: 0 });

  assert.equal((await sync.push({ savedAt: "t1", view: null, notes: [], annotations })).status, "offline");
  assert.equal((await sync.retry()).status, "synced");
  assert.equal(server.annotations.size, 150);
  assert.deepEqual(annotationCalls(server).slice(-2).map((call) => call.annotations.length), [100, 50]);
});

test("only changed annotations are sent, and device-only ones never are", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 4 });
  sync.reconcile({ annotations: [], notes: [] });
  const image = { id: ids[2], page: 1, type: "image", src: "data:image/png;base64,AA", x: 1, y: 1 };

  await sync.push({ savedAt: "t1", view: null, notes: [], annotations: [stroke, image] });
  await sync.push({ savedAt: "t2", view: null, notes: [], annotations: [stroke, image] });
  const calls = annotationCalls(server);
  assert.equal(calls.length, 1, "an unchanged set sends nothing");
  assert.deepEqual(calls[0].annotations.map((item) => item.id), [stroke.id]);

  await sync.push({ savedAt: "t3", view: null, notes: [], annotations: [image] });
  assert.deepEqual(annotationCalls(server)[1].deletedIds, [stroke.id]);
  assert.equal(server.annotations.size, 0);
});

test("the baseline carries a deletion into the next session", async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  const first = syncFor(server, storage);
  await first.load({ pageCount: 4 });
  first.reconcile({ annotations: [], notes: [] });
  const keep = strokeWith(ids[1], 5);
  await first.push({ savedAt: "t1", view: null, notes: [], annotations: [stroke, keep] });

  // Offline, the reader erases `stroke`; the next session starts from the device store.
  const next = syncFor(server, storage);
  await next.load({ pageCount: 4 });
  const merged = next.reconcile({ annotations: [keep], notes: [] });
  assert.deepEqual(merged.annotations.map((item) => item.id), [keep.id], "the erased stroke is not restored");
  await next.push({ savedAt: "t2", view: null, notes: [], annotations: merged.annotations });
  assert.deepEqual([...server.annotations.keys()], [keep.id]);
});

test("notes sync through the reader state and unchanged state is not re-sent", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 1 });
  sync.reconcile({ annotations: [], notes: [] });
  const notes = [{ id: "n1", page: 1, body: "private" }];

  await sync.push({ savedAt: "t1", view: { page: 1, zoom: 1 }, notes, annotations: [] });
  await sync.push({ savedAt: "t2", view: { page: 1, zoom: 1 }, notes, annotations: [] });
  const saves = server.calls.filter((call) => call.kind === "workspace");
  assert.equal(saves.length, 1);
  assert.deepEqual(server.workspace.state.notes, notes);
});

test("simultaneous notes merge after a workspace revision conflict", async () => {
  const server = fakeServer();
  const first = syncFor(server, memoryStorage());
  const second = syncFor(server, memoryStorage());
  await first.load({ pageCount: 1 });
  await second.load({ pageCount: 1 });
  first.reconcile({ annotations: [], notes: [] });
  second.reconcile({ annotations: [], notes: [] });
  const noteA = { id: "note-a", page: 1, body: "A" };
  const noteB = { id: "note-b", page: 1, body: "B" };

  assert.equal((await first.push({ savedAt: "t1", view: null, notes: [noteA], annotations: [] })).status, "synced");
  assert.equal((await second.push({ savedAt: "t2", view: null, notes: [noteB], annotations: [] })).status, "failed");
  const mergedSecond = await second.refresh({ pageCount: 1, local: { annotations: [], notes: [noteB] } });
  assert.deepEqual(new Set(mergedSecond.notes.map((note) => note.id)), new Set(["note-a", "note-b"]));
  assert.equal((await second.push({ savedAt: "t3", view: null, notes: mergedSecond.notes, annotations: [] })).status, "synced");
  const mergedFirst = await first.refresh({ pageCount: 1, local: { annotations: [], notes: [noteA] } });
  assert.deepEqual(new Set(mergedFirst.notes.map((note) => note.id)), new Set(["note-a", "note-b"]));
});

test("lost access stops the sync instead of retrying forever", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 1 });
  sync.reconcile({ annotations: [], notes: [] });
  server.failNext = Object.assign(new Error("forbidden"), { status: 403 });

  assert.equal((await sync.push({ savedAt: "t1", view: null, notes: [], annotations: [stroke] })).status, "failed");
  assert.equal(sync.isLoaded(), false);
  assert.equal((await sync.push({ savedAt: "t2", view: null, notes: [], annotations: [stroke] })).status, "unavailable");
  assert.equal(isTransientSyncError({ status: 503 }), true);
  assert.equal(isTransientSyncError({ status: 500, code: "invalid_response" }), false);
});

test("a PDF replacement is detected by the probe without discarding local work", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 4 });
  sync.reconcile({ annotations: [stroke], notes: [] });
  server.documentVersionId = ids[2];

  const result = await sync.refresh({ pageCount: 4, local: { annotations: [stroke], notes: [] } });

  assert.equal(result.documentChanged, true);
  assert.equal(result.changed, false);
  assert.equal(sync.hasPending(), false);
});

test("only a protected same-origin file resolves as the sheet's document", () => {
  const document = { id: DOCUMENT_ID, document_version_id: VERSION_ID, view_url: `/api/v1/files/${DOCUMENT_ID}/view`, checksum_sha256: "abc123" };
  assert.deepEqual(parseCatalogDocument({ document }), { id: DOCUMENT_ID, versionId: VERSION_ID, viewUrl: document.view_url, checksum: "abc123" });
  assert.equal(parseCatalogDocument({ document: { ...document, view_url: "https://elsewhere.test/a.pdf" } }), null);
  assert.equal(parseCatalogDocument({ count: 0, results: [] }), null);
});

test("the workspace resolves its document and syncs when the connection returns", async () => {
  const source = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  const catalogHook = await readFile(new URL("../src/hooks/useCatalogMaterials.js", import.meta.url), "utf8");
  assert.match(source, /useCatalogDocument\(/);
  assert.match(source, /materialsLoading/);
  assert.match(source, /materialsError/);
  assert.doesNotMatch(catalogHook, /getCohortMaterials/);
  assert.match(source, /createCatalogServerSync\(/);
  assert.match(source, /subscribeConnection\(\(connection\)/);
  assert.match(source, /connection\.status === "connected"/);
  assert.match(source, /window\.setInterval\(refreshServerState, 60_000\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibility\)/);
  assert.match(source, /window\.addEventListener\("focus", refreshServerState\)/);
});
