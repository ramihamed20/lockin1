import assert from "node:assert/strict";
import test from "node:test";
import {
  horizontalPageFitsViewport,
  horizontalPageSlotWidth,
  horizontalSwipeTarget,
  horizontalZoomPageAnchor,
  scrollForHorizontalPageAnchor
} from "../src/workspace/catalog/horizontalPageLayout.js";

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

test("a horizontal zoom anchor follows its page despite a changing inter-page gutter", () => {
  const before = [
    { key: 1, rect: { left: 60, top: 80, width: 360, height: 500 } },
    { key: 2, rect: { left: 460, top: 80, width: 360, height: 500 } },
    { key: 3, rect: { left: 860, top: 80, width: 360, height: 500 } }
  ];
  const anchor = horizontalZoomPageAnchor(before, 580, 310, 2);
  assert.equal(anchor.pageKey, 2);
  assert.ok(Math.abs(anchor.x - 1 / 3) < 0.001);
  assert.ok(Math.abs(anchor.y - 0.46) < 0.001);
  // Zooming changes the gap between pages as well as the page dimensions.
  const afterRect = { left: 920, top: 110, width: 780, height: 1060 };
  const result = scrollForHorizontalPageAnchor({
    scrollLeft: 200,
    scrollTop: 70,
    pageRect: afterRect,
    anchor,
    clientX: 580,
    clientY: 310
  });
  const movedLeft = afterRect.left - (result.scrollLeft - 200);
  const movedTop = afterRect.top - (result.scrollTop - 70);
  assert.ok(Math.abs(movedLeft + anchor.x * afterRect.width - 580) < 0.001);
  assert.ok(Math.abs(movedTop + anchor.y * afterRect.height - 310) < 0.001);
});

test("nearest horizontal page is selected inside a gutter and virtual page keys are preserved", () => {
  const pages = [
    { key: -4, rect: { left: 40, top: 50, width: 250, height: 400 } },
    { key: 4, rect: { left: 340, top: 50, width: 250, height: 400 } }
  ];
  assert.equal(horizontalZoomPageAnchor(pages, 312, 100)?.pageKey, -4);
  assert.equal(horizontalZoomPageAnchor(pages, 320, 100, 4)?.pageKey, 4);
  assert.equal(horizontalZoomPageAnchor(pages, 480, 100)?.pageKey, 4);
  assert.equal(horizontalZoomPageAnchor(pages, Number.NaN, 100), null);
  assert.equal(horizontalZoomPageAnchor([], 400, 250), null);
});

test("a page larger than the viewport pans instead of turning on a swipe", () => {
  assert.equal(horizontalPageFitsViewport(390, 390), true);
  assert.equal(horizontalPageFitsViewport(391, 390), true);
  assert.equal(horizontalPageFitsViewport(430, 390), false);
  assert.equal(horizontalPageFitsViewport(940, 390), false);
  assert.equal(horizontalPageFitsViewport(undefined, 390), false);
});
