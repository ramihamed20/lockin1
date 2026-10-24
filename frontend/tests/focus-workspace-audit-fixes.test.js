import assert from "node:assert/strict";
import test from "node:test";

import { compactCatalogAnnotation, parseCatalogWorkspace, sanitizeCatalogAnnotation, serializeCatalogWorkspace } from "../src/workspace/catalog/catalogWorkspaceState.js";
import { equalSidedEnd, recognizeHeldStroke, recognizedShapeAnnotation } from "../src/workspace/ink/inkGestureRecognition.js";

const A4 = 842 / 595;

test("a dragged square or circle is equal-sided on screen, not in page units", () => {
  const start = { x: 100, y: 100 };
  const end = equalSidedEnd(start, { x: 300, y: 150 }, A4);
  // Screen size of a unit: x as 1, y as the page aspect.
  assert.equal(end.x - start.x, 200);
  assert.ok(Math.abs((end.y - start.y) * A4 - 200) < 1e-6);
  // The taller drag wins, and the direction of the drag is kept.
  const up = equalSidedEnd(start, { x: 90, y: 20 }, A4);
  assert.ok(Math.abs((start.x - up.x) - (start.y - up.y) * A4) < 1e-6);
  assert.ok(up.x < start.x && up.y < start.y);
});

test("a hand-drawn square on an A4 page is recognised as a square and evened out", () => {
  // A square on screen is 300 x-units wide and 300 / aspect y-units tall.
  const side = 300;
  const height = side / A4;
  const corners = [[200, 200], [200 + side, 200], [200 + side, 200 + height], [200, 200 + height], [200, 200]];
  const points = [];
  for (let edge = 0; edge < 4; edge += 1) {
    for (let step = 0; step < 20; step += 1) {
      const [x0, y0] = corners[edge];
      const [x1, y1] = corners[edge + 1];
      points.push({ x: x0 + (x1 - x0) * step / 20, y: y0 + (y1 - y0) * step / 20, p: .5, t: points.length * 8 });
    }
  }
  points.push({ ...points[0], t: points.length * 8 });
  const recognition = recognizeHeldStroke(points, { aspect: A4 });
  assert.equal(recognition?.kind, "square");
  const shape = recognizedShapeAnnotation({ id: "s", page: 1, type: "pen", points }, recognition, A4);
  const width = Math.abs(shape.end.x - shape.start.x);
  const tall = Math.abs(shape.end.y - shape.start.y) * A4;
  assert.ok(Math.abs(width - tall) < 1e-6);
});

test("stored strokes are compact and load back to the same marks", () => {
  const points = Array.from({ length: 30 }, (_, index) => ({
    x: 100 + index * 3.123456789, y: 200 + Math.sin(index) * 7.987654321, p: .5 + index / 100, t: 1_700_000_000_000 + index * 8.333,
    pointer: "pen", pointerId: 3, buttons: 1, pressureAvailable: true, contactWidth: 0, contactHeight: 0, tiltX: 12, tiltY: 0,
    altitudeAngle: null, azimuthAngle: null, twist: null, tangentialPressure: null
  }));
  const stroke = { id: "a", page: 1, type: "pen", color: "#000", width: 4, opacity: .4, points, createdAt: "2026-01-01T00:00:00Z" };
  const full = JSON.stringify(sanitizeCatalogAnnotation(stroke)).length;
  const compact = JSON.stringify(compactCatalogAnnotation(stroke)).length;
  assert.ok(compact * 2.5 < full, `compact ${compact} vs full ${full}`);
  const restored = parseCatalogWorkspace(serializeCatalogWorkspace({ annotations: [stroke] })).annotations[0];
  const original = sanitizeCatalogAnnotation(stroke);
  assert.equal(restored.points.length, original.points.length);
  // Lossless: a reload redraws exactly the same outline.
  assert.deepEqual(restored.points, original.points);
});

test("marks saved before compaction still load", () => {
  const legacy = { id: "old", page: 2, type: "pen", color: "#123456", width: 6, opacity: 1, points: [{ x: 10, y: 20, p: .4, t: 99, pointer: "mouse", pointerId: 1, buttons: 1 }] };
  const restored = sanitizeCatalogAnnotation(legacy);
  assert.deepEqual([restored.points[0].x, restored.points[0].y, restored.points[0].t, restored.points[0].pointer], [10, 20, 99, "mouse"]);
});

test("pen opacity survives a save and reload", () => {
  const stroke = { id: "faint", page: 1, type: "pen", color: "#000", width: 4, opacity: .35, points: [{ x: 1, y: 1, p: .5, t: 1 }, { x: 9, y: 9, p: .5, t: 9 }] };
  assert.equal(parseCatalogWorkspace(serializeCatalogWorkspace({ annotations: [stroke] })).annotations[0].opacity, .35);
});
