import test from "node:test";
import assert from "node:assert/strict";
import { PEN_PROFILE, strokeIntersectsEraserPath } from "../src/workspace/ink/strokeModel.js";
import { createEraserSession } from "../src/workspace/ink/eraserSession.js";

function mark(overrides = {}) {
  return { id: "ink", type: "pen", page: 1, width: 8, profile: "ball", points: [{ x: 20, y: 50, p: .5, pointer: "pen" }, { x: 100, y: 50, p: .5, pointer: "pen" }], ...overrides };
}

test("drag-scoped widths preserve pressure/profile and scaled hit decisions", () => {
  for (const type of ["pen", "pencil", "highlighter"]) for (const profile of [...Object.values(PEN_PROFILE), "unknown-profile"]) {
    const stroke = mark({ type, profile, pressureSensitivity: .85, points: Array.from({ length: 30 }, (_, i) => ({ x: 20 + i * 8, y: 50 + Math.sin(i / 3) * 18, p: i % 5 / 4, pressureAvailable: i % 3 === 0, pointer: i % 2 ? "pen" : "mouse", tiltX: i % 7 * 10 })) });
    const cache = new WeakMap();
    for (const scale of [{ x: 1, y: 1 }, { x: .707, y: 1 }, { x: 1, y: .4 }]) for (let i = 0; i < 60; i++) {
      const start = { x: i * 5, y: 35 + i % 30 }, end = { x: i * 5 + 12, y: 46 + i % 20 };
      assert.equal(strokeIntersectsEraserPath(stroke, start, end, i % 9, true, scale, cache), strokeIntersectsEraserPath(stroke, start, end, i % 9, true, scale));
    }
  }
});

test("width cache updates on brush changes and replaced or extended points", () => {
  const cache = new WeakMap(), stroke = mark(), at = { x: 70, y: 60 };
  const hit = () => strokeIntersectsEraserPath(stroke, at, at, 0, true, { x: 1, y: 1 }, cache);
  assert.equal(hit(), false);
  stroke.width = 30; assert.equal(hit(), true);
  stroke.width = 8; assert.equal(hit(), false);
  stroke.points = [{ x: 20, y: 60, p: .5 }, { x: 100, y: 60, p: .5 }]; assert.equal(hit(), true);
  stroke.points.push({ x: 70, y: 90, p: .5 });
  const below = { x: 70, y: 90 };
  assert.equal(strokeIntersectsEraserPath(stroke, below, below, 0, true, { x: 1, y: 1 }, cache), true);
  // The default public helper also continues to read mutable legacy samples.
  stroke.points[2].y = 150;
  assert.equal(strokeIntersectsEraserPath(stroke, { x: 70, y: 150 }, { x: 70, y: 150 }, 0), true);
});

test("a new eraser drag reads the current committed stroke and preserves atomic history", () => {
  const session = createEraserSession({ idFactory: () => "split" }), stroke = mark();
  const first = { x: 60, y: 50 };
  session.begin(first, 1); session.append(first, { candidates: [stroke], radius: 2, mode: "stroke" });
  assert.equal(session.finish().command.before[0].id, "ink");
  stroke.points = [{ x: 20, y: 100 }, { x: 100, y: 100 }];
  session.begin(first, 1); session.append(first, { candidates: [stroke], radius: 2, mode: "stroke" });
  assert.equal(session.finish().command, null);
  const moved = { x: 60, y: 100 };
  session.begin(moved, 1); session.append(moved, { candidates: [stroke], radius: 2, mode: "precision" });
  const command = session.finish().command;
  assert.deepEqual(command.before[0], stroke);
  assert.equal(command.after.length, 1);
  assert.equal(command.after[0].erasures.length, 1);
});
