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

/**
 * The page an Active Study run resumes on: its latest unlocked part. A saved
 * page inside that part wins; otherwise reading starts at the part's first
 * page, and a run waiting on its checkpoint returns to the part's last page.
 */
export function activeStudyResumePage(pageRange, { stage = "reading", savedPage = null } = {}) {
  const start = Math.max(1, Number(pageRange?.start_page) || 1);
  const end = Math.max(start, Number(pageRange?.end_page) || start);
  const saved = Number(savedPage);
  if (Number.isInteger(saved) && saved >= start && saved <= end) return saved;
  return stage === "checkpoint" || stage === "final" ? end : start;
}
