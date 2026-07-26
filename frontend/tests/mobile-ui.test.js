import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("the viewport permits user zoom and declares an iPhone safe-area viewport", async () => {
  const html = await source("../index.html");
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(html, /maximum-scale\s*=/i);
});

test("confirmation dialogs keep focus and scrolling contained on small screens", async () => {
  const [dialog, styles] = await Promise.all([
    source("../src/components/shared/ConfirmDialog.jsx"),
    source("../src/styles.css")
  ]);

  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /document\.body\.style\.overflow\s*=\s*"hidden"/);
  assert.match(dialog, /triggerRef\.current\?\.focus\?\.\(\)/);
  assert.match(dialog, /type="button"/);
  assert.match(styles, /\.confirm-dialog\s*\{[\s\S]*max-height: calc\(100dvh/);
  assert.match(styles, /\.confirm-actions\s*\{[\s\S]*flex-direction: column-reverse/);
});

test("shared mobile styles provide safe card, action, and focus-workspace layouts", async () => {
  const styles = await source("../src/styles.css");
  assert.match(styles, /\.stats-grid\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.btn\.compact,[\s\S]*min-height: 44px/);
  assert.match(styles, /\.pdf-study-sidebar\.collapsed\.dock-left[\s\S]*translateY\(calc\(100% - 60px\)\)/);
  assert.match(styles, /\.pdf-study-sidebar\s*\{[\s\S]*overflow-x: hidden/);
  assert.match(styles, /\.pdf-workspace-header\s*\{[\s\S]*grid-template-columns: 44px minmax\(0, 1fr\)/);
  assert.match(styles, /\.pdf-workspace-session-controls\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("Focus Workspace starts its annotation sheet closed on phone viewports", async () => {
  const workspace = await source("../src/pages/SheetStudy.jsx");
  assert.match(workspace, /const isPhoneViewport = \(\) =>/);
  assert.match(workspace, /useState\(\(\) => !isPhoneViewport\(\)/);
  assert.match(workspace, /if \(nextIsMobile\) setIsSidebarOpen\(false\)/);
  assert.match(workspace, /pdf-workspace-utility-controls/);
  assert.match(workspace, /pdf-workspace-session-controls/);
});
