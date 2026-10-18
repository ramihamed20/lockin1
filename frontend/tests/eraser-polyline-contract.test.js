import test from "node:test";
import assert from "node:assert/strict";
import { eraseStrokeWithPolyline } from "../src/workspace/ink/strokeModel.js";

const path = [{ x: 50, y: -30 }, { x: 50, y: 30 }, { x: 80, y: 50 }];
const mark = (id, y = 0) => ({ id, type: "pen", width: 4, points: [{ x: 0, y, p: .2, pointer: "pen" }, { x: 50, y, p: .9, pointer: "pen" }, { x: 100, y, p: .4, pointer: "pen" }] });

test("polyline queries retain independent hits and masks across strokes and scales", () => {
  for (const scale of [{ x: 1, y: 1 }, { x: .6, y: 1 }, { x: 1, y: .4 }]) {
    const clip = (annotation, mode, idFactory) => eraseStrokeWithPolyline(annotation, [...path, { x: NaN, y: 3 }], 4, mode, idFactory, scale);
    const marks = [mark("first"), mark("miss", 500), mark("second", 15)];
    for (let repeat = 0; repeat < 3; repeat++) for (const original of marks) {
      const result = clip(original);
      assert.deepEqual(result, eraseStrokeWithPolyline(original, path, 4, "precision", undefined, scale));
      assert.equal(result.changed, original.id !== "miss");
      if (result.changed) {
        assert.equal(result.fragments[0].erasures.length, 1);
        assert.notEqual(result.fragments[0].erasures[0].points, path);
      }
    }
    const first = clip(marks[0]), second = clip(marks[2]);
    first.fragments[0].erasures[0].points[0].x = -999;
    assert.equal(second.fragments[0].erasures[0].points[0].x, 50);
    assert.equal(path[0].x, 50);
  }
});

test("polyline clipping preserves the mask cap, fragment IDs, whole strokes and empty input", () => {
  for (const mode of ["precision", "segment", "stroke"]) {
    const clip = (annotation, mode, idFactory) => eraseStrokeWithPolyline(annotation, path, 4, mode, idFactory);
    for (const masks of [0, 31, 32]) {
      const original = { ...mark("capped"), erasures: Array.from({ length: masks }, () => ({ radius: 1, points: [{ x: 5, y: 5 }] })) };
      let batchId = 0, singleId = 0;
      const batch = clip(original, mode, () => "split-" + batchId++);
      const single = eraseStrokeWithPolyline(original, path, 4, mode, () => "split-" + singleId++);
      assert.deepEqual(batch, single);
      assert.equal(batch.changed, true);
      if (mode === "stroke") assert.equal(batch.fragments.length, 0);
      if (mode === "precision" && masks < 32) assert.equal(batch.fragments[0].erasures.length, masks + 1);
      assert.equal(original.erasures.length, masks);
    }
  }
  const original = mark("empty");
  assert.deepEqual(eraseStrokeWithPolyline(original, [], 4), { changed: false, fragments: [original] });
  assert.deepEqual(eraseStrokeWithPolyline(null, path, 4), { changed: false, fragments: [null] });
});
