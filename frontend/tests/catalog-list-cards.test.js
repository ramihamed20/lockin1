import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("subject, sheet and question lists are separate cards, not one framed block with dividers", async () => {
  const [refine, studyFlow] = await Promise.all([
    source("../src/styles/refine.css"),
    source("../src/styles/study-flow.css")
  ]);

  // The containers only space their items.
  assert.match(refine, /:is\(\.catalog-material-grid, \.questions-category-grid, \.catalog-sheet-grid\) \{[^}]*gap: var\(--catalog-item-gap\);[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/);
  // Each item carries its own surface.
  assert.match(refine, /\.catalog-sheet-grid > \.catalog-sheet-card \{[^}]*border: 1px solid var\(--polish-line\);[^}]*border-radius: var\(--catalog-item-radius\);[^}]*background: var\(--catalog-item-surface\);/);
  assert.match(studyFlow, /\.review-bank-subjects > \.review-subject-row \{[^}]*border: 1px solid var\(--polish-line\);[^}]*background: var\(--catalog-item-surface/);
  assert.match(studyFlow, /\.recent-mistake-list > \.recent-mistake \{[^}]*border: 1px solid var\(--polish-line\);/);

  // No hairline dividers between neighbouring items.
  assert.doesNotMatch(refine, /\.catalog-tile \+ \.catalog-tile::before/);
  assert.doesNotMatch(refine, /\.catalog-sheet-card \+ \.catalog-sheet-card::before/);
  assert.doesNotMatch(studyFlow, /\.review-subject-row \+ \.review-subject-row/);
});
