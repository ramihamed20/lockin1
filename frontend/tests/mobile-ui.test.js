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

test("the primary mobile navigation is viewport-attached, safe-area-aware, and keyboard-safe", async () => {
  const [layout, styles] = await Promise.all([
    source("../src/components/layout/index.jsx"),
    source("../src/styles.css")
  ]);

  assert.match(styles, /--mobile-bottom-nav-height: calc\(76px \+ var\(--safe-bottom\)\)/);
  assert.match(styles, /\.bottom-nav\s*\{[\s\S]*bottom: 0;/);
  assert.doesNotMatch(styles, /\.bottom-nav\s*\{[^}]*bottom: calc\(/);
  assert.match(styles, /padding: 8px 8px calc\(8px \+ var\(--safe-bottom\)\)/);
  assert.match(styles, /\.app-shell\.keyboard-open\s*\{[\s\S]*--mobile-bottom-nav-height: 0px;/);
  assert.match(styles, /\.app-shell\.keyboard-open \.bottom-nav\s*\{[\s\S]*pointer-events: none/);
  assert.match(layout, /window\.visualViewport/);
  assert.match(layout, /viewportDelta > 150/);
  assert.match(layout, /keyboardOpen \? "keyboard-open" : ""/);
});

test("Focus Workspace starts its annotation sheet closed on phone viewports", async () => {
  const workspace = await source("../src/pages/SheetStudy.jsx");
  assert.match(workspace, /const isPhoneViewport = \(\) =>/);
  assert.match(workspace, /useState\(\(\) => !isPhoneViewport\(\)/);
  assert.match(workspace, /if \(nextIsMobile\) setIsSidebarOpen\(false\)/);
  assert.match(workspace, /pdf-workspace-utility-controls/);
  assert.match(workspace, /pdf-workspace-session-controls/);
});

test("dashboard summary cards are full-card keyboard links to their real destinations", async () => {
  const [dashboard, statsGrid, styles] = await Promise.all([
    source("../src/pages/Dashboard.jsx"),
    source("../src/components/shared/StatsGrid.jsx"),
    source("../src/styles.css")
  ]);

  assert.match(dashboard, /className="dashboard-stats-grid"/);
  assert.match(dashboard, /Completed:\s*\{\s*to: "\/materials"/);
  assert.match(dashboard, /Saved:\s*\{\s*to: "\/bookmarks"/);
  assert.match(dashboard, /"Due review":\s*\{\s*to: "\/review"/);
  assert.match(dashboard, /Sessions:\s*\{\s*to: "\/security"/);
  assert.match(statsGrid, /<Link\s+className="stat-card-action"/);
  assert.match(statsGrid, /aria-label=/);
  assert.match(styles, /\.dashboard-stats-grid \.stat-card-action[\s\S]*min-height: 92px/);
  assert.match(styles, /\.dashboard-stats-grid \.stat-card-action:focus-visible/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
});
