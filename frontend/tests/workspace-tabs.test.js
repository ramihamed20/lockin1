import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_WORKSPACE_TABS,
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
  readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
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

test("a full strip drops its oldest inactive tab", () => {
  let state = { tabs: [], activeId: "" };
  for (let index = 0; index < MAX_WORKSPACE_TABS + 2; index += 1) {
    state = openWorkspaceTab(state, sheetTab({ materialSlug: "m", sheetSlug: `sheet-${index}` }));
  }
  assert.equal(state.tabs.length, MAX_WORKSPACE_TABS);
  assert.equal(state.activeId, sheetTab({ materialSlug: "m", sheetSlug: `sheet-${MAX_WORKSPACE_TABS + 1}` }).id);
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
  assert.match(workspace, /<CatalogFocusWorkspaceView key={`\$\{materialSlug\}\/\$\{sheetSlug\}\/\$\{documentScope\.view\}`}/);
  // Leaving a tab mid Active Study keeps the run's place, like "Save" on exit.
  const hold = workspace.slice(workspace.indexOf("function holdActiveStudyPlace"), workspace.indexOf("function goToWorkspaceTab"));
  assert.match(hold, /writeActiveStudyResume\(activeStudy\.id, pageRef\.current\)/);
  assert.match(hold, /writeActiveStudyEntry\(activeEntryKey, activeStudy\.difficulty\)/);
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
  assert.match(hostSource, /<Routes location=\{active \? location : pane\.location\}>/);
  assert.match(hostSource, /inert=\{active \? undefined : ""\}/);
  // Only the reader on screen takes shortcuts, claims the tab, names the page and counts reading.
  assert.match(workspace, /if \(!paneActive\) return undefined;\r?\n    window\.addEventListener\("keydown"/);
  assert.match(workspace, /if \(!showWorkspaceTabs \|\| !paneActive\) return;/);
  assert.match(title, /if \(!active\) return;/);
  assert.match(reading, /const enabled = requested && paneActive;/);
});
