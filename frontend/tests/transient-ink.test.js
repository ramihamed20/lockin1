import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TRANSIENT_FADE_MS,
  TRANSIENT_HOLD_MS,
  TRANSIENT_INK_KIND,
  TRANSIENT_PEN_PROFILES,
  createTransientInk,
  currentPenProfile,
  transientAlpha
} from "../src/workspace/ink/transientInk.js";

function clockAt(start = 0) {
  const clock = { time: start, now: () => clock.time };
  return clock;
}

test("ink holds while the pen is down and for a moment after it stops, then fades", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 1, color: "#ff2d55", width: 8, point: { x: 0, y: 0 } });
  clock.time = 5_000;
  ink.extend([{ x: 50, y: 50 }]);
  const [stroke] = ink.visible(1, clock.time);
  assert.equal(transientAlpha(stroke, clock.time), 1);
  assert.equal(ink.isDrawing(), true);

  ink.end();
  assert.equal(ink.isDrawing(), false);
  // Not at the lift, not just before the hold is up.
  clock.time += TRANSIENT_HOLD_MS - 1;
  assert.equal(transientAlpha(stroke, clock.time), 1);
  assert.equal(ink.visible(1, clock.time).length, 1);

  clock.time += 1 + TRANSIENT_FADE_MS / 2;
  assert.ok(transientAlpha(stroke, clock.time) > 0 && transientAlpha(stroke, clock.time) < 1);
  clock.time += TRANSIENT_FADE_MS;
  assert.deepEqual(ink.visible(1, clock.time), []);
});

test("Pointer is the only transient pen, and a remembered Neon choice opens it", () => {
  assert.deepEqual([...TRANSIENT_PEN_PROFILES], [TRANSIENT_INK_KIND.POINTER]);
  assert.equal(currentPenProfile("neon"), TRANSIENT_INK_KIND.POINTER);
  assert.equal(currentPenProfile("pointer"), TRANSIENT_INK_KIND.POINTER);
  assert.equal(currentPenProfile("ball"), "ball");
  // It clears a little faster than before: under two seconds from the lift.
  assert.ok(TRANSIENT_HOLD_MS + TRANSIENT_FADE_MS < 2_000);
});

test("writing again inside the hold keeps earlier strokes until the student stops", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 1, color: "#fff", width: 4, point: { x: 0, y: 0 } });
  ink.end();
  const [first] = ink.visible(1, clock.time);

  clock.time = TRANSIENT_HOLD_MS - 500;
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 1, color: "#fff", width: 4, point: { x: 5, y: 5 } });
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
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 1, color: "#fff", width: 4, point: { x: 0, y: 0 } });
  ink.end();
  const [first] = ink.visible(1, clock.time);
  clock.time = TRANSIENT_HOLD_MS + TRANSIENT_FADE_MS / 2;
  const fading = transientAlpha(first, clock.time);
  assert.ok(fading < 1);
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 1, color: "#fff", width: 4, point: { x: 5, y: 5 } });
  assert.equal(transientAlpha(first, clock.time), fading);
});

test("transient ink is scoped to its page and notifies the canvas", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  let notified = 0;
  const unsubscribe = ink.subscribe(() => { notified += 1; });
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 2, color: "#fff", width: 4, point: { x: 1, y: 1 } });
  assert.equal(ink.visible(1).length, 0);
  assert.equal(ink.visible(2).length, 1);
  unsubscribe();
  ink.end();
  assert.equal(notified, 1);
});

test("Pointer ink never enters the annotation commit path", async () => {
  const workspace = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  // They begin before a draft id exists, so nothing reaches runCommand.
  assert.match(workspace, /if \(activeTool === "pen" && TRANSIENT_PEN_PROFILES\.has\(penProfile\)\) \{[\s\S]{0,400}?return;\s*\}\s*const id = generateIdempotencyKey\(\);/);
  assert.match(workspace, /if \(gesture\.transientInkPage != null\) \{\s*transientInkRef\.current\.end\(\);/);
});

test("only the stroke under the pen is live, so a held earlier stroke never lights up its tip", () => {
  const clock = clockAt();
  const ink = createTransientInk({ clock: clock.now });
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 1, color: "#fff", width: 4, point: { x: 0, y: 0 } });
  const [first] = ink.visible(1, clock.time);
  assert.equal(first.live, true);
  ink.end();
  assert.equal(first.live, false);
  // Writing again inside the hold brings the first stroke back to full
  // opacity, but it stays not live: only the new stroke gets the spark.
  clock.time = 200;
  ink.begin({ kind: TRANSIENT_INK_KIND.POINTER, page: 1, color: "#fff", width: 4, point: { x: 5, y: 5 } });
  const [held, second] = ink.visible(1, clock.time);
  assert.equal(held.fadeAt, null);
  assert.equal(held.live, false);
  assert.equal(second.live, true);
});

test("pen thickness moves continuously and a live highlight merges with saved ones", async () => {
  const workspace = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  assert.match(workspace, /const THICKNESS_STEP = \.01;/);
  assert.match(workspace, /step=\{THICKNESS_STEP\} onChange=\{\(size\) => setBrushSize\(roundThickness\(size\)\)\}/);
  assert.match(workspace, /setMergeTargets\?\.\(activeTool === "highlighter"/);
  const live = await readFile(new URL("../src/workspace/ink/LiveAnnotationCanvas.jsx", import.meta.url), "utf8");
  assert.match(live, /if \(annotation\?\.type === "highlighter" && mergeTargetsRef\.current\.length\) cutMergedHighlights/);
});
