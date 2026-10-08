import assert from "node:assert/strict";
import test from "node:test";
import { coveredSearchMatchIds, searchCoverEntries, MAX_COVERS_PER_ACTION } from "../src/workspace/catalog/recallCovers.js";

const match = (id, page, rectangles = [{ x: 120, y: 80, width: 60, height: 20 }]) => ({ id, page, rectangles, snippet: { match: "enamel" } });

test("all 500 search results can become covers without losing multiline answers", () => {
  const matches = Array.from({ length: 500 }, (_, index) => match(String(index), index + 1, [
    { x: 120, y: 80, width: 60, height: 20 }, { x: 40, y: 110, width: 80, height: 20 }
  ]));
  let nextId = 0;
  const entries = searchCoverEntries(matches, [], () => String(++nextId));
  assert.equal(entries.length, 1000);
  assert.ok(entries.length <= MAX_COVERS_PER_ACTION);
  assert.equal(new Set(entries.map((entry) => entry.groupId)).size, 500);
  assert.equal(entries[998].groupId, entries[999].groupId);
});

test("an already covered result is not covered twice, while another page stays independent", () => {
  const matches = [match("first", 1), match("second", 2)];
  const annotations = [{ type: "cover", page: 1, x: 120, y: 80, width: 60, height: 20 }];
  assert.deepEqual([...coveredSearchMatchIds(matches, annotations)], ["first"]);
  assert.equal(searchCoverEntries(matches, annotations, () => "group").length, 1);
  assert.equal(searchCoverEntries(matches, annotations, () => "group")[0].page, 2);
});

test("a multiline result is hidden only when all its rectangles are covered", () => {
  const matches = [match("wrapped", 1, [{ x: 120, y: 80, width: 60, height: 20 }, { x: 40, y: 110, width: 80, height: 20 }])];
  assert.equal(coveredSearchMatchIds(matches, [{ type: "cover", page: 1, x: 120, y: 80, width: 60, height: 20 }]).size, 0);
});

test("rehiding a partially covered answer only restores the missing line to its group", () => {
  const rectangles = [{ x: 120, y: 80, width: 60, height: 20 }, { x: 40, y: 110, width: 80, height: 20 }];
  const annotations = [{ type: "cover", page: 1, ...rectangles[0], groupId: "answer" }];
  const entries = searchCoverEntries([match("wrapped", 1, rectangles)], annotations, () => "new");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].groupId, "answer");
  assert.equal(entries[0].y, 110);
});
