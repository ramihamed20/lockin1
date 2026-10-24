import assert from "node:assert/strict";
import test from "node:test";
import { catalogAnnotationToFocus, focusAnnotationSignature, focusAnnotationToCatalog } from "../src/workspace/catalog/focusAnnotationAdapter.js";
import { reduceStrokeSamples, simplifyStroke } from "../src/workspace/ink/strokeReduction.js";
import { sanitizeCatalogAnnotation } from "../src/workspace/catalog/catalogWorkspaceState.js";

const ID = "0b8e0b0e-1111-4222-8333-444455556666";

function stroke(count, extra = {}) {
  return {
    id: ID, page: 3, type: "pen", color: "#112233", width: 4, opacity: 1,
    profile: "ball", pressureSensitivity: .55, smoothing: .5,
    points: Array.from({ length: count }, (_, index) => ({
      x: 100 + index * (780 / count) + Math.sin(index / 9) * 14,
      y: 300 + Math.cos(index / 13) * 22 + (index % 400) * .05,
      p: .45 + Math.sin(index / 31) * .25,
      tiltX: 10, tiltY: -4, t: 1_792_000_000_000 + index * 4, pointer: "pen"
    })),
    ...extra
  };
}

/** Wire JSON as the server would read it back. */
function serverRoundTrip(wire) {
  return { ...JSON.parse(JSON.stringify(wire)), created_at: "2026-10-19T00:00:00.000Z" };
}

function distanceToPolyline(point, polyline) {
  let best = Infinity;
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1];
    const end = polyline[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = dx * dx + dy * dy;
    const ratio = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio)));
  }
  return best;
}

test("a fountain pen stroke reaches another device with its nib, sensitivity and smoothing", () => {
  const original = stroke(80, { profile: "fountain", pressureSensitivity: .8, smoothing: .72 });
  const wire = catalogAnnotationToFocus(original);
  assert.deepEqual(wire.payload.style, { profile: "fountain", pressureSensitivity: .8, smoothing: .72 });
  const received = sanitizeCatalogAnnotation(focusAnnotationToCatalog(serverRoundTrip(wire)));
  assert.equal(received.profile, "fountain");
  assert.equal(received.pressureSensitivity, .8);
  assert.equal(received.smoothing, .72);
  // Read back, it converts to exactly what was sent, so it is never re-sent.
  assert.equal(focusAnnotationSignature(received), focusAnnotationSignature(original));
});

test("default strokes carry no style, so strokes saved before it existed are not re-sent", () => {
  for (const type of ["pen", "pencil", "highlighter"]) {
    const original = sanitizeCatalogAnnotation({ ...stroke(20), type, profile: undefined, pressureSensitivity: undefined, smoothing: undefined });
    const wire = catalogAnnotationToFocus(original);
    assert.equal("style" in wire.payload, false, type);
    const received = sanitizeCatalogAnnotation(focusAnnotationToCatalog(serverRoundTrip(wire)));
    assert.equal(received.profile, type === "pen" ? "ball" : type);
    assert.equal(focusAnnotationSignature(received), focusAnnotationSignature(original));
  }
});

test("a long stroke is simplified to fit the server instead of being refused", () => {
  const erasures = Array.from({ length: 32 }, (_, index) => ({ radius: 6, points: Array.from({ length: 96 }, (_, point) => ({ x: 100 + index * 7 + point * .3, y: 280 + point * .4 })) }));
  // Ordinary long strokes stay within a third of a pixel. A scribble nineteen
  // pages long carrying every erasure the server allows cannot keep its shape
  // in 128 KiB; what matters is that it still syncs instead of stopping the sheet.
  for (const [original, tolerance] of [[stroke(1300), .6], [stroke(4000), .6], [stroke(12_000, { erasures }), Infinity]]) {
    const wire = catalogAnnotationToFocus(original);
    assert.ok(wire, "the stroke still syncs");
    assert.ok(wire.payload.samples.length <= 2048);
    assert.ok(JSON.stringify(wire.payload).length < 128 * 1024, `${JSON.stringify(wire.payload).length} bytes`);
    const received = focusAnnotationToCatalog(serverRoundTrip(wire)).points;
    assert.deepEqual([received[0].x, received.at(-1).x].map((value) => Math.round(value)), [original.points[0].x, original.points.at(-1).x].map((value) => Math.round(value)), "both ends survive");
    const worst = Math.max(...original.points.map((point) => distanceToPolyline(point, received)));
    // A page unit is 1/1000 of the page: 0.6 is about a third of a css px.
    assert.ok(worst < tolerance, `the simplified line stays within ${worst} page units`);
  }
});

test("simplification keeps the first and last samples and pressure changes", () => {
  const flat = Array.from({ length: 50 }, (_, index) => ({ x: index, y: 0, p: index === 25 ? .95 : .5 }));
  const kept = simplifyStroke(flat, .2);
  assert.equal(kept[0], flat[0]);
  assert.equal(kept.at(-1), flat.at(-1));
  assert.ok(kept.includes(flat[25]), "a pressure spike is a feature of the stroke");
  assert.equal(reduceStrokeSamples(flat, 100), flat, "short strokes are untouched");
  assert.ok(reduceStrokeSamples(stroke(3000).points, 300).length <= 300);
});
