import assert from "node:assert/strict";
import test from "node:test";
import { pdfDetailArea, pdfDetailCovers, pdfDetailNeeded, visiblePageArea } from "../src/workspace/catalog/pdfDetailArea.js";
import { catalogDetailCanvasPixelBudget } from "../src/workspace/catalog/renderBudget.js";
import { boundedOutputScale } from "../src/workspace/document/coordinateTransforms.js";
import { WORKSPACE_RENDER } from "../src/workspace/config.js";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 595 * 297 / 210;

/** The page bitmap density, as ContinuousA4Pdf's a4RenderQualityScale computes it. */
function pageBitmapScale(zoom, dpr, maximumPixels) {
  const limited = Math.min(boundedOutputScale(PAGE_WIDTH, PAGE_HEIGHT, dpr, zoom, maximumPixels), WORKSPACE_RENDER.maximumCatalogCanvasEdge / PAGE_HEIGHT);
  return Math.max(1, Math.round(limited * 8) / 8);
}

test("a detail canvas is only needed when the page bitmap falls short of the screen", () => {
  assert.equal(pdfDetailNeeded(2, 2), false);
  assert.equal(pdfDetailNeeded(2, 2.05), false);
  assert.equal(pdfDetailNeeded(2.5, 4), true);
});

test("the visible part of a zoomed page is measured in page layout units", () => {
  // A page shown at 200%, its top-left 100px above and left of the stage.
  const page = { left: -100, top: -100, width: PAGE_WIDTH * 2, height: PAGE_HEIGHT * 2 };
  const stage = { left: 0, top: 0, right: 800, bottom: 600 };
  const visible = visiblePageArea(page, stage, PAGE_WIDTH, PAGE_HEIGHT);
  assert.deepEqual(visible, { minX: 50, minY: 50, maxX: 450, maxY: 350 });
  assert.equal(visiblePageArea({ left: 0, top: 900, width: 595, height: 841 }, stage, PAGE_WIDTH, PAGE_HEIGHT), null);
});

test("an iPad at 200% gets a one-to-one detail bitmap with scroll margin", () => {
  // iPad landscape, DPR 2, fit-width ~198%: the page bitmap alone reaches 63%.
  const zoom = 2;
  const dpr = 2;
  const target = zoom * dpr;
  const base = pageBitmapScale(zoom, dpr, 3_000_000);
  assert.ok(base / target < .7, `page bitmap alone is ${base / target}`);
  const visible = { minX: 0, minY: 100, maxX: PAGE_WIDTH, maxY: 100 + 1180 / 2 / zoom * 1.4 };
  const budget = catalogDetailCanvasPixelBudget(1180, true);
  const area = pdfDetailArea({ visible, pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, targetScale: target, maximumPixels: budget, maximumEdge: 4096, screenScale: zoom, devicePixelRatio: dpr, pageLeft: 0, pageTop: -200 });
  assert.equal(area.scale, target);
  assert.ok(area.pixelWidth * area.pixelHeight <= budget);
  assert.ok(area.minY < visible.minY && area.minY + area.height > visible.maxY, "margin above and below the visible part");
  assert.ok(pdfDetailNeeded(base, area.scale));
});

test("an over-budget screen keeps the visible part and lowers density instead", () => {
  const visible = { minX: 0, minY: 0, maxX: PAGE_WIDTH, maxY: 600 };
  const area = pdfDetailArea({ visible, pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, targetScale: 6, maximumPixels: 4_000_000, maximumEdge: 4096 });
  assert.ok(area.scale < 6);
  assert.ok(area.pixelWidth * area.pixelHeight <= 4_000_000);
  assert.ok(area.minX <= visible.minX && area.minX + area.width >= visible.maxX - 1 / area.scale);
  assert.ok(area.pixelWidth <= 4096 && area.pixelHeight <= 4096);
});

test("a one-to-one area starts on the device pixel grid", () => {
  const visible = { minX: 10.3, minY: 20.7, maxX: 200, maxY: 300 };
  const area = pdfDetailArea({ visible, pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, targetScale: 4, maximumPixels: 4_000_000, maximumEdge: 4096, screenScale: 2, devicePixelRatio: 2, pageLeft: 13.37, pageTop: 7.21 });
  for (const [start, offset] of [[area.minX, 13.37], [area.minY, 7.21]]) {
    const devicePixel = (offset + start * 2) * 2;
    assert.ok(Math.abs(devicePixel - Math.round(devicePixel)) < 1e-6, `${devicePixel} is on the grid`);
  }
  assert.equal(area.scale, 4);
  assert.equal(area.width * area.scale, area.pixelWidth);
});

test("a drawn area is reused until the reader leaves it or nears its edge", () => {
  const area = { minX: 0, minY: 100, width: PAGE_WIDTH, height: 400, scale: 4 };
  assert.equal(pdfDetailCovers(area, { minX: 0, minY: 200, maxX: PAGE_WIDTH, maxY: 400 }, 4, PAGE_WIDTH, PAGE_HEIGHT), true);
  assert.equal(pdfDetailCovers(area, { minX: 0, minY: 200, maxX: PAGE_WIDTH, maxY: 400 }, 3, PAGE_WIDTH, PAGE_HEIGHT), false, "density changed");
  assert.equal(pdfDetailCovers(area, { minX: 0, minY: 300, maxX: PAGE_WIDTH, maxY: 560 }, 4, PAGE_WIDTH, PAGE_HEIGHT), false, "left the area");
  assert.equal(pdfDetailCovers(area, { minX: 0, minY: 280, maxX: PAGE_WIDTH, maxY: 495 }, 4, PAGE_WIDTH, PAGE_HEIGHT), false, "pressed against the bottom");
});
