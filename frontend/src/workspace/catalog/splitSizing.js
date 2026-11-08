/** While dragging, never quantize the pointer to five-percent increments. */
export function clampSplitPercent(number) {
  return Number.isFinite(number) ? Math.max(20, Math.min(80, number)) : 50;
}

/** Snap a split dimension to a 5% step while keeping both sheets readable. */
export function snapSplitPercent(number) {
  return Math.round(clampSplitPercent(number) / 5) * 5;
}

/**
 * CSS grid track 1 starts on the right in RTL and on the left in LTR.
 * Rows always start at the top. The caller passes rtlColumns only for
 * horizontal dividers so dragging towards either screen edge moves the
 * divider in the same direction, rather than jumping the opposite way.
 */
export function splitPercentFromPointer(start, end, current, rtlColumns = false) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const distance = rtlColumns ? end - current : current - start;
  return clampSplitPercent((distance * 100) / (end - start));
}

/** Physical arrow keys move the divider in the direction of the key. */
export function splitResizeKeyDelta(key, rtlColumns = false) {
  switch (key) {
    case "ArrowRight": return rtlColumns ? -5 : 5;
    case "ArrowLeft": return rtlColumns ? 5 : -5;
    case "ArrowDown": return 5;
    case "ArrowUp": return -5;
    default: return 0;
  }
}
