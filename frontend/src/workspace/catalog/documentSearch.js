/**
 * Search inside the open PDF.
 *
 * The reader draws pages to canvases and has no text layer, so search reads
 * each page's text from PDF.js on demand and keeps, for every searchable
 * character, the box it was drawn in. A match then becomes a set of rectangles
 * in the workspace's page space (0-1000 on both axes, the space annotations
 * use), which is all the highlight layer and the cover tool need.
 *
 * Matching is forgiving in the ways a student types: case, Latin accents,
 * Arabic diacritics and tatweel, the alef and ya variants, ta marbuta, Arabic
 * presentation forms and runs of whitespace are all ignored.
 */

const PAGE_SPACE = 1000;
// Most PDF fonts place the baseline about four fifths of the way down the em.
const ASCENT = 0.8;
const SNIPPET_CONTEXT = 36;
export const MAX_SEARCH_RESULTS = 500;

const COMBINING_MARKS = /[̀-ͯؐ-ًؚ-ٰٟۖ-ۭ]/u;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u;
const LETTER_FOLDS = new Map([
  ["أ", "ا"], ["إ", "ا"], ["آ", "ا"], ["ٱ", "ا"],
  ["ى", "ي"], ["ة", "ه"], ["ـ", ""]
]);

/**
 * The searchable form of one source character. May be empty (a diacritic) or
 * longer than one character (a ligature such as "ﬁ").
 * @param {string} character
 */
export function foldCharacter(character) {
  if (/\s/u.test(character)) return " ";
  let folded = "";
  for (const part of character.normalize("NFKD")) {
    if (COMBINING_MARKS.test(part)) continue;
    const mapped = LETTER_FOLDS.has(part) ? LETTER_FOLDS.get(part) : part.toLocaleLowerCase();
    folded += /\s/u.test(mapped) ? " " : mapped;
  }
  return folded;
}

/** The searchable form of a query: folded, with whitespace collapsed. */
export function normalizeSearchQuery(query) {
  let folded = "";
  for (const character of String(query || "")) folded += foldCharacter(character);
  return folded.replace(/ +/g, " ").trim();
}

function multiply(first, second) {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5]
  ];
}

/**
 * Builds the searchable text of one page.
 * @param {{ items: Array<{ str?: string, transform?: number[], width?: number, dir?: string, hasEOL?: boolean }> }} textContent
 * @param {{ width: number, height: number, transform: number[] }} viewport a scale-1 PDF.js viewport
 */
export function buildPageTextIndex(textContent, viewport) {
  const scaleX = PAGE_SPACE / Math.max(1, viewport.width);
  const scaleY = PAGE_SPACE / Math.max(1, viewport.height);
  let text = "";
  let source = "";
  /** @type {number[]} */
  const sourceAt = [];
  /** @type {Array<{ x: number, y: number, width: number, height: number } | null>} */
  const boxes = [];

  const appendSpace = () => {
    if (!text || text.endsWith(" ")) return;
    text += " ";
    sourceAt.push(source.length);
    boxes.push(null);
    source += " ";
  };

  for (const item of textContent?.items || []) {
    const characters = [...String(item?.str || "")];
    if (!characters.length || !Array.isArray(item.transform)) {
      if (item?.hasEOL) appendSpace();
      continue;
    }
    const placed = multiply(viewport.transform, item.transform);
    const fontHeight = Math.hypot(placed[2], placed[3]);
    const runWidth = Math.max(0, Number(item.width) || 0);
    const characterWidth = runWidth / characters.length;
    const rightToLeft = item.dir === "rtl";
    const top = (placed[5] - fontHeight * ASCENT) * scaleY;
    const height = fontHeight * scaleY;

    if (text && !text.endsWith(" ")) appendSpace();
    characters.forEach((character, index) => {
      const offset = rightToLeft ? runWidth - (index + 1) * characterWidth : index * characterWidth;
      const box = { x: (placed[4] + offset) * scaleX, y: top, width: characterWidth * scaleX, height };
      const folded = foldCharacter(character);
      for (const part of folded) {
        if (part === " " && (!text || text.endsWith(" "))) continue;
        text += part;
        sourceAt.push(source.length);
        boxes.push(part === " " ? null : box);
      }
      source += character;
    });
    if (item.hasEOL) appendSpace();
  }
  return { text, source, sourceAt, boxes };
}

function rectanglesFor(boxes, start, end) {
  /** @type {Array<{ x: number, y: number, width: number, height: number }>} */
  const rectangles = [];
  let current = null;
  for (let index = start; index < end; index += 1) {
    const box = boxes[index];
    if (!box) continue;
    const sameLine = current && Math.abs(current.y - box.y) < current.height * 0.5;
    if (sameLine) {
      const left = Math.min(current.x, box.x);
      const right = Math.max(current.x + current.width, box.x + box.width);
      current.x = left;
      current.width = right - left;
      current.height = Math.max(current.height, box.height);
    } else {
      current = { ...box };
      rectangles.push(current);
    }
  }
  return rectangles.map((rectangle) => ({
    x: Math.max(0, rectangle.x - 2),
    y: Math.max(0, rectangle.y - 2),
    width: Math.min(PAGE_SPACE, rectangle.width + 4),
    height: Math.min(PAGE_SPACE, rectangle.height + 4)
  }));
}

function snippetFor(index, start, end) {
  const from = index.sourceAt[start] ?? 0;
  const to = (index.sourceAt[end - 1] ?? from) + 1;
  const before = index.source.slice(Math.max(0, from - SNIPPET_CONTEXT), from);
  const after = index.source.slice(to, to + SNIPPET_CONTEXT);
  return {
    before: `${from > SNIPPET_CONTEXT ? "…" : ""}${before.trimStart()}`,
    match: index.source.slice(from, to),
    after: `${after.trimEnd()}${to + SNIPPET_CONTEXT < index.source.length ? "…" : ""}`
  };
}

/**
 * Every occurrence of the query on one page.
 * Arabic text in some PDFs is stored in visual order, so an Arabic query is
 * also tried reversed; the two never overlap on a well-formed page.
 * @param {ReturnType<typeof buildPageTextIndex>} index
 * @param {string} query an already normalised query
 * @param {number} page
 */
export function findPageMatches(index, query, page) {
  if (!query || !index?.text) return [];
  const needles = [query];
  if (ARABIC_SCRIPT.test(query)) {
    const reversed = [...query].reverse().join("");
    if (reversed !== query) needles.push(reversed);
  }
  const matches = [];
  const taken = new Set();
  for (const needle of needles) {
    let from = 0;
    while (from <= index.text.length - needle.length) {
      const start = index.text.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      from = end;
      if (taken.has(start)) continue;
      const rectangles = rectanglesFor(index.boxes, start, end);
      if (!rectangles.length) continue;
      taken.add(start);
      matches.push({ id: `${page}:${start}`, page, start, rectangles, snippet: snippetFor(index, start, end) });
    }
  }
  return matches.sort((first, second) => first.start - second.start);
}

/**
 * Reads and caches page text from an open PDF.js document.
 * @param {{ numPages: number, getPage: (page: number) => Promise<any> }} documentProxy
 */
export function createDocumentTextSource(documentProxy) {
  /** @type {Map<number, Promise<ReturnType<typeof buildPageTextIndex>>>} */
  const cache = new Map();
  return {
    /** @param {number} page */
    pageIndex(page) {
      if (!cache.has(page)) {
        const pending = (async () => {
          const pdfPage = await documentProxy.getPage(page);
          const viewport = pdfPage.getViewport({ scale: 1 });
          const textContent = await pdfPage.getTextContent();
          return buildPageTextIndex(textContent, viewport);
        })();
        // A page that failed to read is retried by the next search.
        pending.catch(() => cache.delete(page));
        cache.set(page, pending);
      }
      return cache.get(page);
    }
  };
}

/**
 * Searches a range of pages in order, reporting progress as it goes.
 * @param {ReturnType<typeof createDocumentTextSource>} source
 * @param {string} rawQuery
 * @param {{ firstPage: number, lastPage: number, isCancelled: () => boolean, onProgress?: (state: { matches: any[], searchedPages: number, totalPages: number }) => void }} options
 */
export async function searchDocument(source, rawQuery, { firstPage, lastPage, isCancelled, onProgress }) {
  const query = normalizeSearchQuery(rawQuery);
  const totalPages = Math.max(0, lastPage - firstPage + 1);
  const matches = [];
  if (!query) return { matches, searchedPages: 0, totalPages, truncated: false };
  let searchedPages = 0;
  for (let page = firstPage; page <= lastPage; page += 1) {
    if (isCancelled()) return null;
    try {
      const index = await source.pageIndex(page);
      if (isCancelled()) return null;
      matches.push(...findPageMatches(index, query, page));
    } catch {
      // An unreadable page is skipped; the rest of the document is still searched.
    }
    searchedPages += 1;
    if (matches.length >= MAX_SEARCH_RESULTS) {
      onProgress?.({ matches: matches.slice(0, MAX_SEARCH_RESULTS), searchedPages, totalPages });
      return { matches: matches.slice(0, MAX_SEARCH_RESULTS), searchedPages, totalPages, truncated: true };
    }
    if (searchedPages % 4 === 0 || page === lastPage) onProgress?.({ matches: [...matches], searchedPages, totalPages });
  }
  return { matches, searchedPages, totalPages, truncated: false };
}
