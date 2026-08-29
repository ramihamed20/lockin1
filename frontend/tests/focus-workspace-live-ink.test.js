import assert from "node:assert/strict";
import test from "node:test";

import { elasticZoomScale } from "../src/workspace/input/elasticGesture.js";
import { createLiveStrokeGeometry } from "../src/workspace/ink/liveStrokeGeometry.js";
import {
  PEN_PROFILE,
  strokeProfileConfig,
  strokeRenderGeometry,
  strokeTaperLengths,
  strokeWidthAtPoint
} from "../src/workspace/ink/strokeModel.js";

function stroke(count, overrides = {}) {
  return {
    id: "live-stroke",
    page: 1,
    type: "pen",
    profile: PEN_PROFILE.FOUNTAIN,
    color: "#8b5cf6",
    width: 8,
    opacity: 1,
    pressureSensitivity: .55,
    smoothing: .5,
    ...overrides,
    points: Array.from({ length: count }, (_, index) => ({
      x: 40 + index * 6.5,
      y: 220 + Math.sin(index / 4) * 34,
      t: index * 8,
      p: .5,
      pointer: "pen",
      pressureAvailable: true
    }))
  };
}

test("rubber-band zoom resists past both limits and only ever commits a legal scale", () => {
  const inside = elasticZoomScale(2.4, .7, 5);
  assert.equal(inside.legal, 2.4);
  assert.equal(inside.display, 2.4);
  assert.equal(inside.overshoot, 0);

  const above = elasticZoomScale(11, .7, 5);
  assert.equal(above.legal, 5);
  assert.ok(above.display > 5);
  assert.ok(above.display <= 5 * 1.22, `overshoot stayed bounded, got ${above.display}`);

  const below = elasticZoomScale(.05, .7, 5);
  assert.equal(below.legal, .7);
  assert.ok(below.display < .7);
  assert.ok(below.display >= .7 / 1.22, `overshoot stayed bounded, got ${below.display}`);

  // Resistance is symmetric in ratio terms, so pinching out feels like pinching
  // in: the same relative pull past either limit yields the same relative give.
  const pull = 1.8;
  const outRatio = elasticZoomScale(5 * pull, .7, 5).display / 5;
  const inRatio = .7 / elasticZoomScale(.7 / pull, .7, 5).display;
  assert.ok(Math.abs(outRatio - inRatio) < .001, `${outRatio} vs ${inRatio}`);

  // A drag far past the limit still cannot escape the elastic band.
  assert.ok(elasticZoomScale(500, .7, 5).display < 5 * 1.25);
});

test("taper spans are fixed arc lengths so an early sample stops changing width mid-stroke", () => {
  const config = strokeProfileConfig({ type: "pen", profile: PEN_PROFILE.FOUNTAIN });
  const spans = strokeTaperLengths(config, 8);
  assert.ok(spans.start > 0 && spans.end > 0);
  // The span depends only on the nib, never on how long the stroke has become.
  assert.deepEqual(strokeTaperLengths(config, 8), spans);

  const annotation = { type: "pen", profile: PEN_PROFILE.FOUNTAIN, width: 8, pressureSensitivity: .55 };
  const point = { x: 0, y: 0, p: .5, t: 0, pointer: "pen", pressureAvailable: true };
  const context = (totalLength) => ({
    previous: { x: -1, y: 0, t: -8 },
    next: { x: 1, y: 0, t: 8 },
    distanceFromStart: spans.start + 40,
    distanceFromEnd: totalLength - (spans.start + 40),
    totalLength
  });
  const early = strokeWidthAtPoint(annotation, point, context(400));
  const later = strokeWidthAtPoint(annotation, point, context(900));
  assert.equal(early, later);
});

test("a growing stroke never narrows an already painted sample", () => {
  const annotation = { type: "pen", profile: PEN_PROFILE.BRUSH, width: 8, pressureSensitivity: .55 };
  const point = { x: 0, y: 0, p: .5, t: 0, pointer: "pen", pressureAvailable: true };
  let previousWidth = 0;
  for (const totalLength of [30, 60, 120, 240, 480, 960]) {
    const width = strokeWidthAtPoint(annotation, point, {
      previous: { x: -1, y: 0, t: -8 },
      next: { x: 1, y: 0, t: 8 },
      distanceFromStart: 20,
      distanceFromEnd: totalLength - 20,
      totalLength
    });
    assert.ok(width >= previousWidth - 1e-9, `width shrank from ${previousWidth} to ${width}`);
    previousWidth = width;
  }
});

test("incremental live geometry matches a single full render of the finished stroke", () => {
  const live = createLiveStrokeGeometry();
  let appended = 0;
  let full = 0;
  for (let count = 1; count <= 60; count += 1) {
    const result = live.frame(stroke(count));
    if (result.mode === "append") appended += 1;
    else full += 1;
  }
  assert.ok(appended > 50, `most frames appended, got ${appended}`);
  assert.ok(full <= 3, `only the first frames repainted fully, got ${full}`);

  const reference = strokeRenderGeometry(stroke(60));
  const fresh = createLiveStrokeGeometry().frame(stroke(60));
  assert.equal(fresh.mode, "full");
  assert.equal(fresh.kind, reference.kind);
  assert.equal(fresh.path, reference.path);
  assert.equal(fresh.opacity, reference.opacity);
});

test("append mode emits only the geometry after the last painted sample", () => {
  const live = createLiveStrokeGeometry();
  live.frame(stroke(40));
  const tail = live.frame(stroke(41));
  assert.equal(tail.mode, "append");
  const wholeStroke = createLiveStrokeGeometry().frame(stroke(41));
  assert.ok(tail.path.length * 4 < wholeStroke.path.length, `tail ${tail.path.length} vs full ${wholeStroke.path.length}`);
});

test("predicted samples, tool changes, and cleared surfaces all force a full repaint", () => {
  const live = createLiveStrokeGeometry();
  live.frame(stroke(20));
  assert.equal(live.frame(stroke(21)).mode, "append");

  const predicted = [{ x: 400, y: 240, t: 200, p: .5, pointer: "pen", pressureAvailable: true }];
  const withPrediction = live.frame(stroke(22), predicted);
  assert.equal(withPrediction.mode, "full");
  // The frame after a prediction must also repaint, otherwise the discarded
  // predicted tail would stay on the canvas.
  assert.equal(live.frame(stroke(23)).mode, "full");
  assert.equal(live.frame(stroke(24)).mode, "append");

  live.invalidate();
  assert.equal(live.frame(stroke(25)).mode, "full");

  assert.equal(live.frame(stroke(26)).mode, "append");
  assert.equal(live.frame(stroke(27, { id: "another-stroke" })).mode, "full");
});

test("live highlighter geometry stays a centerline and appends without repainting the whole path", () => {
  const highlighter = (count) => stroke(count, { id: "live-highlight", type: "highlighter", profile: PEN_PROFILE.HIGHLIGHTER, width: 28, opacity: .34 });
  const live = createLiveStrokeGeometry();
  const first = live.frame(highlighter(30));
  assert.equal(first.kind, "centerline");
  assert.equal(first.composite, "multiply");
  assert.equal(first.mode, "full");
  const next = live.frame(highlighter(31));
  assert.equal(next.mode, "append");
  assert.ok(next.path.startsWith("M"));
  assert.ok(next.path.length < first.path.length / 3);

  const reference = strokeRenderGeometry(highlighter(31));
  const fresh = createLiveStrokeGeometry().frame(highlighter(31));
  assert.equal(fresh.path, reference.path);
  assert.equal(fresh.width, reference.width);
  assert.equal(fresh.opacity, reference.opacity);
});

test("a single sample renders as a full-width dot rather than a tapered speck", () => {
  const live = createLiveStrokeGeometry();
  const dot = live.frame(stroke(1));
  assert.equal(dot.kind, "dot");
  assert.equal(dot.mode, "full");
  // An untapered nib: a deliberate tap must be visible, and eraser hit-testing
  // uses the same width when no positional context is available.
  assert.ok(dot.radius >= 8 * .45, `dot radius ${dot.radius}`);
  assert.equal(dot.radius, strokeWidthAtPoint(stroke(1), stroke(1).points[0]) / 2);
});
