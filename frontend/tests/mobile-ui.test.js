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
  assert.match(styles, /@supports \(height: 100lvh\)[\s\S]*--app-viewport-height: 100lvh/);
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
  assert.match(responsive, /--mobile-bottom-nav-height: calc\(58px \+ var\(--safe-bottom\)\)/);
  assert.match(responsive, /\.bottom-nav a,[\s\S]*min-height: 48px;[\s\S]*grid-template-rows: 20px minmax\(0, 1fr\);/);
  assert.match(responsive, /\.bottom-nav a span,[\s\S]*inline-size: 100%;[\s\S]*text-overflow: ellipsis;/);
  assert.match(styles, /\.app-shell\.keyboard-open\s*\{[\s\S]*--mobile-bottom-nav-height: 0px;/);
  assert.match(styles, /\.app-shell\.keyboard-open \.bottom-nav\s*\{[\s\S]*pointer-events: none/);
  // The shell consumes the keyboard reading rather than measuring it. One
  // module owns `visualViewport` for the whole application; a second listener
  // here is how the two disagreed about whether a keyboard was up.
  assert.match(layout, /subscribeViewport\(\({ keyboardOpen: open }\) => setKeyboardOpen\(open\)\)/);
  assert.doesNotMatch(layout, /window\.visualViewport/);
  assert.doesNotMatch(layout, /--visual-viewport-shift-y/);
  assert.doesNotMatch(responsive, /--visual-viewport-shift-y/);
  assert.match(layout, /keyboardOpen \? "keyboard-open" : ""/);
});

test("the document, the shell and the opening frame share one height authority", async () => {
  const [styles, startup, layers] = await Promise.all([
    source("../src/styles.css"),
    source("../public/startup.css"),
    source("../src/styles/layers.css")
  ]);

  // The defect. `min-height: 100%` on `html` resolves against the initial
  // containing block, which iOS Safari sizes to the viewport with its browser
  // chrome retracted, so the document stayed taller than the shell by exactly
  // the height of that chrome and carried a strip of empty scroll.
  // Read against the declarations alone: the comment on the rule names the
  // shape it replaced.
  // Normalise line endings before slicing. The end marker spans a newline, so
  // on a CRLF checkout indexOf misses, the slice runs to the end of the file,
  // and the rule below matches an unrelated declaration.
  const css = styles.replace(/\r\n/g, "\n");
  const htmlRule = css
    .slice(css.indexOf("\nhtml {"), css.indexOf("\nbody,\n#root"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(htmlRule, /min-block-size: var\(--app-viewport-height\)/);
  assert.doesNotMatch(htmlRule, /min-height: 100%/);

  // The opening frame is parsed before the application and would otherwise
  // outrank it: an unlayered rule beats every layered one.
  assert.match(startup, /^\/\*[\s\S]*?\*\/\s*@layer startup \{/);
  assert.match(startup, /html,\s*body,\s*#root \{[\s\S]*min-block-size: 100lvh/);
  assert.doesNotMatch(startup, /html,\s*body,\s*#root \{[\s\S]*min-block-size: 100%/);
  assert.match(layers, /@layer startup, primitives, app, interaction;/);
});

test("one module owns a stable application viewport and observes keyboard occlusion", async () => {
  const [viewport, workspace, main] = await Promise.all([
    source("../src/lib/viewport.js"),
    source("../src/pages/CatalogFocusWorkspace.jsx"),
    source("../src/main.jsx")
  ]);

  // Installed before the first render, so the keyboard token has a value on the
  // first painted frame.
  assert.match(main, /import \{ installViewportSync \} from "\.\/lib\/viewport\.js"/);
  assert.match(main, /installViewportSync\(\);/);

  // A large-viewport ruler owns the shell. VisualViewport is compared against
  // that stable frame only to recognise keyboard occlusion.
  assert.match(viewport, /height:\$\{supportsLargeViewport \? "100lvh" : "100vh"\}/);
  assert.match(viewport, /baselineHeight - visualHeight - visualOffsetTop/);
  assert.match(viewport, /occludedHeight >= KEYBOARD_MIN_INSET/);
  assert.match(viewport, /const KEYBOARD_MIN_INSET = 120/);
  assert.match(viewport, /--app-viewport-height/);
  assert.match(viewport, /--keyboard-inset/);

  // Stabilization is event-driven, coalesced into animation frames, and never
  // writes the document's scroll position or guesses with a timeout.
  const viewportCode = viewport.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(viewportCode, /addEventListener\("pageshow", update/);
  assert.match(viewportCode, /addEventListener\("visibilitychange", handleVisibilityChange/);
  assert.match(viewportCode, /requestAnimationFrame\(apply\)/);
  assert.doesNotMatch(viewportCode, /scrollTo|scrollBy/);
  assert.doesNotMatch(viewportCode, /setTimeout/);

  // The workspace consumes the shared reading instead of listening itself.
  assert.match(workspace, /subscribeViewport\(\({ keyboardOpen, keyboardInset }\)/);
  assert.doesNotMatch(workspace, /window\.visualViewport\?\.height \|\| window\.innerHeight/);
});

test("the mobile drawer omits Search and distinguishes tap drift from an intentional swipe", async () => {
  const layout = await source("../src/components/layout/index.jsx");

  assert.doesNotMatch(layout, /primaryItems\s*=\s*\[[\s\S]*path:\s*"\/search"/);
  assert.match(layout, /drawerSwipeActivationDistance\s*=\s*18/);
  assert.match(layout, /Math\.max\(horizontal, vertical\) < drawerSwipeActivationDistance/);
});

test("the production Focus workspace is server-backed and keeps its responsive shell", async () => {
  const [workspace, focusStyles] = await Promise.all([
    source("../src/pages/LockInMode.jsx"),
    source("../src/pages/catalog-focus-workspace.css")
  ]);
  assert.match(workspace, /focusApi\.getAnnotations/);
  assert.match(workspace, /focusApi\.syncAnnotations/);
  assert.match(workspace, /focusApi\.getLockInSession/);
  assert.match(workspace, /preselectedDocumentVersionId/);
  assert.match(workspace, /className=\{`lockin-reference-workspace/);
  assert.doesNotMatch(focusStyles, /workspace-v2-mobile-panel/);
  assert.match(focusStyles, /safe-area-inset-bottom/);
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
  assert.match(styles, /@media \(hover: hover\) and \(pointer: fine\)/);
  // The keyboard focus ring is centralised in styles/interaction.css.
  // Per-component rings are what produced stacked focus indicators.
  assert.doesNotMatch(styles, /\.dashboard-stats-grid \.stat-card-action:focus-visible/);
});

test("dashboard continue and recent sheets share actual opened-sheet history", async () => {
  const [dashboard, catalogue] = await Promise.all([
    source("../src/pages/Dashboard.jsx"),
    source("../src/lib/i18n.js")
  ]);

  assert.match(dashboard, /const recentOpenedSheets = getRecentOpenedCatalogSheets\(\)/);
  assert.match(dashboard, /<ContinueCard sheetEntry=\{recentOpenedSheets\[0\] \|\| null\}/);
  assert.match(dashboard, /const visibleSheets = sheetEntries\.slice\(0, 4\)/);
  assert.match(dashboard, /to=\{sheetEntry\.path\}/);
  assert.match(dashboard, /to=\{path\}/);
  assert.doesNotMatch(dashboard, /next_item|recent_content|recentMaterials/);
  assert.match(catalogue, /"dashboard\.recentSheets": "Recent Sheets"/);
  assert.doesNotMatch(catalogue, /Recently published materials/);
});

test("sidebar omits Account while profile remains available from account surfaces", async () => {
  const [constants, layout] = await Promise.all([
    source("../src/lib/constants.js"),
    source("../src/components/layout/index.jsx")
  ]);
  const navConfiguration = constants.slice(constants.indexOf("export const navItems"), constants.indexOf("export const quotes"));

  assert.doesNotMatch(navConfiguration, /path:\s*"\/(?:account|profile)"|label:\s*"Account"/);
  assert.doesNotMatch(layout, /common\.account|accountItems|account-menu-section-label/);
  assert.match(layout, /className="drawer-profile-action" to="\/profile"/);
  assert.match(layout, /<Link to="\/profile" role=\{isPhone/);
});

test("the dashboard uses compact responsive cards and a contained cat illustration", async () => {
  const styles = await source("../src/styles.css");

  assert.match(styles, /\.dashboard-main\s*\{[\s\S]*grid-template-columns: minmax\(280px, 0\.82fr\) minmax\(360px, 1\.3fr\)/);
  assert.match(styles, /\.dashboard-left \.continue-card\s*\{[\s\S]*height: 184px;[\s\S]*padding: 16px 18px;/);
  assert.match(styles, /\.dashboard-left \.dashboard-recent-sheets\s*\{[\s\S]*height: auto;[\s\S]*flex: 0 0 auto;/);
  assert.match(styles, /\.dashboard-recent-sheets \.dashboard-review-item\s*\{[\s\S]*min-height: 44px;/);
  assert.match(styles, /\.dashboard-right \.scene-card\s*\{[\s\S]*width: min\(100%, 500px\);[\s\S]*aspect-ratio: 1;/);
  assert.match(styles, /\.scene-card > picture\s*\{[\s\S]*inline-size: 100%;[\s\S]*block-size: 100%;/);
  assert.match(styles, /\.dashboard-right \.scene-card \.scene-theme\s*\{\s*object-fit: contain;/);
  assert.match(styles, /@media \(max-width: 639px\)[\s\S]*\.dashboard-right \.scene-card\s*\{[\s\S]*width: min\(82vw, 310px\)/);
  assert.match(styles, /@media \(max-width: 639px\)[\s\S]*\.dashboard-left \.continue-card\s*\{[\s\S]*height: 164px/);
  assert.match(styles, /@media \(min-width: 640px\) and \(max-width: 900px\)[\s\S]*\.dashboard-right \.scene-card\s*\{[\s\S]*width: min\(62vw, 420px\)/);
  assert.match(styles, /@media \(min-width: 901px\) and \(max-width: 1199px\) and \(min-height: 560px\)[\s\S]*width: min\(100%, 460px\)/);
  assert.match(styles, /@media \(max-height: 559px\)[\s\S]*width: min\(46vw, 300px\)/);
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
  assert.match(styles, /\.topbar \.profile-menu-wrap\s*\{\s*inline-size: 44px[\s\S]*flex: 0 0 44px/);
  assert.match(styles, /\.topbar \.profile-menu-wrap \.avatar-btn \.user-avatar\s*\{\s*inline-size: 42px[\s\S]*block-size: 42px/);
});
