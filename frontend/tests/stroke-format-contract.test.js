import assert from "node:assert/strict";
import test from "node:test";
import { strokeCenterlinePathRange } from "../src/workspace/ink/strokeModel.js";

// SVG coordinates must retain the previous decimal-rounding contract: an
// alternative such as Math.round(value * 100) changes saved/rendered geometry.
function legacyCoordinate(value) {
  const number = Number(value);
  return Number((Number.isFinite(number) ? number : 0).toFixed(2));
}

function checkCoordinate(value) {
  assert.equal(strokeCenterlinePathRange([{ x: value, y: value }]), `M${legacyCoordinate(value)} ${legacyCoordinate(value)}`, `coordinate ${value}`);
}

test("stroke coordinates preserve decimal midpoints, signed values and extreme fallbacks", () => {
  for (const value of [0, -0, 2.675, -2.675, 1.005, -1.005, .005, -.005, 999999.995, -999999.995, 1e6, -1e6, 1e21, -1e21, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, NaN, Infinity, -Infinity, undefined, null, "", "2.675"]) checkCoordinate(value);
  for (let index = 0; index < 5000; index += 1) {
    const midpoint = (index + .5) / 100;
    for (const sign of [1, -1]) for (const offset of [-2, -1, 0, 1, 2]) checkCoordinate(sign * (midpoint + offset * Number.EPSILON * Math.max(1, midpoint)));
  }
});

test("stroke coordinates preserve representative and arbitrary IEEE values", () => {
  let state = 0x671394ab;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const bits = new DataView(new ArrayBuffer(8));
  for (let index = 0; index < 20000; index += 1) {
    bits.setUint32(0, random());
    bits.setUint32(4, random());
    checkCoordinate(bits.getFloat64(0));
    checkCoordinate((random() / 0xffffffff - .5) * 2000);
  }
});
