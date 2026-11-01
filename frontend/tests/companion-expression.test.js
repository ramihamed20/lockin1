import assert from "node:assert/strict";
import test from "node:test";
import { expressionPose, expressionDuration, blendExpression } from "../src/lib/companionExpression.js";
import { createOriginalCompanionPlayer } from "../src/lib/originalCompanion.js";

test("speech articulates only during explanation; thinking and saving have distinct cues", () => {
  for (const character of ["boy", "girl"]) {
    const speech = Array.from({ length: 80 }, (_, i) => expressionPose("speaking", i / 20, i / 20, character).mouth);
    assert.ok(Math.max(...speech) > .9 && Math.min(...speech) < .05);
    for (const state of ["idle", "thinking", "invite", "saved", "settle"]) {
      assert.equal(expressionPose(state, .6, 1, character).mouth, 0);
    }
    assert.ok(expressionPose("thinking", 1, 1, character).thought > .9);
    assert.ok(expressionPose("saved", .6, 1, character).spark > .9);
    assert.equal(expressionPose("saved", expressionDuration("saved") / 1000, 2, character).spark, 0);
  }
});

test("both variants blink, retain long open-eye holds and clamp extreme pointer input", () => {
  for (const character of ["boy", "girl"]) {
    const poses = Array.from({ length: 1000 }, (_, i) => expressionPose("idle", i / 100, i / 100, character, { x: 999, y: -999 }));
    assert.ok(poses.some(p => p.eyeOpen < .1));
    assert.ok(poses.filter(p => p.eyeOpen === 1).length > 850);
    assert.ok(poses.every(p => p.eyeOpen > 0 && p.eyeOpen <= 1 && Math.abs(p.gazeX) <= 12 && Math.abs(p.gazeY) <= 7));
    for (const state of ["speaking", "thinking", "invite", "saved", "settle"]) {
      for (let t = 0; t < 10; t += .07) {
        const p = expressionPose(state, t, t, character);
        assert.ok(Object.values(p).every(Number.isFinite));
        assert.ok(p.sx > .9 && p.sy > .9);
      }
    }
  }
});

test("interrupts blend from the current expression without a first-frame jump", () => {
  const from = expressionPose("speaking", .8, 1, "girl");
  const to = expressionPose("saved", 0, 1, "girl");
  assert.deepEqual(blendExpression(from, to, 0), from);
  assert.deepEqual(blendExpression(from, to, 1), to);
});

test("destroy cancels the only RAF and a queued stale callback cannot restart it", () => {
  const previous = { window: globalThis.window, document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  const pending = new Map(); let serial = 0, draws = 0;
  const context = new Proxy({}, { get: (_, key) => key === "getImageData" ? () => ({ data: new Uint8ClampedArray(235 * 240 * 4) }) : key === "drawImage" ? () => draws++ : () => {} });
  try {
    globalThis.window = { Path2D: class { rect() {} moveTo() {} lineTo() {} closePath() {} } };
    globalThis.document = { createElement: () => ({ getContext: () => context }) };
    globalThis.requestAnimationFrame = cb => { pending.set(++serial, cb); return serial; };
    globalThis.cancelAnimationFrame = id => pending.delete(id);
    const player = createOriginalCompanionPlayer({ width: 512, height: 512, getContext: () => context }, {}, "girl");
    assert.equal(pending.size, 1);
    const run = time => { const [id, cb] = pending.entries().next().value; pending.delete(id); cb(time); };
    run(0); const count = draws;
    run(10); assert.equal(draws, count, "30fps cap skips redundant painting");
    player.setState("speaking"); run(40);
    assert.ok(draws > count);
    assert.equal(pending.size, 1);
    const stale = pending.values().next().value;
    player.destroy(); assert.equal(pending.size, 0);
    stale(80); assert.equal(pending.size, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
