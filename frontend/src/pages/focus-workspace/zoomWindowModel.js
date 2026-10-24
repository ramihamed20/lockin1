/**
 * Geometry of the Zoom Window's box on the page, in page units (x and y each
 * 0-1000 across the page; a y unit is `pageAspect` x units on screen).
 */

/** Box widths offered, most magnified first. */
export const ZOOM_WINDOW_SIZES = Object.freeze([220, 300, 420]);
export const ZOOM_WINDOW_DEFAULT_SIZE = 300;
/** The share of the window, at its trailing edge, that moves the box along. */
export const ZOOM_ADVANCE_ZONE = .22;
export const ZOOM_MARGIN_START = 40;
export const ZOOM_MARGIN_END = 960;
// Each step along a line keeps a little of what was just written in view.
const ADVANCE_SHARE = .55;
// A new line overlaps the last one slightly, as ruled lines do.
const LINE_SHARE = .9;

/** The box's height in page units for a window of `box` pixels. */
export function zoomRegionHeight(width, box, pageAspect = 1) {
  if (!box?.width) return 0;
  return box.height / box.width * width / Math.max(.2, Number(pageAspect) || 1);
}

export function clampZoomRegion(region, height) {
  const w = Math.min(1000, Math.max(50, Number(region.w) || ZOOM_WINDOW_DEFAULT_SIZE));
  const h = Math.max(0, Number(height) || 0);
  return {
    ...region,
    w,
    x: Math.min(1000 - w, Math.max(0, Number(region.x) || 0)),
    y: h >= 1000 ? 0 : Math.min(1000 - h, Math.max(0, Number(region.y) || 0))
  };
}

/**
 * The start of the next line: the left margin, or the right one when the
 * writing runs right to left (Arabic).
 */
export function nextZoomLine(region, height, rtl = false) {
  const x = rtl ? ZOOM_MARGIN_END - region.w : ZOOM_MARGIN_START;
  return clampZoomRegion({ ...region, x, y: region.y + height * LINE_SHARE }, height);
}

/** Along the line in the writing direction; at its end, the next line. */
export function advanceZoomRegion(region, height, rtl = false) {
  if (rtl) {
    if (region.x <= ZOOM_MARGIN_START + .5) return nextZoomLine(region, height, true);
    return clampZoomRegion({ ...region, x: Math.max(ZOOM_MARGIN_START, region.x - region.w * ADVANCE_SHARE) }, height);
  }
  const lastStart = ZOOM_MARGIN_END - region.w;
  if (region.x >= lastStart - .5) return nextZoomLine(region, height);
  return clampZoomRegion({ ...region, x: Math.min(lastStart, region.x + region.w * ADVANCE_SHARE) }, height);
}

export function initialZoomRegion(page, y = 80, rtl = false) {
  return { page, x: rtl ? ZOOM_MARGIN_END - ZOOM_WINDOW_DEFAULT_SIZE : ZOOM_MARGIN_START, y: Math.max(0, Number(y) || 0), w: ZOOM_WINDOW_DEFAULT_SIZE };
}
