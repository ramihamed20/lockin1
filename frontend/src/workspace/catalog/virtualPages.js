export const MAX_VIRTUAL_PAGES = 200;
/** My Summary pages: one per sheet page, for at most two summaries a sheet. */
export const MAX_SUMMARY_PAGES = 20_000;
export const WORKSPACE_PAGE_BACKGROUNDS = ["blank", "lined", "grid", "dot"];
const SUMMARY_ID = /^[0-9a-f-]{36}$/i;

export function isVirtualPageKey(value) {
  return Number.isSafeInteger(value) && value < 0;
}

/**
 * Pages the student added count against MAX_VIRTUAL_PAGES; pages that belong
 * to a My Summary carry its id in `summary` and have their own, larger limit.
 */
export function sanitizeVirtualPages(value) {
  const seen = new Set();
  let added = 0;
  let summaries = 0;
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const id = Number(item?.id);
    const afterPage = Number(item?.afterPage);
    if (!isVirtualPageKey(id) || !Number.isSafeInteger(afterPage) || afterPage < 1 || afterPage > 10_000 || seen.has(id)) return [];
    const summary = typeof item.summary === "string" && SUMMARY_ID.test(item.summary) ? item.summary : null;
    if (summary ? summaries >= MAX_SUMMARY_PAGES : added >= MAX_VIRTUAL_PAGES) return [];
    if (summary) summaries += 1; else added += 1;
    seen.add(id);
    return [{ id, afterPage, background: WORKSPACE_PAGE_BACKGROUNDS.includes(item.background) ? item.background : "blank", ...(summary ? { summary } : {}) }];
  });
}

/** One blank page after every sheet page, for a pen summary. */
export function addSummaryPages(pages, summaryId, pdfPageCount, background = "blank") {
  const current = sanitizeVirtualPages(pages);
  if (!SUMMARY_ID.test(summaryId) || current.some((item) => item.summary === summaryId)) return current;
  const next = [...current];
  for (let page = 1; page <= Math.min(10_000, pdfPageCount); page += 1) {
    next.push({ id: createVirtualPageId(next), afterPage: page, background, summary: summaryId });
  }
  return sanitizeVirtualPages(next);
}

export function removeSummaryPages(pages, summaryId) {
  return sanitizeVirtualPages(pages).filter((item) => item.summary !== summaryId);
}

export function createVirtualPageId(pages) {
  const used = new Set(sanitizeVirtualPages(pages).map((item) => item.id));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const words = new Uint32Array(2);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(words);
    else { words[0] = Math.floor(Math.random() * 0x100000000); words[1] = Math.floor(Math.random() * 0x100000000); }
    const id = -(((words[0] & 0xfffff) * 0x100000000 + words[1]) + 1);
    if (!used.has(id)) return id;
  }
  throw new Error("A workspace page identifier could not be created.");
}

export function insertVirtualPage(pages, afterPage, id, afterVirtualId = null, background = "blank") {
  const current = sanitizeVirtualPages(pages);
  if (!isVirtualPageKey(id) || current.some((item) => item.id === id)) return current;
  const anchor = Math.round(Number(afterPage));
  if (!Number.isSafeInteger(anchor) || anchor < 1 || anchor > 10_000 || current.filter((item) => !item.summary).length >= MAX_VIRTUAL_PAGES) return current;
  const selectedIndex = current.findIndex((item) => item.id === afterVirtualId && item.afterPage === anchor);
  let lastSameAnchor = -1;
  current.forEach((item, index) => { if (item.afterPage === anchor) lastSameAnchor = index; });
  const index = selectedIndex >= 0 ? selectedIndex + 1 : lastSameAnchor + 1;
  const next = [...current];
  next.splice(index, 0, { id, afterPage: anchor, background: WORKSPACE_PAGE_BACKGROUNDS.includes(background) ? background : "blank" });
  return next;
}

export function removeVirtualPage(pages, id) {
  return sanitizeVirtualPages(pages).filter((item) => item.id !== id);
}

export function composeWorkspacePages(pdfPages, virtualPages) {
  const byAnchor = new Map();
  for (const item of sanitizeVirtualPages(virtualPages)) {
    const pages = byAnchor.get(item.afterPage) || [];
    pages.push(item);
    byAnchor.set(item.afterPage, pages);
  }
  return (pdfPages || []).flatMap((pdfPage) => [
    { kind: "pdf", key: pdfPage, pdfPage },
    ...(byAnchor.get(pdfPage) || []).map((item) => ({ kind: "virtual", key: item.id, pdfPage, background: item.background, ...(item.summary ? { summary: item.summary } : {}) }))
  ]);
}
