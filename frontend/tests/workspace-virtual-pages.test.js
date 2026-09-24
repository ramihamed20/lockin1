import assert from "node:assert/strict";
import test from "node:test";

import { composeWorkspacePages, insertVirtualPage, removeVirtualPage, sanitizeVirtualPages } from "../src/workspace/catalog/virtualPages.js";
import { parseCatalogWorkspace, serializeCatalogWorkspace } from "../src/workspace/catalog/catalogWorkspaceState.js";
import { isServerSyncableAnnotation } from "../src/workspace/catalog/focusAnnotationAdapter.js";
import { exportPageDimensions } from "../src/workspace/catalog/workspaceExport.js";
import { createEraserSession } from "../src/workspace/ink/eraserSession.js";
import { buildExportPayload, groupAnnotationsByPage, parseImportPayload, workspacePageId } from "../src/workspace/storage/workspaceSnapshot.js";

const ink = { id: "virtual-ink", page: -201, type: "pen", color: "#123456", width: 4, opacity: 1, points: [{ x: 10, y: 10 }, { x: 50, y: 50 }] };
const writing = { id: "virtual-text", page: -202, type: "text", text: "Study note", x: 30, y: 40, width: 120, height: 60 };

test("blank pages interleave after PDF pages without changing original numbering or count", () => {
  const pdfPages = [19, 20, 21, 22];
  let virtual = insertVirtualPage([], 20, -201);
  virtual = insertVirtualPage(virtual, 20, -202, -201);
  virtual = insertVirtualPage(virtual, 21, -203);
  const composed = composeWorkspacePages(pdfPages, virtual);
  assert.deepEqual(composed.map((item) => item.key), [19, 20, -201, -202, 21, -203, 22]);
  assert.deepEqual(composed.filter((item) => item.kind === "pdf").map((item) => item.pdfPage), pdfPages);
  assert.equal(pdfPages.length, 4);
  assert.deepEqual(composeWorkspacePages(pdfPages, removeVirtualPage(virtual, -201)).map((item) => item.key), [19, 20, -202, 21, -203, 22]);
  assert.deepEqual(sanitizeVirtualPages([{ id: 20, afterPage: 20 }, { id: -1, afterPage: 0 }, { id: -201, afterPage: 20 }, { id: -201, afterPage: 21 }]), [{ id: -201, afterPage: 20, background: "blank" }]);
});

test("page backgrounds survive old snapshots, new snapshots, and export composition", () => {
  const legacy = sanitizeVirtualPages([{ id: -10, afterPage: 2 }]);
  assert.equal(legacy[0].background, "blank");
  const virtualPages = insertVirtualPage(legacy, 2, -11, -10, "grid");
  assert.deepEqual(composeWorkspacePages([2, 3], virtualPages).map((item) => [item.key, item.background]), [[2, undefined], [-10, "blank"], [-11, "grid"], [3, undefined]]);
  const restored = parseCatalogWorkspace(serializeCatalogWorkspace({ virtualPages }));
  assert.deepEqual(restored.virtualPages, virtualPages);
  const backup = buildExportPayload({ materialSlug: "m", sheetSlug: "s", virtualPages });
  assert.deepEqual(parseImportPayload(JSON.stringify(backup), { materialSlug: "m", sheetSlug: "s" }).payload.virtualPages, virtualPages);
  assert.equal(sanitizeVirtualPages([{ id: -12, afterPage: 2, background: "script" }])[0].background, "blank");
});

test("annotated export retains each source page aspect ratio", () => {
  assert.deepEqual(exportPageDimensions({ width: 1200, height: 900 }), { width: 595, height: 446.25 });
  assert.deepEqual(exportPageDimensions({ width: 900, height: 1200 }), { width: 595, height: 793.33 });
});

test("virtual ink and writing retain distinct page keys in local storage and backups", () => {
  const virtualPages = [{ id: -201, afterPage: 20, background: "lined" }, { id: -202, afterPage: 21, background: "dot" }];
  const snapshot = { page: 20, zoom: 1.5, scrollTop: 800, virtualPages, annotations: [ink, writing], notes: [{ id: "note", page: -201, body: "Remember" }] };
  const restored = parseCatalogWorkspace(serializeCatalogWorkspace(snapshot));
  assert.deepEqual(restored.virtualPages, virtualPages);
  assert.deepEqual(restored.annotations.map((item) => item.page), [-201, -202]);
  assert.equal(restored.notes[0].page, -201);
  assert.deepEqual([...groupAnnotationsByPage(restored.annotations).keys()], [-201, -202]);
  assert.equal(workspacePageId("sheet", -201), "sheet::-201");
  assert.equal(isServerSyncableAnnotation(restored.annotations[0]), false);
  const backup = buildExportPayload({ materialSlug: "m", sheetSlug: "s", virtualPages, annotations: restored.annotations, notes: restored.notes, view: { page: 20, zoom: 1.5 } });
  const imported = parseImportPayload(JSON.stringify(backup), { materialSlug: "m", sheetSlug: "s" });
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.payload.virtualPages, virtualPages);
  assert.deepEqual(imported.payload.annotations.map((item) => item.page), [-201, -202]);
  assert.equal(imported.payload.view.page, 20);
});

test("study cards, shape styling, groups and locks survive a local round trip", () => {
  const groupId = "review-group";
  const card = { id: "card-one", page: -201, type: "card", cardKind: "revision", text: "Review the crown", x: 120, y: 140, width: 320, height: 220, groupId, locked: true, zOrder: 8 };
  const shape = { id: "shape-one", page: -201, type: "shape", shape: "polygon", color: "#2196f3", width: 5, start: { x: 460, y: 150 }, end: { x: 640, y: 330 }, dashed: true, fill: true, fillColor: "#ffe455", groupId, zOrder: 9 };
  const restored = parseCatalogWorkspace(serializeCatalogWorkspace({ virtualPages: [{ id: -201, afterPage: 3 }], annotations: [card, shape] }));
  assert.equal(restored.annotations[0].cardKind, "revision");
  assert.equal(restored.annotations[0].locked, true);
  assert.equal(restored.annotations[1].shape, "polygon");
  assert.equal(restored.annotations[1].fillColor, "#ffe455");
  assert.equal(restored.annotations[1].dashed, true);
  assert.deepEqual(restored.annotations.map((item) => item.groupId), [groupId, groupId]);
  assert.deepEqual(restored.annotations.map((item) => isServerSyncableAnnotation(item)), [false, false]);

  const eraser = createEraserSession();
  eraser.begin({ x: 150, y: 180 }, -201);
  eraser.append({ x: 160, y: 190 }, { annotationPage: -201, candidates: restored.annotations, radius: 20, mode: "object" });
  assert.equal(eraser.finish().command, null);
});
