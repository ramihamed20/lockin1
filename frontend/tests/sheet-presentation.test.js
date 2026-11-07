import assert from "node:assert/strict";
import test from "node:test";
import { sheetReadingPosition } from "../src/lib/sheetPresentation.js";
import { recentStudyEntries } from "../src/lib/recentStudy.js";

test("resume progress uses the saved PDF page and its real page count", () => {
  const [entry] = recentStudyEntries([{ material_slug: "histology", sheet_slug: "intro", current_page: 1, page_count: 12 }]);
  assert.deepEqual(sheetReadingPosition(entry), { page: 1, total: 12, percent: 8 });
  assert.deepEqual(sheetReadingPosition({ currentPage: 20, pageCount: 12 }), { page: 12, total: 12, percent: 100 });
});

test("missing, invalid and virtual page positions never manufacture a progress bar", () => {
  for (const entry of [null, {}, { currentPage: -1, pageCount: 12 }, { currentPage: 0, pageCount: 12 }, { currentPage: 3, pageCount: null }, { currentPage: true, pageCount: 12 }]) {
    assert.equal(sheetReadingPosition(entry), null);
  }
});
