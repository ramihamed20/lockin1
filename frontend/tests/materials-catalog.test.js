import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MATERIAL_CATALOG, getCatalogMaterial, getCatalogSheet } from "../src/lib/materialCatalog.js";
import { canAccessRoute } from "../src/lib/authz.js";

test("Materials catalogue exposes exactly seven requested subjects with three sheets each", () => {
  assert.deepEqual(MATERIAL_CATALOG.map((material) => material.title), [
    "Conservative",
    "Microbiology",
    "Pharmacy",
    "General pathology",
    "Oral histology",
    "Fixed prosthodontic",
    "Removeable prosthodontic"
  ]);
  assert.equal(MATERIAL_CATALOG.length, 7);
  assert.ok(MATERIAL_CATALOG.every((material) => material.sheets.length === 3));
  assert.equal(getCatalogMaterial("microbiology")?.title, "Microbiology");
  assert.equal(getCatalogSheet("microbiology", "sheet-2").sheet?.title, "Microbiology — Sheet 2");
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/materials/catalog/microbiology"), true);
  assert.equal(canAccessRoute(student, "/materials/catalog/microbiology/sheets/sheet-2"), true);
  assert.equal(canAccessRoute(student, "/materials/catalog/microbiology/sheets/sheet-2/workspace"), true);
});

test("Catalog sheet restores the complete study-action group without fabricating unavailable Django actions", async () => {
  const [app, materials] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Materials.jsx", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/materials\/catalog\/:materialSlug"/);
  assert.match(app, /path="\/materials\/catalog\/:materialSlug\/sheets\/:sheetSlug"/);
  assert.match(materials, /Open Focus Workspace/);
  assert.match(materials, /Open sheet/);
  assert.match(materials, /Enter Lock In Mode/);
  assert.match(materials, /Save progress/);
  assert.match(materials, /Download/);
  assert.match(materials, /Bookmark/);
  assert.match(materials, /Discuss material/);
  assert.match(materials, /disabled aria-describedby="catalog-sheet-file-status"/);
  assert.match(materials, /sheets\/\$\{sheet\.slug\}\/workspace/);
  assert.match(materials, /returnTo: location\.pathname/);
});

test("Catalog Focus Workspace is immersive, responsive, and uses Django-backed focus actions", async () => {
  const [app, layout, workspace, styles] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/catalog-focus-workspace.css", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/materials\/catalog\/:materialSlug\/sheets\/:sheetSlug\/workspace"/);
  assert.match(layout, /location\.pathname\.endsWith\("\/workspace"\)/);
  assert.match(workspace, /focusApi\.startLockIn/);
  assert.match(workspace, /focusApi\.lockInAction/);
  assert.match(workspace, /focusApi\.updateLockInNote/);
  assert.match(workspace, /Add to Lock In Session/);
  assert.match(workspace, /beginAnnotation/);
  assert.match(workspace, /beginPan/);
  assert.match(workspace, /WorkspaceAnnotation/);
  assert.match(workspace, /requestFullscreen/);
  assert.match(workspace, /ref=\{readerRef\}/);
  assert.match(workspace, /AI tools are coming later/);
  assert.match(workspace, /workspace-quick-actions-status/);
  assert.match(workspace, /button type="button" disabled aria-describedby="workspace-quick-actions-status"/);
  assert.match(styles, /height: 100dvh/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /workspace-v2-annotation-layer\.is-interactive/);
  assert.match(styles, /workspace-v2:fullscreen/);
  assert.match(styles, /workspace-v2-body\.has-side/);
  assert.match(styles, /workspace-v2-side\.is-open/);
  assert.match(styles, /workspace-v2-mobile-panel/);
  assert.match(styles, /@media \(max-width: 560px\)/);
});
