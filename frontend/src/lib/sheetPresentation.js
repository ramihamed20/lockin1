/** Stable decorative cover colours; never encode study status. */
export function sheetCoverTone(material) {
  const name = `${material?.slug || ""} ${material?.title || ""}`.toLowerCase();
  if (/embryo|anatomy(?!.*dental)/.test(name) && !/dental/.test(name)) return "blue";
  if (/dental|prostho/.test(name)) return "amber";
  if (/patho|micro/.test(name)) return "mint";
  return "lavender";
}

/** Reading position is distinct from assessed completion. Missing data stays unknown. */
export function sheetReadingPosition(entry) {
  const page = entry?.currentPage;
  const total = entry?.pageCount;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(total) || total < 1) return null;
  const current = Math.min(page, total);
  return { page: current, total, percent: Math.round(current / total * 100) };
}
