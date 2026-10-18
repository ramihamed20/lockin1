import assert from "node:assert/strict";
import test from "node:test";
import { addSummaryPages, composeWorkspacePages, insertVirtualPage, MAX_VIRTUAL_PAGES, removeSummaryPages, sanitizeVirtualPages } from "../src/workspace/catalog/virtualPages.js";
import { isRtlText, writtenTextPages } from "../src/workspace/summary/summaryPdf.js";

const SUMMARY = "7318de3c-69b0-4425-8c8e-1ccba18c0df8";
const OTHER = "91281aba-0000-4000-8000-000000000000";

test("a pen summary adds one blank page after every sheet page without renumbering it", () => {
  const own = [{ id: -5, afterPage: 2, background: "lined" }];
  const pages = addSummaryPages(own, SUMMARY, 3);
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.filter((item) => item.summary === SUMMARY).map((item) => item.afterPage), [1, 2, 3]);
  const composed = composeWorkspacePages([1, 2, 3], pages);
  assert.deepEqual(composed.map((item) => item.kind === "pdf" ? item.key : item.summary ? "S" : "own"), [1, "S", 2, "own", "S", 3, "S"]);
  assert.equal(composed.filter((item) => item.kind === "pdf").map((item) => item.key).join(), "1,2,3");
  // Starting the same summary twice adds nothing.
  assert.equal(addSummaryPages(pages, SUMMARY, 3).length, 4);
});

test("summary pages survive storage, keep their own limit and are removed only with their summary", () => {
  const many = Array.from({ length: MAX_VIRTUAL_PAGES }, (_, index) => ({ id: -(index + 1), afterPage: 1 }));
  const withSummaries = addSummaryPages(addSummaryPages(many, SUMMARY, 300), OTHER, 300);
  assert.equal(withSummaries.length, MAX_VIRTUAL_PAGES + 600);
  assert.equal(sanitizeVirtualPages(JSON.parse(JSON.stringify(withSummaries))).length, MAX_VIRTUAL_PAGES + 600);
  // The student's own pages are still capped, whatever summaries there are.
  assert.equal(insertVirtualPage(withSummaries, 1, -999_999).length, withSummaries.length);
  const left = removeSummaryPages(withSummaries, SUMMARY);
  assert.equal(left.filter((item) => item.summary === SUMMARY).length, 0);
  assert.equal(left.filter((item) => item.summary === OTHER).length, 300);
  assert.equal(left.filter((item) => !item.summary).length, MAX_VIRTUAL_PAGES);
  // A malformed summary id is not trusted.
  assert.equal(sanitizeVirtualPages([{ id: -1, afterPage: 1, summary: "<script>" }])[0].summary, undefined);
});

test("a keyboard summary lists its written pages in sheet order and reads Arabic right to left", () => {
  const pages = writtenTextPages({ pages: { 10: "Ten", 2: "  ", 3: "خلية", x: "bad" } });
  assert.deepEqual(pages, [{ page: 3, text: "خلية" }, { page: 10, text: "Ten" }]);
  assert.equal(isRtlText("خلية"), true);
  assert.equal(isRtlText("Cell"), false);
});
