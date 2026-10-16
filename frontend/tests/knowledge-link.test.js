import assert from "node:assert/strict";
import test from "node:test";
import { connectionGeometry, copyMapSelection, createArtifact, addMapNode, pasteMapSelection, removeMapNodes } from "../src/workspace/knowledge/model.js";

test("map arrows end at node boundaries rather than disappearing under the text boxes", () => {
  const from = { x: 0, y: 0, width: 100, height: 100, shape: "rectangle" };
  const to = { x: 300, y: 0, width: 100, height: 100, shape: "circle" };
  assert.deepEqual(connectionGeometry(from, to), { from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
});

test("copied concepts and relationships survive deletion of the original nodes", () => {
  let map = addMapNode(createArtifact("map", {}).content, "first");
  map = addMapNode(map, "second");
  const ids = map.nodes.map((node) => node.id);
  map.edges = [{ id: "edge", from: ids[0], to: ids[1], label: "relates", style: "solid" }];
  const clipboard = copyMapSelection(map, ids);
  const empty = removeMapNodes(map, ids);
  const pasted = pasteMapSelection(empty, clipboard);
  assert.equal(pasted.nodes.length, 2);
  assert.equal(pasted.edges.length, 1);
  assert.notEqual(pasted.nodes[0].id, ids[0]);
  assert.equal(pasted.edges[0].from, pasted.nodes[0].id);
});
