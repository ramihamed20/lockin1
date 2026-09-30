import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canShareFile,
  createExportHandle,
  exportBaseName,
  exportFileNameFor,
  formatFileSize,
  isAppleTouchDevice,
  shareExportFile
} from "../src/workspace/catalog/exportDelivery.js";

test("export files are named after the sheet", () => {
  assert.equal(exportFileNameFor({ title: "Vitamin -1" }), "vitamin-1-lockin.pdf");
  assert.equal(exportFileNameFor({ title: "Vitamin 1", kind: "current", page: 3 }), "vitamin-1-page-3-lockin.pdf");
  assert.equal(exportFileNameFor({ title: "Vitamin 1", kind: "range", from: 2, to: 5 }), "vitamin-1-pages-2-5-lockin.pdf");
  assert.equal(exportFileNameFor({ title: "Vitamin 1", kind: "png", page: 2, extension: "png" }), "vitamin-1-page-2-lockin.png");
  assert.equal(exportBaseName('A/B: "C"?*'), "ab-c");
  assert.equal(exportBaseName("الفيتامينات  ١"), "الفيتامينات-١");
  assert.equal(exportBaseName("   "), "sheet");
});

test("iPhone and iPad, including iPadOS posing as a Mac, take the share-sheet path", () => {
  assert.equal(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), false);
  assert.equal(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32", maxTouchPoints: 0 }), false);
});

test("a finished export owns one object URL and revokes it exactly once", () => {
  const created = [];
  const revoked = [];
  const url = { createObjectURL: (file) => { created.push(file); return "blob:export-1"; }, revokeObjectURL: (value) => revoked.push(value) };
  const handle = createExportHandle(new Blob(["%PDF-1.4"], { type: "application/pdf" }), "sheet-lockin.pdf", url);
  assert.equal(handle.file.name, "sheet-lockin.pdf");
  assert.equal(handle.file.type, "application/pdf");
  assert.equal(handle.url, "blob:export-1");
  handle.revoke();
  handle.revoke();
  assert.deepEqual(revoked, ["blob:export-1"]);
  assert.equal(handle.url, "");
  assert.equal(created.length, 1);
});

test("sharing reports a cancelled sheet without treating it as a failure", async () => {
  const file = new File(["x"], "a.pdf", { type: "application/pdf" });
  assert.equal(canShareFile(file, { share: () => {}, canShare: () => true }), true);
  assert.equal(canShareFile(file, { share: () => {} }), false);
  assert.equal(await shareExportFile(file, {}, { share: async () => {} }), "shared");
  assert.equal(await shareExportFile(file, {}, { share: async () => { throw Object.assign(new Error("cancel"), { name: "AbortError" }); } }), "cancelled");
  await assert.rejects(shareExportFile(file, {}, { share: async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); } }));
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(3.5 * 1024 * 1024), "3.5 MB");
});

test("the exporter never fetches data: URLs, which production's connect-src refuses", async () => {
  const exporter = await readFile(new URL("../src/workspace/catalog/workspaceExport.js", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(exporter, /fetch\(/);
  assert.doesNotMatch(exporter, /toDataURL/);
  assert.match(exporter, /canvas\.toBlob/);
  assert.match(exporter, /createImageBitmap/);
  // The share sheet is opened only from the ready sheet's own tap.
  assert.doesNotMatch(workspace, /navigator\.share\(/);
  assert.match(workspace, /onClick=\{shareReadyExport\}/);
});
