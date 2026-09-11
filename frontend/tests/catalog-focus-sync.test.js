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
    focus: {
      async getAnnotations(_version, { pages }) {
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
        return result;
      }
    },
    catalog: {
      async get() { return clone(server.workspace); },
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

test("a write from another device is replayed against the newer revision", async () => {
  const server = fakeServer();
  const sync = syncFor(server);
  await sync.load({ pageCount: 4 });
  sync.reconcile({ annotations: [], notes: [] });

  // Another device adds a stroke after this one loaded.
  const other = catalogAnnotationToFocus(strokeWith(ids[1], 10));
  server.annotations.set(other.id, other);
  server.collectionRevision += 1;

  const result = await sync.push({ savedAt: "2026-09-11T10:00:00Z", view: null, notes: [], annotations: [stroke] });
  assert.equal(result.status, "synced");
  assert.deepEqual([...server.annotations.keys()].sort(), [ids[0], ids[1]].sort(), "the other device's stroke survives");
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

test("only a protected same-origin file resolves as the sheet's document", () => {
  const document = { id: DOCUMENT_ID, document_version_id: VERSION_ID, view_url: `/api/v1/files/${DOCUMENT_ID}/view` };
  assert.deepEqual(parseCatalogDocument({ document }), { id: DOCUMENT_ID, versionId: VERSION_ID, viewUrl: document.view_url });
  assert.equal(parseCatalogDocument({ document: { ...document, view_url: "https://elsewhere.test/a.pdf" } }), null);
  assert.equal(parseCatalogDocument({ count: 0, results: [] }), null);
});

test("the workspace resolves its document and syncs when the connection returns", async () => {
  const source = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /useCatalogDocument\(/);
  assert.match(source, /createCatalogServerSync\(/);
  assert.match(source, /subscribeConnection\(\(connection\)/);
  assert.match(source, /connection\.status === "connected"/);
});
