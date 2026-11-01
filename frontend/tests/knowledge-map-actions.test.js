import assert from "node:assert/strict";
import test from "node:test";
import { createArtifact } from "../src/workspace/knowledge/model.js";
import { addIdea, linkIdeas, curvedConnection, fitIdeas } from "../src/workspace/knowledge/mapActions.js";

test("branches are placed and connected without mutating the original", () => {
  const original = addIdea(createArtifact("map", {}).content, "Root");
  const parent = original.nodes[0];
  const first = addIdea(original, "Branch", parent.id);
  const second = addIdea(first, "Another", parent.id);
  assert.equal(original.nodes.length, 1);
  assert.equal(second.edges.length, 2);
  assert.equal(second.edges[0].from, parent.id);
  assert.equal(second.edges[0].to, second.nodes[1].id);
  assert.ok(second.nodes[2].y >= second.nodes[1].y + second.nodes[1].height);
});

test("links reject duplicates, self links, missing nodes and over-capacity", () => {
  let map = addIdea(addIdea(createArtifact("map", {}).content, "A"), "B");
  const [a, b] = map.nodes.map(node => node.id);
  assert.equal(linkIdeas(map, a, a), map);
  assert.equal(linkIdeas(map, a, "missing"), map);
  map = linkIdeas(map, a, b, "supports");
  assert.equal(linkIdeas(map, a, b), map);
  const full = { ...map, edges: Array.from({ length: 600 }, () => map.edges[0]) };
  assert.equal(addIdea(full, "C", a), full);
});

test("curves meet card edges and fit retains both nodes inside a phone viewport", () => {
  const nodes = [{ x: 2000, y: 3000, width: 190, height: 64 }, { x: 2040, y: 3200, width: 190, height: 64 }];
  const line = curvedConnection(...nodes);
  assert.match(line.path, /^M .* C /);
  assert.equal(line.to.y, nodes[1].y);
  const view = fitIdeas(nodes, 288, 310);
  for (const node of nodes) {
    assert.ok(node.x * view.zoom - view.x >= 0);
    assert.ok((node.x + node.width) * view.zoom - view.x <= 288);
    assert.ok((node.y + node.height) * view.zoom - view.y <= 310);
  }
});
