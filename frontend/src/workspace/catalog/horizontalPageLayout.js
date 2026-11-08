/** Geometry and discrete swipe intent for the optional paged PDF reader. */
export function horizontalPageSlotWidth(viewportWidth, zoom, pdfPageWidth = 595) {
  const width = Number.isFinite(viewportWidth) ? Math.max(1, viewportWidth) : 1;
  const scale = Number.isFinite(zoom) ? Math.max(0.01, zoom) : 1;
  return Math.max(width, pdfPageWidth * scale + 24);
}

export function horizontalSwipeTarget(orderedKeys, startKey, deltaX, deltaY, viewportWidth) {
  if (!Array.isArray(orderedKeys) || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
  if (Math.abs(deltaX) <= 14 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return null;
  const index = orderedKeys.indexOf(startKey);
  if (index < 0) return null;
  const distance = Math.max(48, Math.max(1, viewportWidth || 1) * 0.11);
  const step = Math.abs(deltaX) >= distance ? (deltaX < 0 ? 1 : -1) : 0;
  return orderedKeys[Math.max(0, Math.min(orderedKeys.length - 1, index + step))] ?? null;
}


/**
 * The horizontal reader changes its inter-page gutter as zoom changes.
 * A document-wide x coordinate therefore points at a different page after a
 * zoom. Anchor within the visible page instead of within the whole row.
 *
 * "pages" consists of { key, rect } records (DOMRect-compatible rects).
 * This function is deliberately DOM-free so the geometry is easy to test.
 */
export function horizontalZoomPageAnchor(pages, clientX, clientY, preferredKey = null) {
  if (!Array.isArray(pages) || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  let selected = null;
  let bestDistance = Infinity;
  for (const page of pages) {
    const rect = page?.rect;
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)
      || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
      || rect.width <= 0 || rect.height <= 0 || !Number.isSafeInteger(Number(page.key))) continue;
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const distanceX = Math.max(rect.left - clientX, 0, clientX - right);
    const distanceY = Math.max(rect.top - clientY, 0, clientY - bottom);
    // Pages have a shared horizontal baseline. Nearest in x takes priority;
    // the small y contribution breaks ties for unusually sized PDF pages.
    const distance = distanceX + distanceY * 0.05;
    if (distance >= bestDistance - 0.001 && !(Math.abs(distance - bestDistance) < 0.001 && Number(page.key) === Number(preferredKey))) continue;
    bestDistance = distance;
    selected = {
      pageKey: Number(page.key),
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    };
  }
  return selected;
}

/** Reconcile the same page-relative point under the original pinch/button focal point. */
export function scrollForHorizontalPageAnchor({ scrollLeft, scrollTop, pageRect, anchor, clientX, clientY }) {
  if (!anchor || !pageRect) return null;
  const width = Number(pageRect.width);
  const height = Number(pageRect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    scrollLeft: Math.max(0, (Number(scrollLeft) || 0) + pageRect.left + anchor.x * width - clientX),
    scrollTop: Math.max(0, (Number(scrollTop) || 0) + pageRect.top + anchor.y * height - clientY)
  };
}

/** A zoomed-in page should pan, not turn, while its content exceeds the viewport. */
export function horizontalPageFitsViewport(pageWidth, viewportWidth, tolerance = 2) {
  return Number.isFinite(pageWidth) && Number.isFinite(viewportWidth)
    && pageWidth > 0 && viewportWidth > 0 && pageWidth <= viewportWidth + tolerance;
}
