import assert from "node:assert/strict";
import test from "node:test";
import { isEmptySnapshot, summarizeSnapshot, withoutPages } from "../src/workspace/catalog/annotationShare.js";

const snapshot = () => ({
  annotations: [
    { id: "a", type: "pen", page: 1 },
    { id: "b", type: "text", page: 3 },
    { id: "c", type: "image", page: 3 },
    { id: "d", type: "card", page: -5 }
  ],
  notes: [{ id: "n", page: 1 }],
  virtualPages: [{ id: -5, afterPage: 3, background: "grid" }, { id: -9, afterPage: 1, background: "blank" }]
});

test("summarizeSnapshot lists marked pages and every added page in reading order", () => {
  const { pages, marks } = summarizeSnapshot(snapshot());
  assert.equal(marks, 5);
  assert.deepEqual(pages.map((page) => [page.key, page.kind, page.marks]), [
    [1, "pdf", 2],
    [-9, "added", 0],
    [3, "pdf", 2],
    [-5, "added", 1]
  ]);
});

test("withoutPages drops marks, notes and added pages the person left out", () => {
  const trimmed = withoutPages(snapshot(), new Set([3, -9]));
  assert.deepEqual(trimmed.annotations.map((item) => item.id), ["a", "d"]);
  assert.deepEqual(trimmed.notes.map((item) => item.id), ["n"]);
  assert.deepEqual(trimmed.virtualPages.map((item) => item.id), [-5]);
});

test("leaving out an added page also drops what was drawn on it", () => {
  const trimmed = withoutPages(snapshot(), new Set([-5]));
  assert.equal(trimmed.annotations.some((item) => item.page === -5), false);
  assert.equal(trimmed.virtualPages.some((item) => item.id === -5), false);
});

test("an untouched selection returns the snapshot as is", () => {
  const original = snapshot();
  assert.equal(withoutPages(original, new Set()), original);
});

test("isEmptySnapshot is true only when nothing at all remains", () => {
  assert.equal(isEmptySnapshot({ annotations: [], notes: [], virtualPages: [] }), true);
  assert.equal(isEmptySnapshot({ annotations: [], notes: [], virtualPages: [{ id: -1, afterPage: 1, background: "blank" }] }), false);
});
