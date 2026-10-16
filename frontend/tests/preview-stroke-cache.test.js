import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewStrokeCache } from "../src/workspace/ink/previewStrokeCache.js";
import { PEN_PROFILE, strokeRenderGeometry } from "../src/workspace/ink/strokeModel.js";

const points = [{ x: 20, y: 30, p: .2, pointer: "pen", t: 0 }, { x: 45, y: 60, p: .9, pointer: "pen", tiltX: 50, t: 8 }, { x: 110, y: 90, p: .5, pointer: "pen", t: 16 }];
class FakePath { constructor(path) { this.path = path; } }

test("immutable preview paths preserve every profile's canonical pressure geometry", () => {
  for (const type of ["pen", "pencil", "highlighter"]) for (const profile of Object.values(PEN_PROFILE)) {
    const cache = createPreviewStrokeCache();
    const mark = { type, profile, points, width: 8, opacity: .6, pressureSensitivity: .9 };
    const first = cache.get(mark, FakePath);
    assert.deepEqual(first.geometry, strokeRenderGeometry(mark));
    assert.equal(first.path.path, first.geometry.path);
    const masked = { ...mark, erasures: [{ radius: 3, points: [{ x: 40, y: 50 }] }], color: "#ff0000" };
    assert.deepEqual(cache.get(masked, FakePath).geometry, strokeRenderGeometry(masked));
    assert.equal(cache.get(masked, FakePath).path, first.path);
  }
});

test("brush, opacity, replaced points and feature changes cannot reuse stale preview data", () => {
  const cache = createPreviewStrokeCache(), mark = { type: "pen", profile: "ball", points, width: 8, opacity: .6 };
  let last = cache.get(mark, FakePath);
  for (const update of [{ width: 14 }, { opacity: .2 }, { profile: PEN_PROFILE.PENCIL }, { pressureSensitivity: 0 }, { smoothing: .9 }, { type: "highlighter" }, { points: points.map((point) => ({ ...point, x: point.x + 40 })) }]) {
    Object.assign(mark, update);
    const next = cache.get(mark, FakePath);
    assert.notEqual(next, last); assert.deepEqual(next.geometry, strokeRenderGeometry(mark)); last = next;
  }
  const fallback = cache.get(mark, undefined);
  assert.equal(fallback.path, null); assert.deepEqual(fallback.geometry, strokeRenderGeometry(mark));
  assert.notEqual(cache.get(mark, FakePath).path, last.path);
});

test("clearing a gesture releases parsed paths and dot geometry remains exact", () => {
  const cache = createPreviewStrokeCache(), mark = { type: "pencil", points: [points[0]], width: 6, opacity: .5 };
  const first = cache.get(mark, FakePath);
  assert.deepEqual(first.geometry, strokeRenderGeometry(mark));
  assert.equal(first.path, null);
  cache.clear(); assert.notEqual(cache.get(mark, FakePath), first);
  mark.points = points;
  const stroke = cache.get(mark, FakePath); cache.clear();
  assert.notEqual(cache.get(mark, FakePath).path, stroke.path);
});
