import assert from "node:assert/strict";
import test from "node:test";
import {
  annotationHit,
  clampSelectionDelta,
  contextToolbarPosition,
  editableTarget,
  expandSelectionGroups,
  hitTestAnnotations,
  isDoubleTap,
  paintOrder,
  reorderSelection
} from "../src/workspace/selection/selectionController.js";

const stroke = (id, points, extra = {}) => ({ id, page: 1, type: "pen", width: 4, points, ...extra });
const text = (id, x, y, extra = {}) => ({ id, page: 1, type: "text", x, y, width: 4, text: "Note", align: "left", ...extra });

test("a stroke is hit near its line, not anywhere inside its box", () => {
  const diagonal = stroke("ink", [{ x: 100, y: 100 }, { x: 300, y: 300 }]);
  assert.equal(annotationHit(diagonal, { x: 200, y: 203 }, { tolerance: 6 }), true);
  // Inside the bounding box but far from the ink.
  assert.equal(annotationHit(diagonal, { x: 280, y: 120 }, { tolerance: 6 }), false);
});

test("hit tolerance means the same screen distance on a tall page", () => {
  const horizontal = stroke("ink", [{ x: 100, y: 500 }, { x: 400, y: 500 }], { width: 1 });
  // On an A4 page one y unit is 1.414 x units on screen, so 8 y units is ~11 x units away.
  assert.equal(annotationHit(horizontal, { x: 200, y: 508 }, { tolerance: 10, aspect: 1.414 }), false);
  assert.equal(annotationHit(horizontal, { x: 200, y: 506 }, { tolerance: 10, aspect: 1.414 }), true);
});

test("the topmost item wins, and highlighters sit beneath everything else", () => {
  const under = text("under", 100, 200);
  const over = text("over", 100, 200, { zOrder: 2 });
  const highlight = stroke("marker", [{ x: 90, y: 190 }, { x: 260, y: 190 }], { type: "highlighter", width: 30, zOrder: 9 });
  assert.equal(hitTestAnnotations([over, under, highlight], { x: 120, y: 190 })?.id, "over");
  assert.deepEqual(paintOrder([over, under, highlight]).map((item) => item.id), ["marker", "under", "over"]);
  assert.equal(hitTestAnnotations([under], { x: 900, y: 900 }), null);
});

test("selecting one member of a group selects the group", () => {
  const items = [text("a", 1, 1, { groupId: "g" }), text("b", 2, 2, { groupId: "g" }), text("c", 3, 3)];
  assert.deepEqual(expandSelectionGroups(["a"], items), ["a", "b"]);
  assert.deepEqual(expandSelectionGroups(["c"], items), ["c"]);
});

test("a drag moves the whole selection and stops at the page edge without squashing it", () => {
  const bounds = { x: 900, y: 100, width: 80, height: 50 };
  assert.deepEqual(clampSelectionDelta(bounds, 60, 20), { dx: 20, dy: 20 });
  assert.deepEqual(clampSelectionDelta(bounds, -950, -200), { dx: -900, dy: -100 });
  assert.deepEqual(clampSelectionDelta({ x: 10, y: 10, width: 20, height: 20 }, 5, -3), { dx: 5, dy: -3 });
});

test("bring forward and send backward step past exactly one neighbour", () => {
  const items = [text("a", 0, 0), text("b", 0, 0), text("c", 0, 0)];
  const forward = reorderSelection(items, ["a"], "forward");
  const order = (changes) => paintOrder(items.map((item) => changes.after.find((next) => next.id === item.id) || item)).map((item) => item.id);
  assert.deepEqual(order(forward), ["b", "a", "c"]);
  const backward = reorderSelection(items, ["c"], "backward");
  assert.deepEqual(order(backward), ["a", "c", "b"]);
  // Already at the top: nothing changes, so nothing is recorded.
  assert.deepEqual(reorderSelection([text("a", 0, 0, { zOrder: 0 }), text("b", 0, 0, { zOrder: 1 })], ["b"], "forward"), { before: [], after: [] });
});

test("only a quick second tap on the same item counts as a double tap", () => {
  const first = { id: "t", time: 1000, x: 50, y: 50 };
  assert.equal(isDoubleTap(first, { id: "t", time: 1250, x: 54, y: 52 }), true);
  assert.equal(isDoubleTap(first, { id: "t", time: 1500, x: 50, y: 50 }), false);
  assert.equal(isDoubleTap(first, { id: "other", time: 1100, x: 50, y: 50 }), false);
  assert.equal(isDoubleTap(first, { id: "t", time: 1100, x: 120, y: 50 }), false);
});

test("a double tap edits one unlocked text or card", () => {
  assert.equal(editableTarget([text("t", 1, 1)])?.id, "t");
  assert.equal(editableTarget([text("t", 1, 1, { locked: true })]), null);
  assert.equal(editableTarget([text("a", 1, 1), text("b", 1, 1)]), null);
  assert.equal(editableTarget([stroke("s", [{ x: 1, y: 1 }])]), null);
});

test("the context toolbar prefers the space above and stays inside the reader", () => {
  const reader = { width: 800, height: 600 };
  const toolbar = { width: 300, height: 44 };
  assert.deepEqual(contextToolbarPosition({ selection: { left: 300, top: 300, width: 100, height: 40 }, toolbar, reader }), { left: 200, top: 246, placement: "above" });
  // Too close to the top toolbar: drops below.
  assert.equal(contextToolbarPosition({ selection: { left: 300, top: 70, width: 100, height: 40 }, toolbar, reader, topInset: 60 }).placement, "below");
  // Near the right edge: clamped inside.
  assert.equal(contextToolbarPosition({ selection: { left: 760, top: 300, width: 30, height: 30 }, toolbar, reader }).left, 492);
});
