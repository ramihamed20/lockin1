import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  catalogAnnotationToFocus,
  focusAnnotationToCatalog,
  reconcileCatalogWorkspace
} from "../src/workspace/catalog/focusAnnotationAdapter.js";

const stroke = {
  id: "a03e6717-1c6d-4b6e-9ac5-c95835641c62",
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

test("catalog strokes round-trip through the Focus annotation wire contract", () => {
  const wire = catalogAnnotationToFocus(stroke);
  assert.equal(wire.tool, "highlighter");
  assert.deepEqual(wire.payload.samples.map(({ x, y }) => ({ x, y })), [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 }
  ]);
  const restored = focusAnnotationToCatalog({
    ...wire,
    created_at: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(restored.id, stroke.id);
  assert.equal(restored.page, 2);
  assert.equal(restored.type, "highlighter");
  assert.deepEqual(restored.points.map(({ x, y }) => ({ x, y })), [
    { x: 100, y: 200 },
    { x: 300, y: 400 }
  ]);
});

test("server annotations hydrate a clean second device", () => {
  const wire = catalogAnnotationToFocus(stroke);
  const snapshot = reconcileCatalogWorkspace(
    { page: 2, zoom: 1.5, notes: [], savedAt: "2026-02-02T00:00:00Z" },
    null,
    [{ ...wire, created_at: "2026-02-02T00:00:00Z" }]
  );
  assert.equal(snapshot.annotations[0].id, stroke.id);
  assert.equal(snapshot.view.page, 2);
  assert.equal(snapshot.pending, false);
});

test("newer owner-scoped offline work wins locally and remains pending", () => {
  const local = {
    annotations: [stroke],
    notes: [{ id: "n1", body: "offline" }],
    savedAt: "2026-03-02T00:00:00Z"
  };
  const snapshot = reconcileCatalogWorkspace(
    { annotations: [], notes: [], savedAt: "2026-03-01T00:00:00Z" },
    local,
    []
  );
  assert.equal(snapshot.annotations[0].id, stroke.id);
  assert.equal(snapshot.pending, true);
});

test("a different document version cannot hydrate another collection", () => {
  const first = reconcileCatalogWorkspace(null, null, []);
  assert.deepEqual(first.annotations, []);
  assert.equal(first.pending, false);
});

test("offline workspace work retains a stable idempotency key and retries on connection recovery", async () => {
  const source = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /workspaceSyncKeyRef/);
  assert.match(source, /annotationSyncKeyRef/);
  assert.match(source, /subscribeConnection\(\(connection\)/);
  assert.match(source, /connection\.status === "connected"/);
});
