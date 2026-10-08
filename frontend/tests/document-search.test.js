import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPageTextIndex,
  createDocumentTextSource,
  findPageMatches,
  foldCharacter,
  normalizeSearchQuery,
  searchDocument
} from "../src/workspace/catalog/documentSearch.js";

// A 600 x 800 page at scale 1: PDF space has its origin at the bottom left.
const VIEWPORT = { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] };

function item(str, x, baseline, width, { size = 10, dir = "ltr", hasEOL = false } = {}) {
  return { str, transform: [size, 0, 0, size, x, baseline], width, dir, hasEOL };
}

test("folding ignores case, accents, Arabic diacritics and letter variants", () => {
  assert.equal(normalizeSearchQuery("  Café   AU  Lait "), "cafe au lait");
  assert.equal(normalizeSearchQuery("أَسْنَان"), "اسنان");
  assert.equal(normalizeSearchQuery("مدرسة"), normalizeSearchQuery("مدرسه"));
  assert.equal(normalizeSearchQuery("على"), normalizeSearchQuery("علي"));
  assert.equal(normalizeSearchQuery("كـــتاب"), "كتاب");
  assert.equal(foldCharacter("ﬁ"), "fi");
  // Presentation forms, as many Arabic PDFs store them, fold to the letters.
  assert.equal(normalizeSearchQuery("ﻣﺴﺎ"), normalizeSearchQuery("مسا"));
});

test("a match becomes a rectangle in page space over the matched characters", () => {
  const index = buildPageTextIndex({ items: [item("The enamel rod", 60, 700, 140)] }, VIEWPORT);
  const [match] = findPageMatches(index, normalizeSearchQuery("ENAMEL"), 3);
  assert.equal(match.page, 3);
  assert.equal(match.snippet.match, "enamel");
  assert.equal(match.rectangles.length, 1);
  const [rect] = match.rectangles;
  // "The " is 4 of 14 characters, 10 units each, starting at x=60.
  assert.ok(Math.abs(rect.x - ((100 / 600) * 1000 - 2)) < 0.01, `x was ${rect.x}`);
  assert.ok(Math.abs(rect.width - ((60 / 600) * 1000 + 4)) < 0.01, `width was ${rect.width}`);
  // Baseline at 700 in PDF space is 100 from the top; the box rises above it.
  assert.ok(rect.y < (100 / 800) * 1000 && rect.y + rect.height > (92 / 800) * 1000);
});

test("matches run across text items and lines, and every occurrence is found", () => {
  const index = buildPageTextIndex({ items: [
    item("dentin", 50, 700, 60, { hasEOL: true }),
    item("tubules and dentin", 50, 680, 180)
  ] }, VIEWPORT);
  const matches = findPageMatches(index, normalizeSearchQuery("dentin tubules"), 1);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rectangles.length, 2, "one rectangle per line");
  assert.equal(findPageMatches(index, normalizeSearchQuery("dentin"), 1).length, 2);
});

test("right-to-left runs are measured from their right edge", () => {
  const index = buildPageTextIndex({ items: [item("سن لبني", 100, 700, 70, { dir: "rtl" })] }, VIEWPORT);
  const [match] = findPageMatches(index, normalizeSearchQuery("سن"), 1);
  assert.ok(match, "the Arabic word is found");
  // The first two characters sit at the right end of the run.
  assert.ok(match.rectangles[0].x > (140 / 600) * 1000, `x was ${match.rectangles[0].x}`);
});

test("a word split by a font change stays searchable without inventing spaces", () => {
  const index = buildPageTextIndex({ items: [item("bio", 50, 700, 30), item("chemistry", 80, 700, 90)] }, VIEWPORT);
  assert.equal(index.text, "biochemistry");
  assert.equal(findPageMatches(index, normalizeSearchQuery("biochemistry"), 1).length, 1);
  const separateWords = buildPageTextIndex({ items: [item("bio", 50, 700, 30), item("chemistry", 85, 700, 90)] }, VIEWPORT);
  assert.equal(separateWords.text, "bio chemistry");
});

test("contiguous Arabic fragments stay joined in right-to-left reading order", () => {
  const index = buildPageTextIndex({ items: [item("أس", 140, 700, 20, { dir: "rtl" }), item("نان", 110, 700, 30, { dir: "rtl" })] }, VIEWPORT);
  assert.equal(index.text, "اسنان");
  assert.equal(findPageMatches(index, normalizeSearchQuery("أسنان"), 1).length, 1);
});

test("search rectangles stay within the page at its edges", () => {
  const index = buildPageTextIndex({ items: [item("edge", 580, 4, 40)] }, VIEWPORT);
  const [match] = findPageMatches(index, "edge", 1);
  for (const rect of match.rectangles) {
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 1000);
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 1000);
  }
});

test("Arabic stored in visual order is still found", () => {
  const reversed = [..."اللثة"].reverse().join("");
  const index = buildPageTextIndex({ items: [item(reversed, 100, 700, 50)] }, VIEWPORT);
  assert.equal(findPageMatches(index, normalizeSearchQuery("اللثة"), 1).length, 1);
});

test("the snippet keeps the original text around the match", () => {
  const index = buildPageTextIndex({ items: [item("Pulp chamber contains nerves", 10, 700, 280)] }, VIEWPORT);
  const [match] = findPageMatches(index, normalizeSearchQuery("chamber"), 1);
  assert.deepEqual(match.snippet, { before: "Pulp ", match: "chamber", after: " contains nerves" });
});

test("searching a document walks only the pages it is given and can be cancelled", async () => {
  const requested = [];
  const documentProxy = {
    numPages: 5,
    async getPage(page) {
      requested.push(page);
      return {
        getViewport: () => VIEWPORT,
        getTextContent: async () => ({ items: [item(`page ${page} molar`, 10, 700, 120)] })
      };
    }
  };
  const source = createDocumentTextSource(documentProxy);
  const result = await searchDocument(source, "Molar", { firstPage: 2, lastPage: 4, isCancelled: () => false });
  assert.deepEqual(result.matches.map((match) => match.page), [2, 3, 4]);
  assert.deepEqual(requested, [2, 3, 4]);

  // Text is read once per page.
  await searchDocument(source, "page", { firstPage: 2, lastPage: 4, isCancelled: () => false });
  assert.deepEqual(requested, [2, 3, 4]);

  assert.equal(await searchDocument(source, "molar", { firstPage: 1, lastPage: 5, isCancelled: () => true }), null);
  assert.deepEqual((await searchDocument(source, "   ", { firstPage: 1, lastPage: 5, isCancelled: () => false })).matches, []);
});

test("PDF text can be read on Safari without a ReadableStream async iterator", async (context) => {
  const descriptor = Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator);
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { configurable: true, value: undefined });
  context.after(() => Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, descriptor));
  let reads = 0;
  const source = createDocumentTextSource({ numPages: 1, async getPage() {
    return {
      getViewport: () => VIEWPORT,
      getTextContent: () => { throw new Error("Safari cannot iterate this stream"); },
      streamTextContent: () => new ReadableStream({ start(controller) {
        reads++;
        controller.enqueue({ items: [item("bio", 50, 700, 30)] });
        controller.enqueue({ items: [item("chemistry", 80, 700, 90)] });
        controller.close();
      } })
    };
  } });
  const result = await searchDocument(source, "biochemistry", { firstPage: 1, lastPage: 1, isCancelled: () => false });
  assert.equal(result.matches.length, 1);
  await source.pageIndex(1);
  assert.equal(reads, 1);
});
