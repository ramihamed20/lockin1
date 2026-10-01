import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  NEON_FADE_MS,
  POINTER_TRAIL_MS,
  TRANSIENT_INK_KIND,
  createTransientInk,
  neonAlpha,
  pointerAlpha
} from "../src/workspace/ink/transientInk.js";

function clockAt(start = 0) {
  const clock = { time: start, now: () => clock.time };
  return clock;
}

test("a pointer trail fades sample by sample while the pen is still down", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 3, color: "#f00", width: 8, point: { x: 10, y: 10 } });
  clock.time = 400;
  ink.extend([{ x: 20, y: 20 }]);
  const [stroke] = ink.visible(3, clock.time);
  assert.ok(pointerAlpha(stroke.points[0].t, clock.time) < 1);
  assert.equal(pointerAlpha(stroke.points[1].t, clock.time), 1);

  // Held still: the stroke stays (its tip dot) even once every segment faded.
  clock.time = 400 + POINTER_TRAIL_MS + 50;
  assert.equal(ink.visible(3, clock.time).length, 1);
  assert.equal(pointerAlpha(stroke.points[1].t, clock.time), 0);

  // Old samples are trimmed rather than kept for the whole gesture.
  ink.extend([{ x: 30, y: 30 }]);
  assert.ok(stroke.points.length <= 2);

  ink.end();
  clock.time += POINTER_TRAIL_MS;
  assert.deepEqual(ink.visible(3, clock.time), []);
});

test("neon holds for the whole gesture and fades only after the lift", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.NEON, page: 1, color: "#ff2d55", width: 8, point: { x: 0, y: 0 } });
  clock.time = 5_000;
  ink.extend([{ x: 50, y: 50 }]);
  const [stroke] = ink.visible(1, clock.time);
  assert.equal(neonAlpha(stroke, clock.time), 1);
  assert.equal(ink.isDrawing(), true);

  ink.end();
  clock.time += NEON_FADE_MS / 2;
  assert.ok(neonAlpha(stroke, clock.time) > 0 && neonAlpha(stroke, clock.time) < 1);
  clock.time += NEON_FADE_MS;
  assert.deepEqual(ink.visible(1, clock.time), []);
  assert.equal(ink.isDrawing(), false);
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
