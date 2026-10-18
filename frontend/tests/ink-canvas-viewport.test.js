import assert from "node:assert/strict";
import test from "node:test";
import { inkCanvasViewport } from "../src/workspace/ink/inkCanvasViewport.js";
import { WORKSPACE_RENDER } from "../src/workspace/config.js";

test("Retina ink density follows zoom rather than magnifying a full-page bitmap", () => {
  for (const [viewportWidth, viewportHeight, dpr] of [[390, 700, 3], [834, 980, 2], [1194, 650, 2], [1280, 800, 1]]) {
    for (const zoom of [.5, 1, 2.478, 4.873, 5]) {
      const width = 794;
      const height = 1123;
      const page = { left: -180, top: -260, width: width * zoom };
      const viewport = { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight };
      const size = inkCanvasViewport(width, height, page, viewport, dpr);
      assert.ok(size.pixelWidth * size.pixelHeight <= WORKSPACE_RENDER.maximumInkCanvasPixels, "one bounded bitmap at any zoom");
      assert.ok(size.x >= 0 && size.y >= 0);
      assert.ok(size.x + size.surfaceWidth <= width);
      assert.ok(size.y + size.surfaceHeight <= height);
      const visiblePixelArea = size.surfaceWidth * size.surfaceHeight * (dpr * zoom) ** 2;
      if (visiblePixelArea <= WORKSPACE_RENDER.maximumInkCanvasPixels) assert.equal(size.ratio, dpr * zoom, "native display density when it fits");
      else assert.ok(size.ratio / zoom >= 1, "the budget still preserves at least one pixel per screen pixel");
    }
  }
});

test("a panned crop preserves page coordinates and keeps ink at the viewport edges", () => {
  const size = inkCanvasViewport(1000, 1400,
    { left: -1000, top: -1600, width: 4000 },
    { left: 0, top: 0, right: 600, bottom: 800 }, 2);
  assert.equal(size.x, 248);
  assert.equal(size.y, 398);
  assert.equal(size.surfaceWidth, 154);
  assert.equal(size.surfaceHeight, 204);
  assert.equal(size.ratio, 8);
  // The same page point occupies the same screen pixel before and after crop.
  const point = { x: 300, y: 450 };
  assert.equal((point.x - size.x) * size.ratio / 2 + size.x * 4 - 1000, point.x * 4 - 1000);
  assert.equal((point.y - size.y) * size.ratio / 2 + size.y * 4 - 1600, point.y * 4 - 1600);
});

test("a tall PDF cannot force an oversized ink bitmap or waste pixels below the viewport", () => {
  const size = inkCanvasViewport(794, 12000,
    { left: 0, top: -3000, width: 794 },
    { left: 0, top: 0, right: 834, bottom: 1000 }, 3);
  assert.ok(size.surfaceHeight <= 1016);
  assert.ok(size.pixelWidth * size.pixelHeight <= WORKSPACE_RENDER.maximumInkCanvasPixels);
  assert.ok(size.ratio > 2);
});

test("ink lands one bitmap pixel per screen pixel, starting on a screen pixel", () => {
  // iPad landscape at fit width: an A4 page laid out at 595px, shown 1.983x on a 2x screen.
  const scale = 1180 / 595;
  const size = inkCanvasViewport(595, 842, { left: 0, top: -137.3, width: 1180 }, { left: 0, top: 0, right: 1180, bottom: 820 }, 2);
  assert.ok(Math.abs(size.ratio - scale * 2) < 1e-9);
  // Exact pixel count for the CSS box, so the compositor never resamples it.
  assert.ok(Math.abs(size.surfaceWidth * size.ratio - size.pixelWidth) < 1e-6);
  assert.ok(Math.abs(size.surfaceHeight * size.ratio - size.pixelHeight) < 1e-6);
  // The canvas origin falls on a whole device pixel.
  const deviceTop = (-137.3 + size.y * scale) * 2;
  assert.ok(Math.abs(deviceTop - Math.round(deviceTop)) < 1e-6);
  assert.ok(size.pixelWidth >= 2360 && size.pixelHeight >= 1640);
});
