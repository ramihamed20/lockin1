import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TRANSIENT_FADE_MS,
  TRANSIENT_HOLD_MS,
  TRANSIENT_INK_KIND,
  createTransientInk,
  transientAlpha
} from "../src/workspace/ink/transientInk.js";

function clockAt(start = 0) {
  const clock = { time: start, now: () => clock.time };
  return clock;
}

test("ink holds while the pen is down and for three seconds after it stops, then fades", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.NEON, page: 1, color: "#ff2d55", width: 8, point: { x: 0, y: 0 } });
  clock.time = 5_000;
  ink.extend([{ x: 50, y: 50 }]);
  const [stroke] = ink.visible(1, clock.time);
  assert.equal(transientAlpha(stroke, clock.time), 1);
  assert.equal(ink.isDrawing(), true);

  ink.end();
  assert.equal(ink.isDrawing(), false);
  // Not at the lift, not just before the three seconds are up.
  clock.time += TRANSIENT_HOLD_MS - 1;
  assert.equal(transientAlpha(stroke, clock.time), 1);
  assert.equal(ink.visible(1, clock.time).length, 1);

  clock.time += 1 + TRANSIENT_FADE_MS / 2;
  assert.ok(transientAlpha(stroke, clock.time) > 0 && transientAlpha(stroke, clock.time) < 1);
  clock.time += TRANSIENT_FADE_MS;
  assert.deepEqual(ink.visible(1, clock.time), []);
});

test("Pointer ink follows the same hold and fade as Neon", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 3, color: "#f00", width: 8, point: { x: 10, y: 10 } });
  clock.time = 2_000;
  ink.extend([{ x: 20, y: 20 }]);
  const [stroke] = ink.visible(3, clock.time);
  assert.equal(stroke.points.length, 2);
  assert.equal(transientAlpha(stroke, clock.time), 1);
  ink.end();
  clock.time += TRANSIENT_HOLD_MS;
  assert.equal(transientAlpha(stroke, clock.time), 1);
  clock.time += TRANSIENT_FADE_MS;
  assert.deepEqual(ink.visible(3, clock.time), []);
});

test("writing again inside the hold keeps earlier strokes until the student stops", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.NEON, page: 1, color: "#fff", width: 4, point: { x: 0, y: 0 } });
  ink.end();
  const [first] = ink.visible(1, clock.time);

  clock.time = TRANSIENT_HOLD_MS - 500;
  ink.begin({ kind: TRANSIENT_INK_KIND.NEON, page: 1, color: "#fff", width: 4, point: { x: 5, y: 5 } });
  clock.time = TRANSIENT_HOLD_MS + 2_000;
  assert.equal(transientAlpha(first, clock.time), 1);
  assert.equal(ink.visible(1, clock.time).length, 2);

  ink.end();
  clock.time += TRANSIENT_HOLD_MS;
  assert.equal(ink.visible(1, clock.time).length, 2);
  clock.time += TRANSIENT_FADE_MS;
  assert.deepEqual(ink.visible(1, clock.time), []);
});

test("ink that already started fading is not pulled back by a new stroke", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.NEON, page: 1, color: "#fff", width: 4, point: { x: 0, y: 0 } });
  ink.end();
  const [first] = ink.visible(1, clock.time);
  clock.time = TRANSIENT_HOLD_MS + TRANSIENT_FADE_MS / 2;
  const fading = transientAlpha(first, clock.time);
  assert.ok(fading < 1);
  ink.begin({ kind: TRANSIENT_INK_KIND.NEON, page: 1, color: "#fff", width: 4, point: { x: 5, y: 5 } });
  assert.equal(transientAlpha(first, clock.time), fading);
});

test("transient ink is scoped to its page and notifies the canvas", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  let notified = 0;
  const unsubscribe = ink.subscribe(() => { notified += 1; });
  ink.begin({ kind: TRANSIENT_INK_KIND.NEON, page: 2, color: "#fff", width: 4, point: { x: 1, y: 1 } });
  assert.equal(ink.visible(1).length, 0);
  assert.equal(ink.visible(2).length, 1);
  unsubscribe();
  ink.end();
  assert.equal(notified, 1);
});

test("Pointer and Neon never enter the annotation commit path", async () => {
  const workspace = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  // They begin before a draft id exists, so nothing reaches runCommand.
  assert.match(workspace, /if \(activeTool === "pen" && TRANSIENT_PEN_PROFILES\.has\(penProfile\)\) \{[\s\S]{0,400}?return;\s*\}\s*const id = generateIdempotencyKey\(\);/);
  assert.match(workspace, /if \(gesture\.transientInkPage != null\) \{\s*transientInkRef\.current\.end\(\);/);
});
