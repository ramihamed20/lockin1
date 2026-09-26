import test from "node:test";
import assert from "node:assert/strict";
import {
  ERASER_MODE,
  PEN_PROFILE,
  eraseStrokeWithPolyline,
  eraserSpaceScale,
  strokeIntersectsEraserPath
} from "../src/workspace/ink/strokeModel.js";
import { analyzeLineIntent, recognizeHeldStroke, straightenedInkStroke } from "../src/workspace/ink/inkGestureRecognition.js";
import { createEraserSession } from "../src/workspace/ink/eraserSession.js";
import { shapeIntersectsEraserPath } from "../src/workspace/ink/shapeHitTesting.js";
import { paintInkErasures } from "../src/workspace/ink/inkErasures.js";
import {
  applyAnnotationCommand,
  createAnnotationSpatialIndex,
  queryAnnotationSpatialIndexBounds,
  withCommandPositions
} from "../src/workspace/catalog/catalogWorkspaceState.js";

// A seeded jitter so the "human" strokes are reproducible.
function jitter(seed) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648 - .5;
  };
}

function strokeAlong(count, at) {
  return Array.from({ length: count }, (_, index) => ({ ...at(index / (count - 1), index), t: index * 8 }));
}

test("line intent accepts natural hand variation that the old strict check rejected", () => {
  const noise = jitter(7);
  const wobbly = strokeAlong(60, (ratio) => ({ x: 100 + ratio * 320, y: 300 + Math.sin(ratio * 9) * 4 + noise() * 3 }));
  const bowed = strokeAlong(40, (ratio) => ({ x: 100 + ratio * 300, y: 200 + Math.sin(ratio * Math.PI) * 14 }));
  const angled = strokeAlong(30, (ratio) => ({ x: 80 + ratio * 220, y: 500 - ratio * 170 + noise() * 4 }));
  const fast = [{ x: 50, y: 60 }, { x: 170, y: 71 }, { x: 290, y: 78 }, { x: 400, y: 92 }];
  const slowDense = strokeAlong(400, (ratio) => ({ x: 600 + noise() * 2.5, y: 100 + ratio * 260 + noise() * 1.5 }));
  const hookedEnd = [...strokeAlong(40, (ratio) => ({ x: 100 + ratio * 280, y: 700 + noise() * 2 })), { x: 384, y: 706 }, { x: 386, y: 712 }];
  for (const [name, points] of Object.entries({ wobbly, bowed, angled, fast, slowDense, hookedEnd })) {
    const result = analyzeLineIntent(points);
    assert.equal(result.recognized, true, `${name}: ${result.reason} ${JSON.stringify(result.signals)}`);
    assert.equal(recognizeHeldStroke(points).kind, "line", name);
  }
});

test("line intent still rejects curves, circles, handwriting, zigzags and reversals", () => {
  const quarterArc = strokeAlong(40, (ratio) => ({ x: 100 + Math.sin(ratio * Math.PI / 2) * 200, y: 300 - Math.cos(ratio * Math.PI / 2) * 200 }));
  const shallowArc = strokeAlong(40, (ratio) => ({ x: 100 + ratio * 300, y: 200 + Math.sin(ratio * Math.PI) * 45 }));
  const circle = strokeAlong(48, (ratio) => ({ x: 300 + Math.cos(ratio * Math.PI * 2) * 60, y: 300 + Math.sin(ratio * Math.PI * 2) * 60 }));
  const cursive = strokeAlong(80, (ratio) => ({ x: 40 + ratio * 260, y: 120 + Math.sin(ratio * 26) * 18 }));
  const zigzag = strokeAlong(60, (ratio, index) => ({ x: 40 + ratio * 300, y: 400 + (index % 2 ? 12 : -12) }));
  const vee = [...strokeAlong(20, (ratio) => ({ x: 100 + ratio * 120, y: 100 + ratio * 200 })), ...strokeAlong(20, (ratio) => ({ x: 220 + ratio * 120, y: 300 - ratio * 200 }))];
  const backAndForth = [...strokeAlong(20, (ratio) => ({ x: 100 + ratio * 300, y: 100 })), ...strokeAlong(20, (ratio) => ({ x: 400 - ratio * 150, y: 104 }))];
  for (const [name, points] of Object.entries({ quarterArc, shallowArc, circle, cursive, zigzag, vee, backAndForth })) {
    assert.equal(analyzeLineIntent(points).recognized, false, name);
    assert.notEqual(recognizeHeldStroke(points)?.kind, "line", name);
  }
  const arrow = [
    ...strokeAlong(12, (ratio) => ({ x: 30 + ratio * 240, y: 520 })),
    { x: 245, y: 500 }, { x: 270, y: 520 }, { x: 245, y: 540 }
  ];
  assert.equal(recognizeHeldStroke(arrow).kind, "arrow");
});

test("line intent measures on screen, so the square page space and zoom cannot skew it", () => {
  // Straight on screen: 300px right and 300px down on a page 800px wide and
  // 1131px tall is 375 x-units but only 265 y-units.
  const unitsPerCssPixel = 1000 / 800;
  const aspect = 1131 / 800;
  const onScreen = strokeAlong(30, (ratio) => ({ x: 100 + ratio * 300, y: 100 + ratio * 300 }));
  const page = onScreen.map((point) => ({ ...point, x: point.x * unitsPerCssPixel, y: point.y * unitsPerCssPixel / aspect }));
  const result = analyzeLineIntent(page, { unitsPerCssPixel, aspect });
  assert.equal(result.recognized, true);
  assert.ok(Math.abs(result.signals.direct - Math.hypot(300, 300)) < 1);
  // A 20px scribble is too short to be a line at any zoom.
  assert.equal(analyzeLineIntent(strokeAlong(10, (ratio) => ({ x: ratio * 20, y: 0 }))).reason, "too-short");
  assert.equal(analyzeLineIntent(strokeAlong(10, (ratio) => ({ x: ratio * 20, y: 0 })), { unitsPerCssPixel: .25 }).recognized, true);
});

test("a straightened line keeps the tool, color, width, opacity, profile and direction", () => {
  const noise = jitter(3);
  for (const [type, profile, width, opacity] of [["pen", PEN_PROFILE.FOUNTAIN, 6, 1], ["highlighter", PEN_PROFILE.HIGHLIGHTER, 28, .34]]) {
    const raw = strokeAlong(50, (ratio) => ({ x: 420 - ratio * 300, y: 240 + ratio * 60 + noise() * 3, p: .3 + ratio * .4, pointer: "pen", pressureAvailable: true }));
    const stroke = { id: `${type}-1`, page: 2, type, profile, color: "#239ed1", width, opacity, pressureSensitivity: .6, smoothing: .5, points: raw };
    const recognition = recognizeHeldStroke(raw);
    assert.equal(recognition.kind, "line");
    const straight = straightenedInkStroke(stroke, recognition);
    for (const key of ["id", "page", "type", "profile", "color", "width", "opacity", "pressureSensitivity", "smoothing"]) assert.equal(straight[key], stroke[key], key);
    assert.ok(straight.points.length >= 2);
    // Drawn right to left, it still runs right to left.
    assert.ok(straight.points[0].x > straight.points.at(-1).x);
    const [first, last] = [straight.points[0], straight.points.at(-1)];
    for (const point of straight.points) {
      const cross = (last.x - first.x) * (point.y - first.y) - (last.y - first.y) * (point.x - first.x);
      assert.ok(Math.abs(cross) / Math.hypot(last.x - first.x, last.y - first.y) < 1e-6);
    }
    assert.ok(new Set(straight.points.map((point) => point.p)).size === 1, "pressure is even along the line");
  }
});

test("the eraser catches a thick highlighter by its painted edge, not only its centerline", () => {
  const highlighter = { id: "wide", page: 1, type: "highlighter", profile: PEN_PROFILE.HIGHLIGHTER, color: "#fde047", width: 28, opacity: .34, points: strokeAlong(20, (ratio) => ({ x: 100 + ratio * 400, y: 300 })) };
  // The tip (radius 4) stops 10 units above the centerline, inside the 14-unit half width.
  const session = createEraserSession({ idFactory: () => "fragment" });
  session.begin({ x: 300, y: 286 }, 1);
  const appended = session.append({ x: 320, y: 286 }, { annotationPage: 1, candidates: [highlighter], radius: 4, mode: ERASER_MODE.PRECISION });
  assert.equal(appended.changed, true);
  const { command } = session.finish();
  assert.equal(command.after[0].erasures.length, 1);
  // The spatial index still offers it when the eraser is near its far edge.
  const index = createAnnotationSpatialIndex([highlighter]);
  assert.deepEqual(queryAnnotationSpatialIndexBounds(index, 1, { x: 300, y: 270, width: 4, height: 4 }).map((item) => item.id), ["wide"]);
});

test("eraser space is a true circle on a non-square page", () => {
  const portrait = eraserSpaceScale(1.414);
  assert.ok(Math.abs(portrait.x - 1 / 1.414) < 1e-9);
  assert.equal(portrait.y, 1);
  assert.deepEqual(eraserSpaceScale(1), { x: 1, y: 1 });
  const vertical = { id: "v", page: 1, type: "pen", profile: PEN_PROFILE.BALL, width: 1, points: [{ x: 112, y: 100 }, { x: 112, y: 400 }] };
  const horizontal = { id: "h", page: 1, type: "pen", profile: PEN_PROFILE.BALL, width: 1, points: [{ x: 0, y: 212 }, { x: 400, y: 212 }] };
  const tip = { x: 100, y: 200 };
  // Radius 10 in eraser space reaches 14.1 page units sideways but only 10 down.
  assert.equal(strokeIntersectsEraserPath(vertical, tip, tip, 10, true, portrait), true);
  assert.equal(strokeIntersectsEraserPath(vertical, tip, tip, 10, true), false);
  assert.equal(strokeIntersectsEraserPath(horizontal, tip, tip, 10, true, portrait), false);
  const clipped = eraseStrokeWithPolyline(vertical, [tip], 10, ERASER_MODE.PRECISION, () => "x", portrait);
  assert.equal(clipped.changed, true);
  assert.deepEqual(clipped.fragments[0].erasures[0].points, [tip], "masks are stored in page units");
});

test("erasure masks paint in eraser space so the swept area matches the on-screen tip", () => {
  const calls = [];
  const context = new Proxy({}, {
    get: (_, key) => (typeof key === "string" && ["save", "restore", "scale", "beginPath", "arc", "fill", "moveTo", "lineTo", "stroke"].includes(key)
      ? (...args) => calls.push([key, ...args])
      : undefined),
    set: () => true
  });
  paintInkErasures(context, [{ radius: 5, points: [{ x: 100, y: 200 }] }], 2);
  assert.deepEqual(calls.find(([name]) => name === "scale"), ["scale", 2, 1]);
  assert.deepEqual(calls.find(([name]) => name === "arc").slice(1, 4), [50, 200, 5]);
  calls.length = 0;
  paintInkErasures(context, [{ radius: 5, points: [{ x: 100, y: 200 }] }]);
  assert.deepEqual(calls.find(([name]) => name === "scale"), ["scale", 1, 1]);
});

test("the eraser removes a vector shape it touches, and undo restores it in place", () => {
  const below = { id: "below", page: 1, type: "pen", width: 4, points: [{ x: 0, y: 900 }, { x: 10, y: 900 }] };
  const line = { id: "line", page: 1, type: "shape", shape: "line", color: "#111111", width: 6, opacity: 1, start: { x: 100, y: 100 }, end: { x: 500, y: 100 } };
  const box = { id: "box", page: 1, type: "shape", shape: "rectangle", color: "#111111", width: 4, opacity: 1, start: { x: 600, y: 600 }, end: { x: 800, y: 800 } };
  const above = { id: "above", page: 1, type: "pen", width: 4, points: [{ x: 0, y: 950 }, { x: 10, y: 950 }] };
  assert.equal(shapeIntersectsEraserPath(line, { x: 300, y: 92 }, { x: 300, y: 92 }, 6), true, "reaches the painted edge");
  assert.equal(shapeIntersectsEraserPath(line, { x: 300, y: 80 }, { x: 300, y: 80 }, 6), false);
  assert.equal(shapeIntersectsEraserPath(box, { x: 700, y: 700 }, { x: 700, y: 700 }, 6), false, "an unfilled box is erased by its outline");
  assert.equal(shapeIntersectsEraserPath({ ...box, fill: true }, { x: 700, y: 700 }, { x: 700, y: 700 }, 6), true);

  const annotations = [below, line, box, above];
  const session = createEraserSession();
  session.begin({ x: 300, y: 60 }, 1);
  session.append({ x: 300, y: 140 }, { annotationPage: 1, candidates: annotations, radius: 5, mode: ERASER_MODE.PRECISION });
  const { command: erased } = session.finish();
  assert.deepEqual(erased.before.map((item) => item.id), ["line"]);
  assert.deepEqual(erased.after, []);
  const command = withCommandPositions(erased, annotations);
  const redone = applyAnnotationCommand(annotations, command, "redo");
  assert.deepEqual(redone.map((item) => item.id), ["below", "box", "above"]);
  assert.deepEqual(applyAnnotationCommand(redone, command, "undo").map((item) => item.id), ["below", "line", "box", "above"]);
});

test("undoing a delete restores notes and marks exactly where they were, and redo deletes again", () => {
  const items = ["a", "note", "b", "c", "d"].map((id) => ({ id, page: 1, type: id === "note" ? "card" : "pen", x: 325, y: 260 }));
  const deleteNote = withCommandPositions({ type: "remove", items: [items[1]] }, items);
  const afterDelete = applyAnnotationCommand(items, deleteNote, "redo");
  assert.deepEqual(afterDelete.map((item) => item.id), ["a", "b", "c", "d"]);
  const restored = applyAnnotationCommand(afterDelete, deleteNote, "undo");
  assert.deepEqual(restored.map((item) => item.id), ["a", "note", "b", "c", "d"]);
  assert.equal(restored[1], items[1], "the same note object, position included, comes back");
  assert.deepEqual(applyAnnotationCommand(restored, deleteNote, "redo").map((item) => item.id), ["a", "b", "c", "d"]);

  const deleteMany = withCommandPositions({ type: "remove", items: [items[3], items[0]] }, items);
  const undone = applyAnnotationCommand(applyAnnotationCommand(items, deleteMany, "redo"), deleteMany, "undo");
  assert.deepEqual(undone.map((item) => item.id), ["a", "note", "b", "c", "d"]);
  // Commands recorded before positions existed still undo, appended as before.
  assert.deepEqual(applyAnnotationCommand(afterDelete, { type: "remove", items: [items[1]] }, "undo").map((item) => item.id), ["a", "b", "c", "d", "note"]);
});

test("a whole-stroke erase in the middle of the stack undoes back into its slot", () => {
  const strokes = ["one", "two", "three"].map((id, index) => ({ id, page: 1, type: "pen", profile: PEN_PROFILE.BALL, width: 4, points: [{ x: 10, y: 100 * (index + 1) }, { x: 200, y: 100 * (index + 1) }] }));
  const erase = withCommandPositions({ type: "replace", before: [strokes[1]], after: [] }, strokes);
  const erased = applyAnnotationCommand(strokes, erase, "redo");
  assert.deepEqual(erased.map((item) => item.id), ["one", "three"]);
  assert.deepEqual(applyAnnotationCommand(erased, erase, "undo").map((item) => item.id), ["one", "two", "three"]);
  // Partial erasing keeps the id, so it swaps in place both ways.
  const masked = { ...strokes[1], erasures: [{ radius: 5, points: [{ x: 50, y: 200 }] }] };
  const partial = withCommandPositions({ type: "replace", before: [strokes[1]], after: [masked] }, strokes);
  const partiallyErased = applyAnnotationCommand(strokes, partial, "redo");
  assert.equal(partiallyErased[1], masked);
  assert.deepEqual(applyAnnotationCommand(partiallyErased, partial, "undo"), strokes);
});

test("one eraser drag across many marks is one history command", () => {
  const strokes = Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, page: 1, type: index % 2 ? "highlighter" : "pen", profile: index % 2 ? PEN_PROFILE.HIGHLIGHTER : PEN_PROFILE.BALL, width: index % 2 ? 24 : 4, points: [{ x: 50, y: 100 + index * 60 }, { x: 450, y: 100 + index * 60 }] }));
  const session = createEraserSession({ idFactory: () => "fragment" });
  session.begin({ x: 250, y: 60 }, 1);
  for (let y = 70; y <= 460; y += 7) session.append({ x: 250 + Math.sin(y) * 3, y }, { annotationPage: 1, candidates: strokes, radius: 5, mode: ERASER_MODE.PRECISION, scale: eraserSpaceScale(1.414) });
  const { command } = session.finish();
  assert.equal(command.type, "replace");
  assert.equal(command.before.length, strokes.length);
  const positioned = withCommandPositions(command, strokes);
  const redone = applyAnnotationCommand(strokes, positioned, "redo");
  assert.ok(redone.every((item) => item.erasures?.length === 1));
  assert.deepEqual(applyAnnotationCommand(redone, positioned, "undo"), strokes);
});

test("while scrolling, only the page being read and blank neighbours keep rasterizing", async () => {
  const { deferDuringScroll } = await import("../src/workspace/catalog/renderBudget.js");
  const painted = { width: 1190 };
  const blank = { width: 0 };
  assert.equal(deferDuringScroll(0, painted), false, "the primary page always renders");
  assert.equal(deferDuringScroll(0, blank), false);
  assert.equal(deferDuringScroll(10, blank), false, "a blank next page fills in during the scroll");
  assert.equal(deferDuringScroll(11, blank), false, "a blank previous page fills in during the scroll");
  assert.equal(deferDuringScroll(10, painted), true, "a page that already shows a bitmap waits");
  assert.equal(deferDuringScroll(20, blank), true, "off-screen overscan waits for the scroll to settle");
  assert.equal(deferDuringScroll(31, null), true);
});
