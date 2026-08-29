import assert from "node:assert/strict";
import test from "node:test";

import { addSavedColor, normalizeSavedPalette, removeSavedColor } from "../src/workspace/catalog/toolPalette.js";

test("custom colors commit once during duplicate and rapid updates", () => {
  let palette = [];
  palette = addSavedColor(palette, "#ABCDEF");
  palette = addSavedColor(palette, "#abcdef");
  palette = addSavedColor(palette, "#abcdef");
  assert.deepEqual(palette, ["#abcdef"]);

  for (const color of ["#111111", "#222222", "#333333", "#444444"]) {
    palette = addSavedColor(palette, color);
  }
  assert.deepEqual(palette, ["#444444", "#333333", "#222222", "#111111", "#abcdef"]);
});

test("saved palettes are normalized and deduplicated after reload", () => {
  assert.deepEqual(normalizeSavedPalette([
    "#8B5CF6",
    "#8b5cf6",
    "not-a-color",
    "#20B982",
    "#20b982"
  ]), ["#8b5cf6", "#20b982"]);
});

test("a palette never exceeds ten colors and deletion immediately restores capacity", () => {
  const defaults = ["#100001", "#100002", "#100003", "#100004", "#100005"];
  let custom = [];
  for (const color of ["#200001", "#200002", "#200003", "#200004", "#200005"]) {
    custom = addSavedColor(custom, color, 10, defaults);
  }
  assert.equal(normalizeSavedPalette([...defaults, ...custom], 10).length, 10);
  assert.deepEqual(addSavedColor(custom, "#200006", 10, defaults), custom);

  custom = removeSavedColor(custom, "#200003", 10, defaults);
  assert.equal(normalizeSavedPalette([...defaults, ...custom], 10).length, 9);
  custom = addSavedColor(custom, "#200006", 10, defaults);
  assert.equal(normalizeSavedPalette([...defaults, ...custom], 10).length, 10);
  assert.ok(custom.includes("#200006"));
});

test("default colors cannot be duplicated or deleted through custom palette logic", () => {
  const defaults = ["#8b5cf6", "#20b982"];
  assert.deepEqual(addSavedColor([], "#8B5CF6", 10, defaults), []);
  assert.deepEqual(removeSavedColor(["#123456"], "#8b5cf6", 10, defaults), ["#123456"]);
});
