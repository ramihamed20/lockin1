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
