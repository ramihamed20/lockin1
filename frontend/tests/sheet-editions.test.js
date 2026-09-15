import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildActiveStudyJsonPrompt } from "../src/lib/activeStudyPrompt.js";
import { copyTextToClipboard } from "../src/lib/clipboard.js";
import { resolveSheetEdition, withEditionPdfUrl } from "../src/lib/materialCatalog.js";

const UNIVERSITY_URL = "/api/v1/files/11111111-1111-1111-1111-111111111111/view";
const LOCKIN_URL = "/api/v1/files/22222222-2222-2222-2222-222222222222/view";
const SUMMARY_URL = "/api/v1/files/33333333-3333-3333-3333-333333333333/view";

/** One sheet published in both editions, shaped like the catalog payload. */
function material({ withLockin = true } = {}) {
  const editions = [
    {
      edition: "university",
      label: "University Sheet",
      slug: "patho",
      summaryPdf: { viewUrl: SUMMARY_URL, pageCount: 4 },
      summaryStatus: "available",
      pageCount: 22,
      hasActiveStudy: true,
      deliverable: true
    }
  ];
  if (withLockin) {
    editions.push({
      edition: "lockin",
      label: "Lockin Sheet",
      slug: "patho-lockin",
      summaryPdf: null,
      summaryStatus: "missing",
      pageCount: 18,
      hasActiveStudy: true,
      deliverable: true
    });
  }
  return [{
    slug: "anatomy",
    title: "Anatomy",
    sheets: [{ slug: "patho", title: "Patho", learningObjectId: "sheet-1", pageCount: 22, editions }]
  }];
}

function pdfUrlFor(materials, slug) {
  return resolveSheetEdition(materials[0], slug).view?.pdfUrl || "";
}

test("each edition's address resolves to that edition, and never to the other", () => {
  const materials = material();
  const university = resolveSheetEdition(materials[0], "patho");
  const lockin = resolveSheetEdition(materials[0], "patho-lockin");

  assert.equal(university.edition.edition, "university");
  assert.equal(university.view.pageCount, 22);
  assert.equal(lockin.edition.edition, "lockin");
  assert.equal(lockin.view.pageCount, 18);
  // Same sheet, same question bank, different PDF.
  assert.equal(university.sheet, lockin.sheet);
  assert.notEqual(university.edition.slug, lockin.edition.slug);
});

test("a resolved PDF is attached to the addressed edition only", () => {
  // The Lock-in address used to leave every edition without a URL, and the
  // reader then drew its built-in placeholder document instead.
  const withLockinPdf = withEditionPdfUrl(material(), {
    materialSlug: "anatomy",
    slug: "patho-lockin",
    pdfUrl: LOCKIN_URL
  });
  assert.equal(pdfUrlFor(withLockinPdf, "patho-lockin"), LOCKIN_URL);
  assert.equal(pdfUrlFor(withLockinPdf, "patho"), "");

  const withUniversityPdf = withEditionPdfUrl(material(), {
    materialSlug: "anatomy",
    slug: "patho",
    pdfUrl: UNIVERSITY_URL
  });
  assert.equal(pdfUrlFor(withUniversityPdf, "patho"), UNIVERSITY_URL);
  assert.equal(pdfUrlFor(withUniversityPdf, "patho-lockin"), "");

  // A different material is left alone entirely.
  assert.deepEqual(
    withEditionPdfUrl(material(), { materialSlug: "other", slug: "patho", pdfUrl: UNIVERSITY_URL }),
    material()
  );
});

test("the Sheet Summary is attached as its own PDF with its own page count", () => {
  const materials = withEditionPdfUrl(material(), {
    materialSlug: "anatomy",
    slug: "patho",
    pdfUrl: SUMMARY_URL,
    pageCount: 4,
    hasActiveStudy: false
  });
  const view = resolveSheetEdition(materials[0], "patho").view;
  assert.equal(view.pdfUrl, SUMMARY_URL);
  assert.equal(view.pageCount, 4);
  // A summary is Normal Mode only.
  assert.equal(view.hasActiveStudy, false);
});

test("a sheet with no Lockin PDF reports the missing edition instead of another file", () => {
  const materials = material({ withLockin: false });
  const resolved = resolveSheetEdition(materials[0], "patho-lockin");
  assert.equal(resolved.view, null);
  assert.equal(resolved.edition, null);
  assert.equal(resolved.missingEdition, "lockin");
  // The sheet is still identified, so the page can name what is unavailable.
  assert.equal(resolved.sheet.slug, "patho");
  // And no URL can be attached to an edition that is not published.
  const attempted = withEditionPdfUrl(materials, {
    materialSlug: "anatomy",
    slug: "patho-lockin",
    pdfUrl: LOCKIN_URL
  });
  assert.equal(pdfUrlFor(attempted, "patho-lockin"), "");
  assert.equal(pdfUrlFor(attempted, "patho"), "");
});

test("an unknown sheet stays unknown rather than resolving to a neighbour", () => {
  const materials = material();
  const resolved = resolveSheetEdition(materials[0], "something-else");
  assert.equal(resolved.sheet, null);
  assert.equal(resolved.view, null);
  assert.equal(resolved.missingEdition, "");
});

test("the Active Study prompt builds for every difficulty and part count", () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    for (let parts = 1; parts <= 12; parts += 1) {
      const pageRanges = Array.from({ length: parts }, (_, index) => ({
        part: index + 1,
        start_page: index * 4 + 1,
        end_page: index * 4 + 4
      }));
      const prompt = buildActiveStudyJsonPrompt({
        difficulty,
        numberOfParts: parts,
        pageRanges,
        questionsPerPart: 15,
        finalExamQuestions: 50
      });
      assert.match(prompt, new RegExp(`Difficulty: ${difficulty}`));
      assert.match(prompt, new RegExp(`Number of Parts: ${parts}\\b`));
      assert.equal((prompt.match(/"part": \d+/g) || []).length, parts);
      assert.match(prompt, new RegExp(`Part ${parts} → Pages ${(parts - 1) * 4 + 1}–${parts * 4}`));
    }
  }
});

test("the prompt uses the page ranges of the edition on screen", () => {
  // Same bank, same part count; only the pages differ between editions.
  const lockinRanges = [
    { part: 1, start_page: 1, end_page: 4 },
    { part: 2, start_page: 5, end_page: 8 },
    { part: 3, start_page: 9, end_page: 12 },
    { part: 4, start_page: 13, end_page: 18 }
  ];
  const prompt = buildActiveStudyJsonPrompt({
    difficulty: "medium",
    numberOfParts: 4,
    pageRanges: lockinRanges,
    questionsPerPart: 15,
    finalExamQuestions: 50
  });
  assert.match(prompt, /Part 4 → Pages 13–18/);
  assert.doesNotMatch(prompt, /Pages 16–22/);
  assert.match(prompt, /Questions per Part: 15/);
  assert.match(prompt, /Final Exam Questions: 50/);
});

/** Runs `body` with `navigator` and `document` stubbed, then restores them. */
async function withStubbedDom({ clipboard, execCommand }, body) {
  const originals = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const hadDocument = "document" in globalThis;
  const originalDocument = globalThis.document;
  const appended = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true, writable: true });
  globalThis.document = {
    body: {
      appendChild(node) {
        appended.push(node);
        return node;
      }
    },
    createElement() {
      return {
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() {}
      };
    },
    execCommand
  };
  try {
    return await body({ appended });
  } finally {
    if (originals) Object.defineProperty(globalThis, "navigator", originals);
    else delete globalThis.navigator;
    if (hadDocument) globalThis.document = originalDocument;
    else delete globalThis.document;
  }
}

test("copying uses the clipboard API when it works", async () => {
  const written = [];
  const copied = await withStubbedDom(
    { clipboard: { writeText: async (text) => { written.push(text); } }, execCommand: () => false },
    () => copyTextToClipboard("PROMPT")
  );
  assert.equal(copied, true);
  assert.deepEqual(written, ["PROMPT"]);
});

test("a blocked clipboard API falls back to a selection copy rather than failing", async () => {
  // Browsers reject writeText for reasons unrelated to the user: an unfocused
  // document, a permission policy, a non-secure origin.
  const copied = await withStubbedDom(
    {
      clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } },
      execCommand: () => true
    },
    async ({ appended }) => {
      const result = await copyTextToClipboard("PROMPT");
      assert.equal(appended.length, 1, "the fallback selects a real element");
      return result;
    }
  );
  assert.equal(copied, true);
});

test("copying reports failure so the caller can show the text to copy by hand", async () => {
  const copied = await withStubbedDom(
    { clipboard: undefined, execCommand: () => false },
    () => copyTextToClipboard("PROMPT")
  );
  assert.equal(copied, false);
  assert.equal(await copyTextToClipboard(""), false);
});

test("Admin always gives the prompt a way out of the browser", async () => {
  const page = await readFile(new URL("../src/pages/AdminContentManagement.jsx", import.meta.url), "utf8");
  assert.match(page, /copyTextToClipboard/);
  // The prompt is shown, focused and selected when the clipboard is refused,
  // and can be revealed on demand at any time.
  assert.match(page, /setShowPrompt\(!copied\)/);
  assert.match(page, /promptRef\.current\.focus\(\); promptRef\.current\.select\(\)/);
  assert.match(page, /Show prompt/);
  assert.doesNotMatch(page, /navigator\.clipboard\.writeText/);
});

test("the reader never falls back to a document the address did not name", async () => {
  const workspace = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  assert.match(workspace, /withEditionPdfUrl\(materials, \{/);
  // A catalog sheet without its own PDF is stopped before the view, whose
  // no-PDF branch renders a built-in placeholder document.
  assert.match(workspace, /if \(!readable\?\.pdfUrl\) \{/);
  assert.match(workspace, /materials\.editionUnavailable/);
  assert.doesNotMatch(workspace, /entry\.slug === sheetSlug \? \{ \.\.\.entry, pdfUrl/);
});

test("the reader tells the server which of a sheet's PDFs it is marking", async () => {
  const [workspace, focusApiSource, sync] = await Promise.all([
    readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/focus.js", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/catalogServerSync.js", import.meta.url), "utf8")
  ]);
  // The summary resolves a real document, so its marks sync like any other.
  assert.match(workspace, /summaryMode \? "summary" : ""/);
  assert.match(workspace, /catalogDocument=\{catalogDocument\.document\}/);
  assert.doesNotMatch(workspace, /catalogDocument=\{summaryMode \? null/);
  // The scope travels with every annotation call.
  assert.match(workspace, /scope: \{ edition: scopeEdition, view: scopeView \}/);
  assert.match(sync, /focus\.getAnnotations\(documentVersionId, \{ pages, page, pageSize: 250, scope \}\)/);
  assert.match(sync, /focus\.syncAnnotations\(documentVersionId, \{\s*\n\s*scope,/);
  assert.match(focusApiSource, /function scopeQuery\(scope\)/);
});

test("an omitted scope still addresses the University study document", async () => {
  const { focusApi } = await import("../src/api/focus.js");
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ collection_revision: 0, results: [], count: 0, next: null, previous: null }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await focusApi.getAnnotations("11111111-1111-1111-1111-111111111111", { pages: [1] });
    await focusApi.getAnnotations("11111111-1111-1111-1111-111111111111", { pages: [1], scope: { edition: "university", view: "study" } });
    await focusApi.getAnnotations("11111111-1111-1111-1111-111111111111", { pages: [1], scope: { edition: "lockin", view: "summary" } });
  } finally {
    globalThis.fetch = originalFetch;
  }
  // The legacy call and an explicit University/study scope are the same request.
  assert.doesNotMatch(seen[0], /edition=|view=/);
  assert.doesNotMatch(seen[1], /edition=|view=/);
  assert.match(seen[2], /edition=lockin/);
  assert.match(seen[2], /view=summary/);
});
