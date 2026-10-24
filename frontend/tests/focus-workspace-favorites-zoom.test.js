import assert from "node:assert/strict";
import test from "node:test";

import { matchingFavoritePen, MAX_FAVORITE_PENS, normalizeFavoritePen, normalizeFavoritePens } from "../src/pages/focus-workspace/favoritePens.js";
import { advanceZoomRegion, clampZoomRegion, initialZoomRegion, nextZoomLine, ZOOM_MARGIN_END, ZOOM_MARGIN_START, zoomRegionHeight } from "../src/pages/focus-workspace/zoomWindowModel.js";

test("a favorite pen keeps only what can be trusted", () => {
  assert.deepEqual(normalizeFavoritePen({ tool: "pen", profile: "fountain", color: "#2563EB", width: 3.456, opacity: .5 }), { tool: "pen", profile: "fountain", color: "#2563eb", width: 3.46, opacity: .5 });
  assert.equal(normalizeFavoritePen({ tool: "eraser", color: "#000000" }), null);
  assert.equal(normalizeFavoritePen({ tool: "pen", color: "red" }), null);
  // Out-of-range values are clamped; an unknown pen type becomes the ball pen.
  assert.deepEqual(normalizeFavoritePen({ tool: "pen", profile: "quill", color: "#000000", width: 99, opacity: 0 }), { tool: "pen", profile: "ball", color: "#000000", width: 12, opacity: .05 });
  assert.equal(normalizeFavoritePen({ tool: "highlighter", color: "#f5b700", width: 4 }).profile, "highlighter");
  const many = Array.from({ length: 7 }, (_, index) => ({ tool: "pen", profile: "ball", color: `#00000${index}`, width: 4, opacity: 1 }));
  assert.equal(normalizeFavoritePens(many).length, MAX_FAVORITE_PENS);
});

test("the pen in use is recognised as the favorite it matches", () => {
  const favorites = normalizeFavoritePens([
    { tool: "pen", profile: "fountain", color: "#2563eb", width: 4, opacity: 1 },
    { tool: "highlighter", profile: "highlighter", color: "#f5b700", width: 4, opacity: .34 }
  ]);
  assert.equal(matchingFavoritePen(favorites, { tool: "pen", profile: "fountain", color: "#2563EB", width: 4, opacity: 1 }), 0);
  assert.equal(matchingFavoritePen(favorites, { tool: "highlighter", profile: "ball", color: "#f5b700", width: 4, opacity: .34 }), 1);
  assert.equal(matchingFavoritePen(favorites, { tool: "pen", profile: "brush", color: "#2563eb", width: 4, opacity: 1 }), -1);
  assert.equal(matchingFavoritePen(favorites, { tool: "pen", profile: "fountain", color: "#2563eb", width: 5, opacity: 1 }), -1);
});

test("the zoom box's height follows the window's shape and the page's", () => {
  // A 400x100 window over a 300-unit box on an A4 page.
  const height = zoomRegionHeight(300, { width: 400, height: 100 }, 842 / 595);
  assert.ok(Math.abs(height - 75 / (842 / 595)) < 1e-9);
});

test("writing moves the box along the line and on to the next", () => {
  const height = 60;
  let region = initialZoomRegion(3, 100);
  assert.deepEqual(region, { page: 3, x: ZOOM_MARGIN_START, y: 100, w: 300 });
  region = advanceZoomRegion(region, height);
  assert.equal(region.x, ZOOM_MARGIN_START + 300 * .55);
  const xs = [region.x];
  while (region.x < ZOOM_MARGIN_END - 300) { region = advanceZoomRegion(region, height); xs.push(region.x); }
  // Steps along the line, never past its end, ending flush with the margin.
  assert.deepEqual(xs, [205, 370, 535, 660]);
  assert.equal(region.y, 100);
  // At the end of the line the box starts the next one, a little lower.
  region = advanceZoomRegion(region, height);
  assert.deepEqual([region.x, region.y], [ZOOM_MARGIN_START, 100 + height * .9]);
  assert.deepEqual([nextZoomLine({ page: 1, x: 500, y: 980, w: 300 }, height).y], [1000 - height]);
});

test("in Arabic the box moves right to left and lines start on the right", () => {
  const height = 60;
  let region = initialZoomRegion(1, 100, true);
  assert.equal(region.x, ZOOM_MARGIN_END - 300);
  const xs = [];
  while (region.x > ZOOM_MARGIN_START) { region = advanceZoomRegion(region, height, true); xs.push(region.x); }
  assert.deepEqual(xs, [495, 330, 165, 40]);
  region = advanceZoomRegion(region, height, true);
  assert.deepEqual([region.x, region.y], [ZOOM_MARGIN_END - 300, 100 + height * .9]);
});

test("the box never leaves the page", () => {
  assert.deepEqual(clampZoomRegion({ page: 1, x: -50, y: 2000, w: 300 }, 80), { page: 1, x: 0, y: 920, w: 300 });
  assert.equal(clampZoomRegion({ page: 1, x: 900, y: 0, w: 300 }, 80).x, 700);
});
