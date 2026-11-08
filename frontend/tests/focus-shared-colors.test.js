import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COLORS, MAX_PALETTE_COLORS } from "../src/pages/focus-workspace/constants.js";
import { addSavedColor, normalizeSavedPalette } from "../src/workspace/catalog/toolPalette.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("students can keep far more than two custom ink colors without dropping earlier ones", () => {
  let custom = [];
  const added = Array.from({ length: 16 }, (_, index) => `#${(0x334455 + index).toString(16).padStart(6, "0")}`);
  for (const color of added) custom = addSavedColor(custom, color, MAX_PALETTE_COLORS, COLORS);
  assert.equal(MAX_PALETTE_COLORS, 32);
  assert.equal(custom.length, 16);
  assert.ok(added.every((color) => custom.includes(color)));
  assert.equal(normalizeSavedPalette([...custom, ...COLORS], MAX_PALETTE_COLORS).length, 16 + COLORS.length);
});

test("adding from the toolbar and the pen inspector uses the same persistent preference", async () => {
  const workspace = await read("../src/pages/CatalogFocusWorkspace.jsx");
  const store = await read("../src/pages/focus-workspace/preferences.js");
  const picker = await read("../src/pages/focus-workspace/QuickColorPicker.jsx");
  assert.match(workspace, /<QuickColorPicker colors=\{quickColors\}/);
  assert.match(workspace, /onSave=\{commitCustomColor\}/);
  assert.match(workspace, /persistRecentColors\(next, \{ notify: true \}\)/);
  assert.match(store, /localStorage\.setItem\(RECENT_COLORS_KEY, JSON\.stringify\(cleaned\)\)/);
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /type="color"/);
  assert.match(picker, /onClick=\{save\}/);
  assert.match(picker, /createPortal\(picker, portalRoot\)/);
});

test("open sheets synchronize saved palettes without relying on cross-tab storage events", async () => {
  const workspace = await read("../src/pages/CatalogFocusWorkspace.jsx");
  const store = await read("../src/pages/focus-workspace/preferences.js");
  assert.match(workspace, /addEventListener\(WORKSPACE_PALETTE_CHANGE_EVENT, sync\)/);
  assert.match(workspace, /addEventListener\("storage", sync\)/);
  assert.match(workspace, /setRecentColors\(\(current\) => same\(current, saved\)/);
  assert.match(store, /dispatchEvent\?\.\(new Event\(WORKSPACE_PALETTE_CHANGE_EVENT\)\)/);
});

test("toolbar palette has a fixed add button, its own scroll region and responsive spacing", async () => {
  const css = await read("../src/pages/focus-toolbar-rhythm.css");
  assert.match(css, /\.workspace-v3-color-scroll/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /\.workspace-v3-color-add/);
  assert.match(css, /\.workspace-quick-color-popover/);
  assert.match(css, /@media \(min-width: 700px\) and \(max-width: 899px\)/);
});
