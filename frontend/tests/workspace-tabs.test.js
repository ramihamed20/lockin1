import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { snapSplitPercent, splitPercentFromPointer, splitResizeKeyDelta } from "../src/workspace/catalog/splitSizing.js";
import { readWorkspaceSource } from "./helpers/workspaceSource.js";
import {
  closeWorkspaceTab,
  nextWhiteboardNumber,
  openWorkspaceTab,
  readWorkspaceTabs,
  sanitizeWorkspaceTabs,
  sheetTab,
  updateWorkspaceTab,
  whiteboardTab,
  workspaceTabRoute,
  writeWorkspaceTabs
} from "../src/workspace/catalog/workspaceTabs.js";

const [workspace, app, keepAliveHost, authz] = await Promise.all([
  readWorkspaceSource(),
  readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/workspace/catalog/WorkspaceKeepAlive.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/authz.js", import.meta.url), "utf8")
]);

const histology = sheetTab({ materialSlug: "histology", sheetSlug: "epithelium", title: "Epithelium" });
const anatomy = sheetTab({ materialSlug: "anatomy", sheetSlug: "upper-limb", title: "Upper limb" });
const board = whiteboardTab({ boardId: "a14a508b-d16a-4c53-bebc-a214544370e6", number: 1 });

function memoryStorage() {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
}

test("opening a tab adds it after the active one and makes it active", () => {
  let state = openWorkspaceTab({ tabs: [], activeId: "" }, histology);
  state = openWorkspaceTab(state, anatomy);
  state = openWorkspaceTab({ ...state, activeId: histology.id }, board);
  assert.deepEqual(state.tabs.map((tab) => tab.id), [histology.id, board.id, anatomy.id]);
  assert.equal(state.activeId, board.id);
  // An open sheet is selected, not duplicated, and keeps its remembered mode.
  const withMode = updateWorkspaceTab(state, anatomy.id, { mode: "normal" });
  const reopened = openWorkspaceTab(withMode, anatomy);
  assert.equal(reopened.tabs.length, 3);
  assert.equal(reopened.activeId, anatomy.id);
  assert.equal(reopened.tabs.find((tab) => tab.id === anatomy.id).mode, "normal");
});

test("closing the active tab moves to its neighbour", () => {
  const state = { tabs: [histology, board, anatomy], activeId: board.id };
  const closed = closeWorkspaceTab(state, board.id);
  assert.equal(closed.next.id, anatomy.id);
  assert.deepEqual(closed.state.tabs.map((tab) => tab.id), [histology.id, anatomy.id]);
  const last = closeWorkspaceTab({ tabs: [histology, anatomy], activeId: anatomy.id }, anatomy.id);
  assert.equal(last.next.id, histology.id);
  const background = closeWorkspaceTab(state, histology.id);
  assert.equal(background.next, null);
  assert.equal(background.state.activeId, board.id);
});

test("opening many sheets never silently closes an earlier tab", () => {
  let state = { tabs: [], activeId: "" };
  for (let index = 0; index < 20; index += 1) {
    state = openWorkspaceTab(state, sheetTab({ materialSlug: "m", sheetSlug: `sheet-${index}` }));
  }
  assert.equal(state.tabs.length, 20);
  assert.deepEqual(state.tabs.map((tab) => tab.sheetSlug), Array.from({ length: 20 }, (_, index) => `sheet-${index}`));
  assert.equal(state.activeId, sheetTab({ materialSlug: "m", sheetSlug: "sheet-19" }).id);
  // Opening an already loaded sheet selects it without creating duplicates.
  state = openWorkspaceTab(state, sheetTab({ materialSlug: "m", sheetSlug: "sheet-0" }));
  assert.equal(state.tabs.length, 20);
  assert.equal(state.activeId, sheetTab({ materialSlug: "m", sheetSlug: "sheet-0" }).id);
});

test("many open sheets survive session storage, sanitization and manual close", () => {
  const storage = memoryStorage();
  let state = { tabs: [], activeId: "" };
  for (let index = 0; index < 16; index += 1) {
    state = openWorkspaceTab(state, sheetTab({ materialSlug: "m", sheetSlug: `sheet-${index}` }));
  }
  const saved = writeWorkspaceTabs("student", state, storage);
  const restored = readWorkspaceTabs("student", storage);
  assert.equal(saved.tabs.length, 16);
  assert.equal(restored.tabs.length, 16);
  assert.equal(restored.activeId, sheetTab({ materialSlug: "m", sheetSlug: "sheet-15" }).id);
  const closed = closeWorkspaceTab(restored, sheetTab({ materialSlug: "m", sheetSlug: "sheet-3" }).id);
  assert.equal(closed.state.tabs.length, 15);
  assert.ok(closed.state.tabs.some((tab) => tab.sheetSlug === "sheet-0"));
});

test("whiteboards are numbered with the first free number", () => {
  assert.equal(nextWhiteboardNumber([]), 1);
  assert.equal(nextWhiteboardNumber([board, whiteboardTab({ boardId: "b2c3d4e5-0000-4000-8000-000000000000", number: 3 })]), 2);
});

test("stored tabs are sanitized and routes are escaped", () => {
  const clean = sanitizeWorkspaceTabs({
    tabs: [histology, histology, { kind: "sheet", materialSlug: "../x", sheetSlug: "y" }, { kind: "whiteboard", boardId: "<script>" }, board],
    activeId: "missing"
  });
  assert.deepEqual(clean.tabs.map((tab) => tab.id), [histology.id, board.id]);
  assert.equal(clean.activeId, histology.id);
  assert.equal(workspaceTabRoute(histology), "/materials/catalog/histology/sheets/epithelium/workspace");
  assert.equal(workspaceTabRoute(board), `/whiteboards/${board.boardId}/workspace`);
  const storage = memoryStorage();
  writeWorkspaceTabs("user-1", { tabs: [histology, board], activeId: board.id }, storage);
  assert.deepEqual(readWorkspaceTabs("user-1", storage).tabs.map((tab) => tab.id), [histology.id, board.id]);
  assert.deepEqual(readWorkspaceTabs("user-2", storage).tabs, []);
});

test("the workspace hosts the tab strip, whiteboards, and keeps Active Study per tab", () => {
  // Registered in App, rendered by the keep-alive host that keeps open tabs mounted.
  assert.match(app, /path="\/whiteboards\/:boardId\/workspace" element={null}/);
  assert.match(app, /<WorkspaceKeepAlive user=\{user\} Workspace=\{CatalogFocusWorkspace\} \/>/);
  assert.match(keepAliveHost, /path="\/whiteboards\/:boardId\/workspace" element={<Workspace user={user} variant="whiteboard" \/>}/);
  assert.match(authz, /\\\/whiteboards\\\/\[\^\/\]\+\\\/workspace\$/);
  assert.match(workspace, /<WorkspaceTabBar /);
  // Each sheet is its own reader, so no study mode or run leaks between tabs.
  // A new PDF version or copied-marks choice remounts the reader and its annotations.
  assert.match(workspace, /<CatalogFocusWorkspaceView key={`\$\{materialSlug\}\/\$\{sheetSlug\}\/\$\{documentScope\.view\}\/\$\{catalogDocument\.document\?\.versionId \|\| "fixture"\}\/\$\{marks\.marksSet\?\.id \|\| "own"\}`}/);
  // Leaving a tab mid Active Study keeps the run's place, like "Save" on exit.
  const hold = workspace.slice(workspace.indexOf("function holdActiveStudyPlace"), workspace.indexOf("function goToWorkspaceTab"));
  assert.match(hold, /writeActiveStudyResume\(activeStudy\.id, pageRef\.current\)/);
  assert.match(hold, /writeActiveStudyEntry\(activeEntryKey, activeStudy\)/);
  // A whiteboard grows with lined pages at its end and has no study mode.
  assert.match(workspace, /insertVirtualPage\(before, 1, id, before\.length \? before\[before\.length - 1\]\.id : null, "lined"\)/);
  // A student's own sheet has no study mode either.
  assert.match(workspace, /\{!whiteboard && !personal && <button type="button" className={`workspace-v2-study-mode-button/);
});

test("a tab kept open behind the visible one stays mounted but inert", async () => {
  const [hostSource, title, reading] = await Promise.all([
    readFile(new URL("../src/workspace/catalog/WorkspaceKeepAlive.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/usePageTitle.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useReadingSession.js", import.meta.url), "utf8")
  ]);
  // Each kept reader renders against the address it was opened at.
  assert.match(hostSource, /<Routes location=\{primary \? location : pane\.location\}>/);
  assert.match(hostSource, /inert=\{visible \? undefined : ""\}/);
  // Only the reader on screen takes shortcuts, claims the tab, names the page and counts reading.
  assert.match(workspace, /if \(!paneActive \|\| !workspaceReady\) return undefined;\r?\n    window\.addEventListener\("keydown"/);
  assert.match(workspace, /if \(!showWorkspaceTabs \|\| !paneActive\) return;/);
  assert.match(title, /if \(!active\) return;/);
  assert.match(reading, /const enabled = requested && paneActive;/);
});

test("split view provides independently mounted visible PDF panes with a draggable divider", async () => {
  const [host, bar, styles] = await Promise.all([
    readFile(new URL("../src/workspace/catalog/WorkspaceKeepAlive.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/WorkspaceTabBar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/workspace-split.css", import.meta.url), "utf8")
  ]);
  assert.match(host, /className="workspace-split-divider"/);
  assert.match(host, /setPointerCapture\(event\.pointerId\)/);
  assert.match(host, /WorkspacePaneActiveContext\.Provider value=\{focused\}/);
  assert.match(host, /aria-hidden=\{visible \? undefined : "true"\}/);
  assert.match(host, /inert=\{visible \? undefined : ""\}/);
  assert.match(bar, /startDrag\(event, tab, label\)/);
  assert.match(bar, /<WorkspaceTabDragPreview preview=\{preview\} \/>/);
  assert.match(host, /data-pane-count=\{isMulti \? liveSlots\.length : 1\}/);
  assert.match(host, /MAX_VISIBLE_WORKSPACE_SHEETS = 4/);
  assert.match(host, /workspace-split-shared-chrome/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /workspace-tab-drop-highlight/);
  const drag = await readFile(new URL("../src/workspace/catalog/WorkspaceTabDrag.jsx", import.meta.url), "utf8");
  assert.match(drag, /splitDropZone\(nextEvent\.clientX, nextEvent\.clientY\)/);
  assert.match(drag, /window\.addEventListener\("pointermove", pointer/);
});

test("split divider hides percentage controls and snaps to the nearest five percent", async () => {
  const [host, css] = await Promise.all([
    readFile(new URL("../src/workspace/catalog/WorkspaceKeepAlive.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/workspace-split.css", import.meta.url), "utf8")
  ]);
  assert.match(host, /import \{ snapSplitPercent, splitPercentFromPointer, splitResizeKeyDelta \}/);
  assert.match(host, /splitPercentFromPointer\(start, end, current, splitIsRtlColumns\(rows\)\)/);
  assert.match(host, /set\(\(value\) => snapSplitPercent\(value \+ delta\)\)/);
  assert.match(host, /aria-valuenow=\{Math\.round\(percent\)\}/);
  assert.doesNotMatch(host, /ratioMenu|SIZE_PRESETS|workspace-split-ratio-toggle|workspace-split-ratio-presets/);
  assert.doesNotMatch(css, /workspace-split-ratio-toggle|workspace-split-ratio-presets/);
  assert.match(host, /workspace-split-grip/);
});

test("split toolbar omits the redundant sheet title selector", async () => {
  const [reader, css] = await Promise.all([
    readWorkspaceSource(),
    readFile(new URL("../src/workspace/catalog/workspace-split.css", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(reader, /workspace-split-study-sheet/);
  assert.doesNotMatch(css, /workspace-split-study-sheet/);
  // The sheet tabs remain so students can still switch active documents.
  assert.match(reader, /<WorkspaceTabBar /);
});

test("split pointer resizing follows physical direction in RTL and LTR layouts", () => {
  // LTR: column 1 is the left sheet; moving right grows that sheet.
  assert.equal(splitPercentFromPointer(0, 1000, 400, false), 40);
  assert.equal(splitPercentFromPointer(0, 1000, 600, false), 60);
  // RTL: column 1 is the right sheet; moving left grows that sheet.
  assert.equal(splitPercentFromPointer(0, 1000, 600, true), 40);
  assert.equal(splitPercentFromPointer(0, 1000, 400, true), 60);
  // RTL does not reverse the vertical axis: moving down grows the top row.
  assert.equal(splitPercentFromPointer(100, 900, 420, false), 40);
  assert.equal(splitPercentFromPointer(100, 900, 580, false), 60);
  // The same direction rules apply to two-, three- and four-sheet dividers.
  assert.equal(splitPercentFromPointer(0, 1000, 476, true), 50);
  assert.equal(snapSplitPercent(52.9), 55);
  assert.equal(snapSplitPercent(48), 50);
  assert.equal(splitPercentFromPointer(0, 1000, 0, true), 80);
  assert.equal(splitPercentFromPointer(0, 1000, 1000, true), 20);
  assert.equal(splitPercentFromPointer(100, 100, 100, true), null);
  // Physical keyboard directions correspond to physical divider movement.
  assert.equal(splitResizeKeyDelta("ArrowRight", false), 5);
  assert.equal(splitResizeKeyDelta("ArrowRight", true), -5);
  assert.equal(splitResizeKeyDelta("ArrowLeft", true), 5);
  assert.equal(splitResizeKeyDelta("ArrowDown", true), 5);
  assert.equal(splitResizeKeyDelta("ArrowUp", false), -5);
  assert.equal(splitResizeKeyDelta("Escape", true), 0);
});

test("split controls work for the active tab, touch fallback and floating toolbars", async () => {
  const [bar, drag, css] = await Promise.all([
    readFile(new URL("../src/workspace/catalog/WorkspaceTabBar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/WorkspaceTabDrag.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/workspace-split.css", import.meta.url), "utf8")
  ]);
  // The student normally opens a second sheet and that sheet becomes active.
  // Dragging it must start a split rather than silently doing nothing.
  assert.match(bar, /if \(tabs\.length > 1\) startDrag\(event, tab, label\)/);
  assert.doesNotMatch(bar, /tabs\.length > 1 && !active/);
  // Safari/Pencil users have a visible tap target if a drag is cancelled.
  assert.match(bar, /className="workspace-tab-split"/);
  assert.match(bar, /dropSplit\(tab\.id, "end"\)/);
  assert.match(css, /\.workspace-tab-split \{/);
  // A movable toolbar at the bottom must not make the stage's drop zone empty.
  assert.match(drag, /dropGeometry\(x, y\)/);
  assert.match(drag, /workspace-pane\.is-active, \.workspace-pane\.is-secondary/);
  assert.doesNotMatch(drag, /toolbarBottom/);
  assert.match(drag, /y >= toolbarRect\.top && y <= toolbarRect\.bottom/);
});

test("a visible second PDF keeps rendering, while hidden tab buffers stay suspended", async () => {
  const [reader, ink, host, css] = await Promise.all([
    readFile(new URL("../src/workspace/catalog/ContinuousA4Pdf.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/ink/LiveAnnotationCanvas.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/WorkspaceKeepAlive.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/workspace-split.css", import.meta.url), "utf8")
  ]);
  assert.match(host, /WorkspacePaneVisibleContext\.Provider value=\{visible\}/);
  assert.match(reader, /useWorkspacePaneVisible/);
  assert.match(ink, /useWorkspacePaneVisible/);
  assert.doesNotMatch(css, /\.workspace-split-layout\.is-split @media/);
  assert.match(css, /\.workspace-split-layout\.is-split > \.workspace-pane\[data-split-slot="2"\]/);
  assert.match(css, /\.workspace-split-layout\.is-split > \.workspace-pane\[data-split-slot="3"\]/);
});
