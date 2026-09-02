import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mergeSearchResults } from "../src/lib/globalSearch.js";

const searchLibrary = readFileSync(fileURLToPath(new URL("../src/lib/globalSearch.js", import.meta.url)), "utf8");
const searchComponent = readFileSync(fileURLToPath(new URL("../src/components/search/GlobalSearch.jsx", import.meta.url)), "utf8");
const layout = readFileSync(fileURLToPath(new URL("../src/components/layout/index.jsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");

test("global search ranks exact, prefix, title, and metadata matches", () => {
  const results = mergeSearchResults("cell", [
    { title: "Cellular Biology Introduction", subtitle: "Histology", type: "material", destination: "/three", metadata: {} },
    { title: "Histology overview", subtitle: "Cell and tissue", type: "material", destination: "/four", metadata: {} },
    { title: "Cell structure", subtitle: "Histology", type: "pdf", destination: "/two", metadata: {} },
    { title: "Cell", subtitle: "Histology", type: "subject", destination: "/one", metadata: {} }
  ]);
  const positions = Object.fromEntries(results.map((result, index) => [result.destination, index]));
  assert.ok(positions["/one"] < positions["/two"]);
  assert.ok(positions["/two"] < positions["/three"]);
  assert.ok(positions["/three"] < positions["/four"]);
});

test("global search has no client-seeded production results", () => {
  assert.doesNotMatch(searchLibrary, /materialCatalog|demoQuizCatalog|MATERIAL_CATALOG|catalogSearchResults|questions\/demo/);
  assert.match(searchLibrary, /serverResults\.forEach/);
  assert.match(searchComponent, /discoveryApi\.search\(\{ query, limit: 12, signal: controller\.signal \}\)/);
  assert.match(searchComponent, /mergeSearchResults\(query, serverResults\)/);
});

test("the reusable type-ahead uses cancellation and accessible keyboard controls", () => {
  assert.match(layout, /<GlobalSearch onOpenChange=\{setGlobalSearchOpen\}/);
  assert.match(searchComponent, /new globalThis\.AbortController\(\)/);
  assert.match(searchComponent, /window\.setTimeout\(\(\) => \{/);
  assert.match(searchComponent, /event\.key === "ArrowDown"/);
  assert.match(searchComponent, /event\.key === "ArrowUp"/);
  assert.match(searchComponent, /event\.key === "Enter"/);
  assert.match(searchComponent, /event\.key === "Escape"/);
  assert.match(searchComponent, /role: "combobox"/);
  assert.match(searchComponent, /role="listbox"/);
  assert.match(searchComponent, /role="option"/);
  assert.match(searchComponent, /dir="auto"/);
});

test("the search overlay remains usable on compact touch screens", () => {
  // The overlay opens with the caret already in the field, so the keyboard is
  // always up while it is on screen: it takes the visible height of the
  // application and ends where the keyboard begins, rather than running
  // underneath it.
  const overlay = styles.slice(styles.indexOf(".global-search-mobile-layer {"));
  assert.match(styles, /\.global-search-mobile-layer/);
  assert.match(overlay, /block-size: var\(--app-viewport-height\)/);
  assert.match(overlay, /padding: max\(var\(--safe-top\), 12px\) 12px max\(var\(--safe-bottom\), 12px, var\(--keyboard-inset\)\)/);
  assert.match(styles, /\.global-search-mobile-results[\s\S]*overflow: auto/);
  assert.match(styles, /@media \(max-width: 639px\), \(max-height: 559px\)/);
});
