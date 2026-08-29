import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("the viewport permits user zoom and declares an iPhone safe-area viewport", async () => {
  const [html, styles] = await Promise.all([
    source("../index.html"),
    source("../src/styles.css")
  ]);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(html, /maximum-scale\s*=/i);
  assert.match(styles, /@supports \(height: 100dvh\)[\s\S]*--app-viewport-height: 100dvh/);
  assert.match(styles, /@media \(display-mode: standalone\)\s*\{\s*:root\s*\{[\s\S]*--app-viewport-height: 100vh/);
  assert.match(styles, /body,\s*#root\s*\{[\s\S]*min-block-size: var\(--app-viewport-height\)/);
});

test("the iPad shell, overlays, and immersive workspaces preserve safe areas", async () => {
  const [styles, responsive, workspace, lockIn] = await Promise.all([
    source("../src/styles.css"),
    source("../src/responsive.css"),
    source("../src/pages/catalog-focus-workspace.css"),
    source("../src/pages/lock-in-reference.css")
  ]);

  assert.match(styles, /--safe-top: env\(safe-area-inset-top, 0px\)/);
  assert.match(responsive, /@media \(min-width: 640px\)[\s\S]*\.app-shell\s*\{[\s\S]*padding: 0 var\(--safe-right\) var\(--safe-bottom\) var\(--safe-left\)/);
  assert.match(responsive, /\.topbar\s*\{[\s\S]*min-height: calc\(68px \+ var\(--safe-top\)\)[\s\S]*padding: calc\(10px \+ var\(--safe-top\)\)/);
  assert.match(workspace, /\.workspace-v2-toolbar \{[\s\S]*padding: env\(safe-area-inset-top\)[\s\S]*env\(safe-area-inset-right\)[\s\S]*env\(safe-area-inset-left\)/);
  assert.match(workspace, /\.workspace-v2:fullscreen,[\s\S]*padding: 0 0 env\(safe-area-inset-bottom\)/);
  assert.match(lockIn, /\.lockin-reference-viewer:fullscreen,[\s\S]*padding: var\(--safe-top\) var\(--safe-right\) var\(--safe-bottom\) var\(--safe-left\)/);
});

test("the iPad shell uses a labelled sidebar and one continuous safe-area-aware navigation surface", async () => {
  const responsive = await source("../src/responsive.css");
  const tabletShell = responsive.slice(responsive.indexOf("/* iPad / tablet shell"));

  assert.match(tabletShell, /@media \(min-width: 768px\) and \(max-width: 1199px\)/);
  assert.match(tabletShell, /--tablet-sidebar-width: clamp\(204px, 27vw, 232px\)/);
  assert.match(tabletShell, /grid-template-columns: var\(--tablet-sidebar-width\) minmax\(0, 1fr\)/);
  assert.match(tabletShell, /\.sidebar \{[\s\S]*padding: calc\(var\(--space-4\) \+ var\(--safe-top\)\)/);
  assert.match(tabletShell, /\.sidebar \.nav-btn \{[\s\S]*min-height: 48px[\s\S]*flex-direction: row/);
  assert.match(tabletShell, /\.sidebar \.nav-btn\.active \{[\s\S]*background: color-mix\(in srgb, var\(--color-primary\) 9%/);
  assert.match(tabletShell, /\.topbar \{[\s\S]*min-height: calc\(var\(--tablet-header-height\) \+ var\(--safe-top\)\)[\s\S]*background: var\(--tablet-shell-surface\)/);
  assert.match(tabletShell, /@media \(min-width: 900px\) and \(max-width: 1199px\)[\s\S]*\.topbar \.search-box/);
  assert.match(tabletShell, /\.app-shell \{[\s\S]*height: var\(--app-viewport-height\)[\s\S]*overflow: hidden/);
  assert.match(tabletShell, /\.sidebar \{[\s\S]*grid-template-rows: 48px minmax\(0, 1fr\) auto[\s\S]*overflow: hidden/);
  assert.match(tabletShell, /\.sidebar \.nav-list \{[\s\S]*min-height: 0[\s\S]*overflow-y: auto[\s\S]*overscroll-behavior: contain[\s\S]*-webkit-overflow-scrolling: touch/);
  assert.match(tabletShell, /\.content-frame \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)[\s\S]*overflow: hidden/);
  assert.match(tabletShell, /\.page-shell \{[\s\S]*min-height: 0[\s\S]*overflow-y: auto[\s\S]*overscroll-behavior: contain/);
  assert.match(tabletShell, /\.topbar \.search-box \{[\s\S]*display: flex[\s\S]*width: clamp\(132px, 22vw, 288px\)/);
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
  assert.match(styles, /\.confirm-dialog\s*\{[\s\S]*max-height: calc\(var\(--app-viewport-height\)/);
  assert.match(styles, /\.confirm-actions\s*\{[\s\S]*flex-direction: column-reverse/);
});

test("shared mobile styles provide safe cards and the current Focus workspace layout", async () => {
  const [styles, workspace] = await Promise.all([
    source("../src/styles.css"),
    source("../src/pages/catalog-focus-workspace.css")
  ]);
  assert.match(styles, /\.stats-grid\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.btn\.compact,[\s\S]*min-height: 44px/);
  assert.match(workspace, /@media \(max-width: 1199px\)[\s\S]*\.workspace-v2-body\.has-side \.workspace-v2-side\s*\{[\s\S]*position: fixed/);
  assert.match(workspace, /\.workspace-v2-document-stage\s*\{[^}]*overflow: auto[^}]*touch-action: none/);
});

test("the primary mobile navigation is viewport-attached, safe-area-aware, and keyboard-safe", async () => {
  const [layout, styles, responsive] = await Promise.all([
    source("../src/components/layout/index.jsx"),
    source("../src/styles.css"),
    source("../src/responsive.css")
  ]);

  assert.match(styles, /--mobile-bottom-nav-height: calc\(76px \+ var\(--safe-bottom\)\)/);
  assert.match(styles, /\.bottom-nav\s*\{[\s\S]*bottom: 0;/);
  assert.doesNotMatch(styles, /\.bottom-nav\s*\{[^}]*bottom: calc\(/);
  assert.match(styles, /padding: 8px 8px calc\(8px \+ var\(--safe-bottom\)\)/);
  assert.match(styles, /\.app-shell\.keyboard-open\s*\{[\s\S]*--mobile-bottom-nav-height: 0px;/);
  assert.match(styles, /\.app-shell\.keyboard-open \.bottom-nav\s*\{[\s\S]*pointer-events: none/);
  assert.match(layout, /window\.visualViewport/);
  assert.match(layout, /hasKeyboardTarget && !isPageZoomed && viewportDelta > 150/);
  assert.match(layout, /document\.addEventListener\("focusin", updateKeyboardState\)/);
  assert.doesNotMatch(layout, /--visual-viewport-shift-y/);
  assert.doesNotMatch(layout, /viewport\.addEventListener\("scroll", updateKeyboardState\)/);
  assert.doesNotMatch(responsive, /--visual-viewport-shift-y/);
  assert.match(layout, /viewportDelta > 150/);
  assert.match(layout, /keyboardOpen \? "keyboard-open" : ""/);
});

test("the current Focus Workspace starts its side panel closed and opens Notes from the toolbar", async () => {
  const [workspace, focusStyles] = await Promise.all([
    source("../src/pages/CatalogFocusWorkspace.jsx"),
    source("../src/pages/catalog-focus-workspace.css")
  ]);
  assert.match(workspace, /const \[openSurface, setOpenSurface\] = useState\(null\)/);
  assert.match(workspace, /const sideOpen = openSurface === "notes"/);
  assert.match(workspace, /data-workspace-tool=\{id\}/);
  assert.match(workspace, /nextTool === "note"[\s\S]*openSurface !== "notes"[\s\S]*setOpenSurface\(openingNotes \? "notes" : null\)/);
  assert.doesNotMatch(workspace, /setSideOpen|setToolOptionsOpen/);
  assert.doesNotMatch(workspace, /workspace-v2-mobile-panel/);
  assert.doesNotMatch(focusStyles, /workspace-v2-mobile-panel/);
  assert.match(focusStyles, /\.workspace-v2-side\.is-open\s*\{[^}]*transform: translateX\(0\)[^}]*pointer-events: auto/);
});

test("dashboard summary cards are full-card keyboard links to their real destinations", async () => {
  const [dashboard, statsGrid, styles] = await Promise.all([
    source("../src/pages/Dashboard.jsx"),
    source("../src/components/shared/StatsGrid.jsx"),
    source("../src/styles.css")
  ]);

  assert.match(dashboard, /className="dashboard-stats-grid"/);
  assert.match(dashboard, /id: "completed",[^\n]*to: "\/materials"/);
  assert.match(dashboard, /id: "saved",[^\n]*to: "\/bookmarks"/);
  assert.match(dashboard, /id: "reviewBank",[^\n]*to: "\/review"/);
  assert.match(dashboard, /id: "sessions",[^\n]*to: "\/security"/);
  assert.match(statsGrid, /<Link\s+className="stat-card-action"/);
  assert.match(statsGrid, /aria-label=/);
  assert.match(styles, /\.dashboard-stats-grid \.stat-card-action[\s\S]*min-height: 92px/);
  assert.match(styles, /\.dashboard-stats-grid \.stat-card-action:focus-visible/);
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
});

test("coarse-pointer scrolling avoids live glass sampling and paint-bound pulse effects", async () => {
  const [responsive, styles, statsGrid, layout] = await Promise.all([
    source("../src/responsive.css"),
    source("../src/styles.css"),
    source("../src/components/shared/StatsGrid.jsx"),
    source("../src/components/layout/index.jsx")
  ]);

  assert.match(responsive, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*\.topbar[\s\S]*\.bottom-nav[\s\S]*backdrop-filter: none !important/);
  assert.match(responsive, /\.stat-card-spotlight\s*\{\s*display: none/);
  assert.match(styles, /@keyframes pulse-dot-halo[\s\S]*transform:[\s\S]*opacity:/);
  assert.doesNotMatch(styles, /@keyframes pulse-dot-glow/);
  assert.match(statsGrid, /matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)/);
  assert.match(layout, /profilePositionFrameRef[\s\S]*requestAnimationFrame/);
  assert.match(layout, /addEventListener\("scroll", scheduleReposition, \{ capture: true, passive: true \}\)/);
});
