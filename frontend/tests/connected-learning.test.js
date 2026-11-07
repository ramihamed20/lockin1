import assert from "node:assert/strict";
import test from "node:test";
import { plannedSourcePage } from "../src/workspace/knowledge/usePlannedSourceNavigation.js";
import { comparisonDraft } from "../src/workspace/knowledge/learningModel.js";

test("planned navigation respects the exact file, version and unlocked pages", () => {
  const search = new URLSearchParams({ studyPage: "5", studyVersion: "v1", studyFile: "file1" });
  const source = { versionId: "v1", fileId: "file1" };
  assert.equal(plannedSourcePage(search, source, 10), 5);
  assert.equal(plannedSourcePage(search, source, 4), null);
  assert.equal(plannedSourcePage(search, { ...source, versionId: "v2" }, 10), null);
  assert.equal(plannedSourcePage(search, { ...source, fileId: "file2" }, 10), null);
  for (const value of ["0", "-1", "1.5", "5bad"]) {
    search.set("studyPage", value); assert.equal(plannedSourcePage(search, source, 10), null);
  }
});
test("comparison links both concepts and actual pages", () => {
  const draft = comparisonDraft([{ id: "one", title: "A", page_start: 7, page_end: 9 }, { id: "two", title: "B", page_start: 2, page_end: 3 }], key => key);
  assert.equal(draft.page_start, 2); assert.equal(draft.page_end, 9);
  assert.deepEqual(draft.concept_ids, ["one", "two"]);
  assert.equal(comparisonDraft([{ id: "one" }, { id: "one" }], key => key), null);
});
