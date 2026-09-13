/**
 * Return the only PDF pages the reader is allowed to mount. Active Study uses
 * a part's start/end range; normal study uses the default full-document range.
 */
export function visiblePdfPages(pageCount, visiblePageStart = 1, visiblePageEnd = pageCount) {
  const total = Math.max(1, Number(pageCount) || 1);
  const start = Math.min(total, Math.max(1, Number(visiblePageStart) || 1));
  const end = Math.min(total, Math.max(start, Number(visiblePageEnd) || total));
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
