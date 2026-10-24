import assert from "node:assert/strict";
import test from "node:test";
import { PEN_PROFILE, strokeRenderGeometry } from "../src/workspace/ink/strokeModel.js";
import { createLiveStrokeGeometry } from "../src/workspace/ink/liveStrokeGeometry.js";

const A4 = 297 / 210;
const SLIDE = 9 / 16;
const PAGE_WIDTH = 595;

function line(dx, dy, extra = {}) {
  return {
    id: `line-${dx}-${dy}`, page: 1, type: "pen", profile: PEN_PROFILE.BALL, color: "#111111", width: 4, opacity: 1,
    // Slow enough that the ball pen's speed thinning plays no part.
    points: Array.from({ length: 30 }, (_, index) => ({ x: 300 + dx * index, y: 300 + dy * index, t: index * 400, p: .5 })),
    ...extra
  };
}

/** Extent of every coordinate pair in a path, in page units. */
function pathBounds(path) {
  const numbers = path.replace(/A[^A-Z]*?0 1 0 /g, " ").match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Thickness on screen, in css px at 100%, of a page `PAGE_WIDTH` wide. */
function thickness(geometry, axis, aspect) {
  const bounds = pathBounds(geometry.path);
  return axis === "y" ? bounds.height * PAGE_WIDTH * aspect / 1000 : bounds.width * PAGE_WIDTH / 1000;
}

for (const [name, aspect] of [["A4", A4], ["16:9 slide", SLIDE]]) {
  test(`a ${name} page draws horizontal and vertical lines equally thick`, () => {
    const horizontal = thickness(strokeRenderGeometry(line(10, 0), aspect), "y", aspect);
    const vertical = thickness(strokeRenderGeometry(line(0, 10), aspect), "x", aspect);
    assert.ok(Math.abs(horizontal - vertical) < .03, `horizontal ${horizontal} vs vertical ${vertical}`);
  });
}

test("on a portrait page horizontal lines and highlights keep the width they always had", () => {
  // Before, a nib was round in page units, so a horizontal line was width/1000 of the page height thick.
  const horizontal = thickness(strokeRenderGeometry(line(10, 0), A4), "y", A4);
  assert.ok(Math.abs(horizontal - 4 * PAGE_WIDTH * A4 / 1000) < .03, `${horizontal}`);
  const highlight = line(10, 0, { type: "highlighter", profile: PEN_PROFILE.HIGHLIGHTER, width: 28, opacity: .34 });
  const covered = thickness(strokeRenderGeometry(highlight, A4), "y", A4);
  assert.ok(Math.abs(covered - 28 * PAGE_WIDTH * A4 / 1000) < .1, `${covered}`);
});

test("a single tap is a round dot on the page, written as an ellipse in page units", () => {
  const dot = strokeRenderGeometry({ ...line(0, 0), points: [{ x: 500, y: 500, t: 0, p: .5 }] }, A4);
  assert.equal(dot.kind, "dot");
  // radiusX across 595px and radiusY down 841px are the same length on screen.
  assert.ok(Math.abs(dot.radiusX * PAGE_WIDTH - dot.radiusY * PAGE_WIDTH * A4) < 1e-9);
});

test("live ink on a non-square page is exactly the stroke that is saved", () => {
  const stroke = (count) => ({
    id: "live", page: 2, type: "pen", profile: PEN_PROFILE.FOUNTAIN, color: "#202020", width: 6, opacity: 1, pressureSensitivity: .7,
    points: Array.from({ length: count }, (_, index) => ({ x: 200 + index * 3 + Math.sin(index / 4) * 9, y: 300 + Math.cos(index / 5) * 14, t: index * 6, p: .4 + Math.sin(index / 7) * .3, pressureAvailable: true, pointer: "pen" }))
  });
  const live = createLiveStrokeGeometry();
  for (let count = 1; count <= 80; count += 1) live.frame(stroke(count), [], { pageAspect: A4 });
  const fresh = createLiveStrokeGeometry().frame(stroke(80), [], { pageAspect: A4 });
  assert.equal(fresh.path, strokeRenderGeometry(stroke(80), A4).path);
  // A different page shape is a different stroke shape, so it repaints in full.
  assert.equal(live.frame(stroke(81), [], { pageAspect: SLIDE }).mode, "full");
});

test("a smooth stroke is one strip, not a quad and a disc per sample", () => {
  const smooth = {
    id: "smooth", page: 1, type: "pen", profile: PEN_PROFILE.FOUNTAIN, color: "#202020", width: 4, opacity: 1,
    points: Array.from({ length: 300 }, (_, index) => ({ x: 100 + index * .8, y: 400 + Math.sin(index / 25) * 30, t: index * 8, p: .5 + Math.sin(index / 40) * .2, pressureAvailable: true, pointer: "pen" }))
  };
  const geometry = strokeRenderGeometry(smooth, A4);
  assert.equal((geometry.path.match(/M/g) || []).length, 3, "one strip and its two end discs");
  assert.ok(geometry.path.length / smooth.points.length < 30, `${geometry.path.length / smooth.points.length} characters per sample`);
});
