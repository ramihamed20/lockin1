import assert from "node:assert/strict";
import test from "node:test";
import { addMapNode, arrangeMap, cloneMapSelection, createArtifact, formatNotebookText, removeMapNodes } from "../src/workspace/knowledge/model.js";
import { knowledgeMessages } from "../src/lib/knowledgeMessages.js";

test("maps support arbitrary relationships and removing a node removes dangling edges", () => {
  let map = createArtifact("map", {}).content;
  map = addMapNode(map, "أكسجين / oxygen");
  map = addMapNode(map, "Diffusion");
  const [first, second] = map.nodes;
  map.edges = [{ id: "relation", from: second.id, to: first.id, label: "supports", style: "dashed" }];
  const copied = cloneMapSelection(map, [first.id, second.id]);
  assert.equal(copied.nodes.length, 4);
  assert.equal(copied.edges.length, 2);
  assert.notEqual(copied.edges[1].from, second.id);
  const removed = removeMapNodes(map, [first.id]);
  assert.deepEqual(removed.edges, []);
  assert.equal(removed.nodes.length, 1);
});

test("automatic layout is explicit and does not mutate the original manual layout", () => {
  const original = addMapNode(createArtifact("map", {}).content, "Manual node");
  original.nodes[0].x = 937;
  const arranged = arrangeMap(original);
  assert.equal(original.nodes[0].x, 937);
  assert.equal(arranged.nodes[0].x, 60);
});

test("notebook formatting preserves mixed language and text outside the selection", () => {
  assert.equal(formatNotebookText("قبل\nOxygen\nبعد", 4, 10, "bold"), "قبل\n**Oxygen**\nبعد");
  assert.equal(formatNotebookText("a\nb", 0, 3, "bullet"), "- a\n- b");
});

test("all study interface translations exist in Arabic and English", () => {
  assert.deepEqual(Object.keys(knowledgeMessages.en).sort(), Object.keys(knowledgeMessages.ar).sort());
});

test("Explain resumes the newest server attempt even when bootstrap is newest-first", async () => {
  const { latestExplainAttempt } = await import("../src/workspace/knowledge/model.js");
  const newest = { id: "new", created_at: "2026-10-14T12:00:00Z" };
  const older = { id: "old", created_at: "2026-10-13T12:00:00Z" };
  assert.equal(latestExplainAttempt([newest, older]), newest);
  assert.equal(latestExplainAttempt([older, newest]), newest);
});
test("a pending explanation never displays earlier feedback as its evaluation", async () => {
  const { latestExplainAttempt } = await import("../src/workspace/knowledge/model.js");
  const pending = { id: "pending", evaluation_status: "pending" };
  const graded = { id: "server", created_at: "2026-10-14T12:00:00Z", feedback: {} };
  assert.equal(latestExplainAttempt([graded, pending]), pending);
});

test("a summary starter adds a heading with an empty bullet, and words count in both languages", async () => {
  const { insertNotebookStarter, notebookWordCount } = await import("../src/workspace/knowledge/model.js");
  assert.equal(insertNotebookStarter("", "Main idea"), "# Main idea\n- ");
  assert.equal(insertNotebookStarter("Vitamins\n\n", "Key terms"), "Vitamins\n\n# Key terms\n- ");
  assert.equal(notebookWordCount(""), 0);
  assert.equal(notebookWordCount("# Main idea\n- Vitamin A's role, 2 forms"), 7);
  assert.equal(notebookWordCount("فيتامين A مهم للرؤية."), 4);
});
