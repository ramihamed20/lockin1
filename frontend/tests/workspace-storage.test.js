import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_IMPORT_BYTES,
  WORKSPACE_EXPORT_KIND,
  WORKSPACE_RECORD_VERSION,
  buildExportPayload,
  changedPages,
  createAnnotationRevisionIndex,
  exportFileName,
  groupAnnotationsByPage,
  mergeRestoredAnnotations,
  mergeRestoredNotes,
  ownerStorageKey,
  pageSignatures,
  parseImportPayload,
  sanitizeStoredAnnotations,
  workspaceDocumentId,
  workspacePageId
} from "../src/workspace/storage/workspaceSnapshot.js";

function stroke(id, page = 1, x = 10) {
  return {
    id,
    page,
    type: "pen",
    color: "#8b5cf6",
    width: 4,
    opacity: 1,
    profile: "ball",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [
      { x, y: 20, t: 0, p: 0.5, pointer: "pen" },
      { x: x + 30, y: 44, t: 8, p: 0.5, pointer: "pen" }
    ]
  };
}

function signaturesFor(annotations, index) {
  return pageSignatures(groupAnnotationsByPage(annotations), index);
}

test("documents are isolated per owner and per sheet", () => {
  assert.equal(ownerStorageKey({ id: "student-9" }), "user:student-9");
  assert.equal(ownerStorageKey({ id: 42 }), "user:42");
  // A signed-out reader gets their own bucket rather than inheriting one.
  assert.equal(ownerStorageKey(null), "device");
  assert.equal(ownerStorageKey({}), "device");

  const first = workspaceDocumentId(ownerStorageKey({ id: "a" }), "microbiology", "sheet-1");
  const second = workspaceDocumentId(ownerStorageKey({ id: "b" }), "microbiology", "sheet-1");
  const otherSheet = workspaceDocumentId(ownerStorageKey({ id: "a" }), "microbiology", "sheet-2");
  assert.notEqual(first, second, "two accounts on one device never share a document");
  assert.notEqual(first, otherSheet);
  assert.equal(workspacePageId(first, 7), `${first}::7`);
  assert.equal(workspacePageId(first, 7.4), `${first}::7`);
});

test("only pages whose ink actually changed are scheduled for writing", () => {
  const index = createAnnotationRevisionIndex();
  const one = stroke("a", 1);
  const two = stroke("b", 2);
  const before = signaturesFor([one, two], index);

  // An unrelated re-render must not mark anything dirty.
  assert.deepEqual(changedPages(before, signaturesFor([one, two], index)), { changed: [], removed: [] });

  // Adding to page 2 leaves page 1 alone.
  const added = signaturesFor([one, two, stroke("c", 2)], index);
  assert.deepEqual(changedPages(before, added), { changed: [2], removed: [] });

  // An erase keeps the id but replaces the geometry: identity still catches it.
  const erased = { ...one, points: one.points.slice(0, 1) };
  assert.deepEqual(changedPages(before, signaturesFor([erased, two], index)), { changed: [1], removed: [] });

  // Clearing a page reports it for deletion rather than leaving a stale record.
  assert.deepEqual(changedPages(before, signaturesFor([two], index)), { changed: [], removed: [1] });
});

test("a backup carries the document, the view, and nothing else", () => {
  const payload = buildExportPayload({
    materialSlug: "microbiology",
    sheetSlug: "sheet-1",
    materialTitle: "Microbiology",
    sheetTitle: "Sheet 1",
    annotations: [stroke("a", 3)],
    notes: [{ id: "n1", page: 3, body: "remember this", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
    view: { page: 3, zoom: 2, scrollLeft: 40, scrollTop: 900, pageOffset: 0.25 },
    savedAt: "2026-02-03T10:00:00.000Z"
  });
  assert.equal(payload.kind, WORKSPACE_EXPORT_KIND);
  assert.equal(payload.version, WORKSPACE_RECORD_VERSION);
  assert.equal(payload.document.sheetSlug, "sheet-1");
  assert.equal(payload.annotations.length, 1);
  assert.equal(payload.notes.length, 1);
  // The export carries the fit-to-width basis so a backup restored on another
  // device reopens at the reading size rather than the old page width. A view
  // saved before the basis existed exports it as 0, meaning "unknown".
  assert.deepEqual(payload.view, { page: 3, zoom: 2, zoomFitBasis: 0, scrollLeft: 40, scrollTop: 900, pageOffset: 0.25 });

  // No credential-shaped field can ride along in a backup.
  const serialized = JSON.stringify(payload);
  for (const secret of ["token", "csrf", "session", "cookie", "password", "authorization"]) {
    assert.doesNotMatch(serialized.toLowerCase(), new RegExp(secret), `backups never contain ${secret}`);
  }
  assert.equal(exportFileName({ materialSlug: "microbiology", sheetSlug: "sheet-1", savedAt: "2026-02-03T10:00:00.000Z" }), "lock-in-microbiology-sheet-1-2026-02-03.json");
});

test("a backup round-trips through export and import", () => {
  const payload = buildExportPayload({
    materialSlug: "microbiology",
    sheetSlug: "sheet-1",
    annotations: [stroke("a", 2), stroke("b", 5)],
    notes: [],
    view: { page: 2, zoom: 1.4 }
  });
  const result = parseImportPayload(JSON.stringify(payload), { materialSlug: "microbiology", sheetSlug: "sheet-1" });
  assert.equal(result.ok, true);
  assert.equal(result.matchesDocument, true);
  assert.equal(result.payload.annotations.length, 2);
  assert.equal(result.payload.annotations[0].page, 2);
  assert.equal(result.payload.view.zoom, 1.4);
});

test("a backup for another sheet is accepted but flagged instead of merged silently", () => {
  const payload = buildExportPayload({
    materialSlug: "pharmacy",
    sheetSlug: "sheet-4",
    sheetTitle: "Pharmacy Sheet 4",
    annotations: [stroke("a")],
    notes: [],
    view: {}
  });
  const result = parseImportPayload(JSON.stringify(payload), { materialSlug: "microbiology", sheetSlug: "sheet-1" });
  assert.equal(result.ok, true);
  assert.equal(result.matchesDocument, false, "the caller must confirm a cross-document restore");
  assert.equal(result.payload.sheetTitle, "Pharmacy Sheet 4");
});

test("malformed, hostile, and oversized backups are refused safely", () => {
  const base = buildExportPayload({ materialSlug: "microbiology", sheetSlug: "sheet-1", annotations: [stroke("a")], notes: [], view: {} });

  assert.equal(parseImportPayload("").ok, false);
  assert.equal(parseImportPayload("   ").ok, false);
  assert.equal(parseImportPayload("not json at all").ok, false);
  assert.equal(parseImportPayload("[1,2,3]").ok, false);
  assert.equal(parseImportPayload("null").ok, false);
  assert.equal(parseImportPayload(JSON.stringify({ kind: "something-else" })).ok, false);
  assert.equal(parseImportPayload(JSON.stringify({ ...base, version: 99 })).ok, false);
  assert.equal(parseImportPayload(JSON.stringify({ ...base, annotations: [], notes: [] })).ok, false);

  // Prototype pollution attempts never reach the workspace.
  const polluted = parseImportPayload('{"__proto__":{"polluted":true},"kind":"lock-in.focus-workspace.backup","version":1}');
  assert.equal(polluted.ok, false);
  assert.equal(({}).polluted, undefined);

  // A traversal-shaped or script-shaped slug is rejected outright.
  for (const slug of ["../../etc", "sheet 1", "<script>", "", "a".repeat(200)]) {
    const hostile = JSON.stringify({ ...base, document: { ...base.document, sheetSlug: slug } });
    assert.equal(parseImportPayload(hostile).ok, false, `slug ${JSON.stringify(slug)} is refused`);
  }

  const oversized = `{"kind":"${WORKSPACE_EXPORT_KIND}","padding":"${"x".repeat(MAX_IMPORT_BYTES)}"}`;
  assert.equal(parseImportPayload(oversized).ok, false);
});

test("imported annotations are re-sanitized, so no unsupported payload survives", () => {
  const base = buildExportPayload({ materialSlug: "microbiology", sheetSlug: "sheet-1", annotations: [stroke("a")], notes: [], view: {} });
  const hostile = JSON.stringify({
    ...base,
    annotations: [
      { ...stroke("keep") },
      { id: "img", page: 1, type: "image", src: "javascript:alert(1)", width: 100, height: 100, x: 0, y: 0 },
      { id: "script", page: 1, type: "script", payload: "alert(1)" },
      { id: "text", page: 1, type: "text", text: "<img src=x onerror=alert(1)>", width: 4, x: 10, y: 10 }
    ]
  });
  const result = parseImportPayload(hostile, { materialSlug: "microbiology", sheetSlug: "sheet-1" });
  assert.equal(result.ok, true);
  const types = result.payload.annotations.map((annotation) => annotation.type);
  assert.deepEqual(types, ["pen", "text"], "the javascript: image and the unknown type are dropped");
  // Text is kept verbatim as data; React escapes it at render time, and it can
  // never be an executable annotation type.
  assert.equal(result.payload.annotations[1].text, "<img src=x onerror=alert(1)>");
  assert.equal(sanitizeStoredAnnotations([{ id: "bad", page: 1, type: "pen", points: [] }]).length, 0);
});

test("restoring adds what is missing and never replaces existing work", () => {
  const current = [stroke("a"), stroke("b")];
  const backup = [stroke("b"), stroke("c")];
  const { merged, added, skipped } = mergeRestoredAnnotations(current, backup);
  assert.equal(added, 1);
  assert.equal(skipped, 1);
  assert.equal(merged.length, 3);
  assert.equal(merged[0], current[0], "existing objects are untouched");
  assert.equal(merged[1], current[1]);
  assert.equal(merged[2].id, "c");

  const notes = mergeRestoredNotes([{ id: "n1" }], [{ id: "n1" }, { id: "n2" }]);
  assert.equal(notes.added, 1);
  assert.equal(notes.merged.length, 2);
});
