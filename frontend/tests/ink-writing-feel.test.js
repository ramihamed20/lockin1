import assert from "node:assert/strict";
import test from "node:test";
import { PEN_PROFILE, PRESSURE_SOURCE, strokeRenderGeometry, strokeWidthAtPoint } from "../src/workspace/ink/strokeModel.js";
import { createInkInputController } from "../src/workspace/ink/inkInputController.js";
import { catalogAnnotationToFocus, focusAnnotationSignature, focusAnnotationToCatalog } from "../src/workspace/catalog/focusAnnotationAdapter.js";
import { sanitizeCatalogAnnotation } from "../src/workspace/catalog/catalogWorkspaceState.js";

const ID = "0b8e0b0e-1111-4222-8333-444455556666";

function nibWidth(dx, dy) {
  const point = { x: 500, y: 500, p: .5, t: 100 };
  return strokeWidthAtPoint({ type: "pen", profile: PEN_PROFILE.CALLIGRAPHY, width: 10 }, point, {
    previous: { x: 500 - dx, y: 500 - dy, t: 0 },
    next: { x: 500 + dx, y: 500 + dy, t: 200 }
  });
}

test("a calligraphy nib is thick across its flat and a hairline along its edge", () => {
  const horizontal = nibWidth(10, 0);
  const vertical = nibWidth(0, 10);
  // The edge rises at 60 degrees (y grows downwards on the page).
  const alongEdge = nibWidth(5, -5 * Math.sqrt(3));
  const acrossEdge = nibWidth(5 * Math.sqrt(3), 5);
  assert.ok(horizontal > vertical, `horizontal ${horizontal} vs vertical ${vertical}`);
  assert.ok(alongEdge < horizontal / 2.5, `hairline ${alongEdge}`);
  assert.ok(acrossEdge > horizontal, `full flat ${acrossEdge}`);
  // Direction only matters for the angled nib.
  const ball = (dx, dy) => strokeWidthAtPoint({ type: "pen", profile: PEN_PROFILE.BALL, width: 10 }, { x: 500, y: 500, p: .5, t: 100 }, { previous: { x: 500 - dx, y: 500 - dy, t: 0 }, next: { x: 500 + dx, y: 500 + dy, t: 200 } });
  assert.equal(ball(10, 0), ball(0, 10));
});

test("an eraser asking without neighbours gets the full calligraphy nib", () => {
  const full = strokeWidthAtPoint({ type: "pen", profile: PEN_PROFILE.CALLIGRAPHY, width: 10 }, { x: 0, y: 0, p: .5 });
  assert.ok(full >= nibWidth(5 * Math.sqrt(3), 5) - 1e-9);
});

test("a calligraphy stroke outlines without gaps or invalid numbers", () => {
  const points = Array.from({ length: 120 }, (_, index) => ({ x: 100 + index * 4, y: 400 + Math.sin(index / 8) * 60, t: index * 10, p: .5 }));
  const geometry = strokeRenderGeometry({ id: "c", type: "pen", profile: PEN_PROFILE.CALLIGRAPHY, width: 6, opacity: 1, points }, 297 / 210);
  assert.equal(geometry.kind, "outline");
  assert.equal(/NaN|Infinity/.test(geometry.path), false);
});

function pointer(x, time, { pointerType = "touch", pressure = .5 } = {}) {
  return { pointerId: 4, pointerType, clientX: x, clientY: 200, timeStamp: time, pressure, buttons: 1, isPrimary: true };
}

function write(spacing, pointerType = "touch") {
  const controller = createInkInputController();
  controller.begin(pointer(0, 0, { pointerType }), { page: 1, pageUnitsPerCssPixel: 1, mapClientPoint: (x, y) => ({ x, y }) });
  for (let index = 1; index <= 40; index += 1) controller.append(pointer(index * spacing, index * 8, { pointerType }));
  return controller.finish(pointer(40 * spacing + spacing, 41 * 8, { pointerType })).points;
}

test("a finger writing slowly presses harder than one flicking quickly", () => {
  const slow = write(.4).at(-1).p;
  const fast = write(16).at(-1).p;
  assert.ok(slow > .65, `slow ${slow}`);
  assert.ok(fast < .4, `fast ${fast}`);
  // A pen's own pressure is never replaced.
  const pen = write(16, "pen").at(-1).p;
  assert.equal(pen, .5);
});

test("simulated pressure shapes only strokes that say they carry it", () => {
  const points = write(6);
  const simulated = { id: ID, page: 1, type: "pen", profile: PEN_PROFILE.FOUNTAIN, width: 6, opacity: 1, points, pressureSource: PRESSURE_SOURCE.SPEED };
  const legacy = { ...simulated, pressureSource: undefined, points: points.map((point) => ({ ...point, p: .5 })) };
  const widthAt = (stroke, index) => strokeWidthAtPoint(stroke, stroke.points[index], { previous: stroke.points[index - 1], next: stroke.points[index + 1] });
  assert.notEqual(widthAt(simulated, 20), widthAt({ ...simulated, pressureSource: undefined }, 20));
  // A stroke saved before simulation existed keeps its constant width.
  assert.equal(widthAt(legacy, 10), widthAt(legacy, 20));
});

test("calligraphy and simulated pressure reach another device and are not re-sent", () => {
  const original = sanitizeCatalogAnnotation({ id: ID, page: 2, type: "pen", profile: PEN_PROFILE.CALLIGRAPHY, color: "#102030", width: 6, opacity: 1, pressureSource: PRESSURE_SOURCE.SPEED, points: write(3) });
  const wire = catalogAnnotationToFocus(original);
  assert.deepEqual(wire.payload.style, { profile: "calligraphy", pressureSource: "speed" });
  const received = sanitizeCatalogAnnotation(focusAnnotationToCatalog({ ...JSON.parse(JSON.stringify(wire)), created_at: "2026-10-19T00:00:00Z" }));
  assert.equal(received.profile, PEN_PROFILE.CALLIGRAPHY);
  assert.equal(received.pressureSource, PRESSURE_SOURCE.SPEED);
  assert.equal(focusAnnotationSignature(received), focusAnnotationSignature(original));
});

test("a stored point keeps a missing stylus angle missing", () => {
  const stored = sanitizeCatalogAnnotation({ id: ID, page: 1, type: "pen", width: 4, points: [{ x: 1, y: 2, p: .5, altitudeAngle: null, azimuthAngle: undefined, twist: null, tangentialPressure: null }, { x: 3, y: 4, p: .5, altitudeAngle: .8, azimuthAngle: 0, twist: 0 }] });
  assert.equal(stored.points[0].altitudeAngle, null);
  assert.equal(stored.points[0].azimuthAngle, null);
  assert.equal(stored.points[0].twist, null);
  assert.equal(stored.points[0].tangentialPressure, null);
  assert.equal(stored.points[1].altitudeAngle, .8);
  assert.equal(stored.points[1].azimuthAngle, 0);
});

test("a phone writes with the finger until the student chooses; a tablet keeps fingers for scrolling", async () => {
  const { DRAWING_INPUT, defaultDrawingInput } = await import("../src/workspace/input/gestureStateMachine.js");
  assert.equal(defaultDrawingInput({ coarsePointer: true, shortestScreenSide: 390 }), DRAWING_INPUT.STYLUS_AND_FINGER);
  assert.equal(defaultDrawingInput({ coarsePointer: true, shortestScreenSide: 834 }), DRAWING_INPUT.STYLUS_ONLY);
  assert.equal(defaultDrawingInput({ coarsePointer: false, shortestScreenSide: 390 }), DRAWING_INPUT.STYLUS_ONLY);
  // A stored choice always wins, both ways.
  assert.equal(defaultDrawingInput({ stored: DRAWING_INPUT.STYLUS_ONLY, coarsePointer: true, shortestScreenSide: 390 }), DRAWING_INPUT.STYLUS_ONLY);
  assert.equal(defaultDrawingInput({ stored: DRAWING_INPUT.STYLUS_AND_FINGER, coarsePointer: true, shortestScreenSide: 834 }), DRAWING_INPUT.STYLUS_AND_FINGER);
  assert.equal(defaultDrawingInput({ stored: "junk", coarsePointer: true, shortestScreenSide: 834 }), DRAWING_INPUT.STYLUS_ONLY);
});
