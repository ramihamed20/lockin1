import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLimits, parsePersonalSheet } from "../src/api/personalSheets.js";
import { canAccessRoute } from "../src/lib/authz.js";
import { forgetPersonalTabs, openWorkspaceTab, personalTab, readWorkspaceTabs, sanitizeWorkspaceTabs, sheetTab, workspaceTabRoute, writeWorkspaceTabs } from "../src/workspace/catalog/workspaceTabs.js";

const student = { id: "student-1", role: "student" };

const [workspace, app, keepAliveHost, materials, component] = await Promise.all([
  readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/workspace/catalog/WorkspaceKeepAlive.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Materials.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/learning/PersonalSheets.jsx", import.meta.url), "utf8")
]);

const SHEET_ID = "0f8c2f1e-6a7b-4c1d-9e2f-3a4b5c6d7e8f";

test("a personal sheet is read only from a same-origin managed-file view", () => {
  const sheet = parsePersonalSheet({
    id: SHEET_ID,
    title: "Skull notes",
    page_count: 12,
    size_bytes: 2_500_000,
    created_at: "2026-10-07T10:00:00+00:00",
    status: "ready",
    view_url: `/api/v1/files/${SHEET_ID}/view`,
    active_study: { status: "unavailable" }
  });
  assert.equal(sheet?.viewUrl, `/api/v1/files/${SHEET_ID}/view`);
  assert.equal(sheet?.pageCount, 12);
  assert.deepEqual(sheet?.activeStudy, { status: "unavailable" });

  const foreign = parsePersonalSheet({ id: SHEET_ID, title: "x", status: "ready", view_url: "https://evil.example/file.pdf" });
  assert.equal(foreign?.viewUrl, "");
  assert.equal(foreign?.status, "unavailable");

  const processing = parsePersonalSheet({ id: SHEET_ID, title: "x", status: "processing", view_url: null });
  assert.equal(processing?.status, "processing");
  assert.equal(parsePersonalSheet({ id: "not-a-uuid" }), null);
});

test("limits fall back to the trial allowance", () => {
  assert.deepEqual(parseLimits({ max_sheets: 20, max_file_bytes: 20 * 1024 * 1024, used: 3, remaining: 17 }), {
    maxSheets: 20, maxFileBytes: 20 * 1024 * 1024, used: 3, remaining: 17
  });
  assert.equal(parseLimits(null).maxSheets, 20);
  assert.equal(parseLimits(null).remaining, 20);
});

test("both personal routes are registered and allowed for a signed-in student", () => {
  assert.match(app, /path="\/materials\/catalog\/:materialSlug\/mine" element={<PersonalSheetsPage user={user} \/>}/);
  // Registered in App, rendered by the keep-alive host that keeps open tabs mounted.
  assert.match(app, /path="\/materials\/catalog\/:materialSlug\/mine\/:sheetId\/workspace" element={null}/);
  assert.match(keepAliveHost, /path="\/materials\/catalog\/:materialSlug\/mine\/:sheetId\/workspace" element={<Workspace user={user} variant="personal" \/>}/);
  assert.equal(canAccessRoute(student, "/materials/catalog/year-2-anatomy/mine"), true);
  assert.equal(canAccessRoute(student, `/materials/catalog/year-2-anatomy/mine/${SHEET_ID}/workspace`), true);
  assert.equal(canAccessRoute(student, "/materials/catalog/year-2-anatomy/mine/not-an-id/workspace"), false);
});

test("every subject shows the branch, even before anything is published", () => {
  const sheetsPage = materials.slice(materials.indexOf("export function CatalogMaterialSheets"), materials.indexOf("export function CatalogSheetStudy"));
  assert.match(sheetsPage, /<PersonalSheetsBranch material={material} user={user} \/>/);
  assert.doesNotMatch(sheetsPage, /if \(!material\.sheets\.length\) \{\s*return/);
});

test("a personal sheet opens in Focus without Active Study or reading credit, with the tab strip", () => {
  assert.match(workspace, /if \(variant === "personal"\) return <PersonalSheetWorkspace user={user} \/>;/);
  assert.match(workspace, /hasActiveStudy: false/);
  assert.match(workspace, /useReadingSession\(catalogDocument\?\.versionId \|\| "", \{ enabled: !summaryMode && !whiteboard && !personal \}\)/);
  assert.match(workspace, /const showWorkspaceTabs = !summaryMode && Boolean\(sheet\);/);
  assert.match(workspace, /!whiteboard && !summaryMode && !personal\) rememberLastOpenedCatalogSheet|!summaryMode && !whiteboard && !personal\) rememberLastOpenedCatalogSheet/);
  assert.match(workspace, /personalBackTo={`\/materials\/catalog\/\$\{subjectSlug\}\/mine`}/);
});

test("deleting asks first and the add dialog checks size and type before uploading", () => {
  assert.match(component, /<ConfirmDialog/);
  assert.doesNotMatch(component, /window\.confirm/);
  const inspect = component.slice(component.indexOf("function inspectFile"), component.indexOf("function AddPersonalSheetDialog"));
  assert.match(inspect, /if \(!isPdf\(file\)\)/);
  assert.match(inspect, /file\.size > maxBytes/);
  // A dropped file goes through the same check as a chosen one.
  assert.match(component, /useState\(\(\) => inspectFile\(initialFile, maxBytes, t\)\)/);
  assert.match(component, /role="checkbox" aria-checked={selected}/);
});

test("a list from another device's session never undoes a change made here", () => {
  const hook = component.slice(component.indexOf("export function usePersonalSheets"), component.indexOf("function megabytes"));
  // Coming back to the window asks for the list again, at most once per return.
  assert.match(hook, /document\.addEventListener\("visibilitychange", refresh\)/);
  assert.match(hook, /window\.addEventListener\("focus", refresh\)/);
  assert.match(hook, /Date\.now\(\) - lastRefresh\.current < RETURN_REFRESH_GAP_MS/);
  // A response requested before a local add or delete is dropped.
  assert.match(hook, /if \(mutations\.current !== mutationsAtStart\) return;/);
  assert.match(hook, /mutations\.current \+= 1;/);
});

test("the delete message reports what the server deleted, not what was ticked", () => {
  const remove = component.slice(component.indexOf("async function confirmDelete"), component.indexOf("return (", component.indexOf("async function confirmDelete")));
  assert.match(remove, /const ids = selectedIds;/);
  assert.match(remove, /if \(result\.deleted > 0\) setAnnouncement\(t\("personalSheets\.deleted", \{ count: result\.deleted \}\)\);/);
  assert.match(remove, /if \(result\.deleted < ids\.length\) data\.reload\(\);/);
  assert.match(component, /const selectedIds = sheets\.filter\(\(sheet\) => selected\.has\(sheet\.id\)\)/);
});

test("an own sheet's marks and reader state sync through its own routes", async () => {
  const [api, focusSync] = await Promise.all([
    readFile(new URL("../src/api/personalSheets.js", import.meta.url), "utf8"),
    readFile(new URL("../src/offline/focusSync.js", import.meta.url), "utf8")
  ]);
  // The reader treats the sheet as its synced document, keyed by its own id.
  assert.match(workspace, /\{ id: sheet\.id, versionId: sheet\.id, viewUrl: sheet\.viewUrl, checksum: "" \}/);
  assert.match(workspace, /catalogDocument={syncedDocument} documentScope={PERSONAL_SCOPE}/);
  assert.match(workspace, /\.\.\.\(personal \? \{ catalog: personalWorkspaceApi \} : \{\}\)/);
  assert.match(workspace, /kind: personal \? "personal" : "catalog"/);
  // Reading credit stays off even though a document is now synced.
  assert.match(workspace, /enabled: !summaryMode && !whiteboard && !personal/);
  assert.match(api, /`\/personal-sheets\/\$\{encodeURIComponent\(sheetId\)\}\/workspace\?probe=1`/);
  // Offline work on an own sheet replays against the same routes.
  assert.match(focusSync, /descriptor\.kind === "personal" \? personalWorkspaceApi : catalogWorkspaceApi/);
  // Deleting a sheet forgets its queued sync and this device's copy.
  assert.match(component, /forgetFocusDocuments\(user, ids\.map/);
  assert.match(focusSync, /await store\.deleteDocument\(\{ owner, materialSlug: item\.materialSlug, sheetSlug: item\.sheetSlug \}\)/);
});

test("an own sheet is a tab of its own that opens its own route and survives sanitizing", () => {
  const tab = personalTab({ materialSlug: "year-2-anatomy", personalId: SHEET_ID, title: "Skull notes" });
  assert.equal(workspaceTabRoute(tab), `/materials/catalog/year-2-anatomy/mine/${SHEET_ID}/workspace`);
  assert.equal(canAccessRoute(student, workspaceTabRoute(tab)), true);
  const catalog = sheetTab({ materialSlug: "histology", sheetSlug: "epithelium", title: "Epithelium" });
  const state = openWorkspaceTab(openWorkspaceTab({ tabs: [], activeId: "" }, catalog), tab);
  assert.deepEqual(state.tabs.map((item) => item.kind), ["sheet", "personal"]);
  const clean = sanitizeWorkspaceTabs({ tabs: [tab, { kind: "personal", materialSlug: "a", personalId: "../x" }], activeId: tab.id });
  assert.deepEqual(clean.tabs.map((item) => item.id), [tab.id]);
  // Renaming is not offered, but the title follows the sheet when it is reopened.
  assert.equal(openWorkspaceTab(state, { ...tab, title: "Renamed" }).tabs[1].title, "Renamed");
});

test("deleting a sheet closes its tab wherever it was open", () => {
  const items = new Map();
  const storage = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
  const tab = personalTab({ materialSlug: "year-2-anatomy", personalId: SHEET_ID, title: "Skull notes" });
  const catalog = sheetTab({ materialSlug: "histology", sheetSlug: "epithelium", title: "Epithelium" });
  writeWorkspaceTabs("user:1", { tabs: [catalog, tab], activeId: tab.id }, storage);
  const after = forgetPersonalTabs("user:1", [SHEET_ID], storage);
  assert.deepEqual(after.tabs.map((item) => item.id), [catalog.id]);
  assert.equal(after.activeId, catalog.id);
  assert.deepEqual(readWorkspaceTabs("user:1", storage).tabs.map((item) => item.id), [catalog.id]);
  assert.deepEqual(forgetPersonalTabs("user:2", [SHEET_ID], storage).tabs, []);
});

test("another sheet is chosen subject first, then sheet, with no search box", async () => {
  const [bar, css] = await Promise.all([
    readFile(new URL("../src/workspace/catalog/WorkspaceTabBar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/focus-workspace-glass.css", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(bar, /type="search"|searchSheets|workspace-tabs-search/);
  assert.doesNotMatch(css, /workspace-tabs-search/);
  assert.match(bar, /data-step={subject \? "sheets" : "subjects"}/);
  assert.match(bar, /onClick={\(\) => setSubject\(material\)}/);
  // The student's own sheets of the chosen subject sit beside the published ones.
  assert.match(bar, /personalSheetsApi\.list\(subject\.slug, \{ signal: controller\.signal \}\)/);
  // The personal reader hands the bar every subject, not just its own sheet.
  assert.match(workspace, /tabMaterials={catalogMaterials}/);
  assert.match(workspace, /personalSubject={subjectSlug}/);
  assert.match(workspace, /choice\.kind === "personal" \? personalTab\(choice\) : sheetTab\(choice\)/);
  assert.match(component, /forgetPersonalTabs\(ownerStorageKey\(user\), ids\)/);
});
