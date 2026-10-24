/**
 * A zoomed page is sharper than its whole-page bitmap can be. The page canvas
 * is capped by a memory budget, so past roughly 150% on a tablet (and below
 * 100% on a phone) it is stretched over more screen pixels than it has. The
 * detail canvas covers only the part of the page on screen, plus a margin to
 * scroll into, at one bitmap pixel per screen pixel. This is the approach of
 * PDF.js' own PDFPageDetailView.
 *
 * All areas are in page layout units: the page box is `pageWidth` wide before
 * the reader's CSS zoom, and `scale` is bitmap pixels per layout unit.
 */

/** Whether a page bitmap at `baseScale` falls visibly short of `targetScale`. */
export function pdfDetailNeeded(baseScale, targetScale) {
  return Number(targetScale) > Math.max(0, Number(baseScale) || 0) * 1.04;
}

/**
 * The part of the page inside the stage, in page layout units, or null when
 * none of it is visible.
 * @param {{ left: number, top: number, width: number, height: number }} pageBounds
 * @param {{ left: number, top: number, right: number, bottom: number }} stageBounds
 */
export function visiblePageArea(pageBounds, stageBounds, pageWidth, pageHeight) {
  const screenScale = Number(pageBounds?.width) / Math.max(1, Number(pageWidth) || 1);
  if (!(screenScale > 0)) return null;
  const left = Math.max(pageBounds.left, stageBounds.left);
  const top = Math.max(pageBounds.top, stageBounds.top);
  const right = Math.min(pageBounds.left + pageBounds.width, stageBounds.right);
  const bottom = Math.min(pageBounds.top + pageBounds.height, stageBounds.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  const minX = Math.max(0, (left - pageBounds.left) / screenScale);
  const minY = Math.max(0, (top - pageBounds.top) / screenScale);
  const maxX = Math.min(pageWidth, (right - pageBounds.left) / screenScale);
  const maxY = Math.min(pageHeight, (bottom - pageBounds.top) / screenScale);
  if (maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * The area to rasterize for `visible`, or null when the budget cannot improve
 * on the page bitmap. The visible part is grown on every side by up to its own
 * size while the budget allows, so a short scroll stays inside it.
 *
 * When the bitmap is exactly one pixel per screen pixel, its left and top edges
 * are moved back onto the device pixel grid: anything else makes the compositor
 * resample it, which softens every glyph.
 *
 * @param {{
 *   visible: { minX: number, minY: number, maxX: number, maxY: number },
 *   pageWidth: number, pageHeight: number, targetScale: number,
 *   maximumPixels: number, maximumEdge: number,
 *   pageLeft?: number, pageTop?: number, screenScale?: number, devicePixelRatio?: number
 * }} options
 */
export function pdfDetailArea({ visible, pageWidth, pageHeight, targetScale, maximumPixels, maximumEdge, pageLeft = 0, pageTop = 0, screenScale = 0, devicePixelRatio = 1 }) {
  const visibleWidth = visible.maxX - visible.minX;
  const visibleHeight = visible.maxY - visible.minY;
  if (!(visibleWidth > 0 && visibleHeight > 0 && targetScale > 0)) return null;
  const edge = Math.max(1, Number(maximumEdge) || 1);
  const budget = Math.max(1, Number(maximumPixels) || 1);
  // The visible part alone must fit, at the target density or below it.
  const scale = Math.min(targetScale, Math.sqrt(budget / (visibleWidth * visibleHeight)), edge / visibleWidth, edge / visibleHeight);
  // Spare budget becomes margin, the same share on each axis.
  const spare = Math.sqrt(budget / (visibleWidth * visibleHeight * scale * scale));
  const overflow = Math.min(1, Math.max(0, (spare - 1) / 2));
  const marginX = Math.min(visibleWidth * overflow, Math.max(0, (edge / scale - visibleWidth) / 2));
  const marginY = Math.min(visibleHeight * overflow, Math.max(0, (edge / scale - visibleHeight) / 2));
  let minX = Math.max(0, visible.minX - marginX);
  let minY = Math.max(0, visible.minY - marginY);
  const maxX = Math.min(pageWidth, visible.maxX + marginX);
  const maxY = Math.min(pageHeight, visible.maxY + marginY);
  const dpr = Math.max(.01, Number(devicePixelRatio) || 1);
  if (screenScale > 0 && Math.abs(scale - screenScale * dpr) < 1e-6) {
    // Moving back by under a device pixel may start just outside the page,
    // which the page box clips.
    const snap = (start, offset) => (Math.floor((offset + start * screenScale) * dpr) / dpr - offset) / screenScale;
    minX = snap(minX, pageLeft);
    minY = snap(minY, pageTop);
  }
  const pixelWidth = Math.max(1, Math.min(edge, Math.floor((maxX - minX) * scale)));
  const pixelHeight = Math.max(1, Math.min(edge, Math.floor((maxY - minY) * scale)));
  return { minX, minY, width: pixelWidth / scale, height: pixelHeight / scale, scale, pixelWidth, pixelHeight };
}

/**
 * Whether the area already drawn still serves `visible` at `scale`: it must
 * hold the whole visible part at the same density, with the visible part not
 * pressed against an edge that has more page beyond it.
 */
export function pdfDetailCovers(area, visible, scale, pageWidth, pageHeight) {
  if (!area || Math.abs(area.scale - scale) > 1e-6) return false;
  const maxX = area.minX + area.width;
  const maxY = area.minY + area.height;
  const tolerance = .5 / Math.max(1e-6, scale);
  if (visible.minX < area.minX - tolerance || visible.minY < area.minY - tolerance
    || visible.maxX > maxX + tolerance || visible.maxY > maxY + tolerance) return false;
  // Re-centre once the reader has used most of the margin on one side.
  const leftRoom = visible.minX - area.minX;
  const rightRoom = maxX - visible.maxX;
  const topRoom = visible.minY - area.minY;
  const bottomRoom = maxY - visible.maxY;
  const ratio = 3;
  return !((area.minX > 0 && rightRoom > ratio * Math.max(tolerance, leftRoom))
    || (maxX < pageWidth - tolerance && leftRoom > ratio * Math.max(tolerance, rightRoom))
    || (area.minY > 0 && bottomRoom > ratio * Math.max(tolerance, topRoom))
    || (maxY < pageHeight - tolerance && topRoom > ratio * Math.max(tolerance, bottomRoom)));
}
