import assert from "node:assert/strict";
import test from "node:test";
import { horizontalPageSlotWidth, horizontalSwipeTarget } from "../src/workspace/catalog/horizontalPageLayout.js";

test("paged PDF slots fit the viewport and leave a margin when zoomed", () => {
  assert.equal(horizontalPageSlotWidth(390, 0.5), 390);
  assert.equal(horizontalPageSlotWidth(390, 2), 1214);
});

test("horizontal swipe advances one accessible PDF or inserted page", () => {
  const keys = [3, -4, 4, 5];
  assert.equal(horizontalSwipeTarget(keys, 3, -100, 5, 390), -4);
  assert.equal(horizontalSwipeTarget(keys, -4, -100, 1, 390), 4);
  assert.equal(horizontalSwipeTarget(keys, 4, 110, 1, 390), -4);
  assert.equal(horizontalSwipeTarget(keys, 5, -100, 2, 390), 5);
  assert.equal(horizontalSwipeTarget(keys, 3, 110, 1, 390), 3);
});

test("short, vertical and missing-page gestures cannot accidentally turn pages", () => {
  const keys = [1, 2, 3];
  assert.equal(horizontalSwipeTarget(keys, 2, -20, 0, 390), 2);
  assert.equal(horizontalSwipeTarget(keys, 2, -90, 150, 390), null);
  assert.equal(horizontalSwipeTarget(keys, 42, -90, 0, 390), null);
});
