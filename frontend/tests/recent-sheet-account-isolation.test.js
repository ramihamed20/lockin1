import assert from "node:assert/strict";
import test from "node:test";
import { getLastOpenedCatalogSheet, getRecentOpenedCatalogSheets, rememberLastOpenedCatalogSheet } from "../src/lib/materialCatalog.js";

const snapshot = (title) => ({ material: { slug: "synthetic-subject", title: "Synthetic subject" }, sheet: { slug: "synthetic-sheet", title, number: 1 } });
function withStorage(run) {
  const previous = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  try { run(data); } finally { globalThis.localStorage = previous; }
}

test("opened-sheet history stays with its authenticated account across switches", () => withStorage(() => {
  rememberLastOpenedCatalogSheet("synthetic-subject", "synthetic-sheet", snapshot("Account A sheet"), "account-a");
  assert.equal(getLastOpenedCatalogSheet("account-a")?.sheet.title, "Account A sheet");
  assert.deepEqual(getRecentOpenedCatalogSheets("account-b"), []);
  rememberLastOpenedCatalogSheet("synthetic-subject", "synthetic-sheet", snapshot("Account B sheet"), "account-b");
  assert.equal(getLastOpenedCatalogSheet("account-b")?.sheet.title, "Account B sheet");
  assert.equal(getLastOpenedCatalogSheet("account-a")?.sheet.title, "Account A sheet");
}));

test("unattributed legacy history is preserved without being adopted by an account", () => withStorage(data => {
  const legacy = JSON.stringify([{ materialSlug: "synthetic-subject", sheetSlug: "synthetic-sheet", materialTitle: "Old subject", sheetTitle: "Unknown owner's sheet", sheetNumber: 1 }]);
  data.set("lock-in.materials.recent-opened-sheets", legacy);
  data.set("lock-in.materials.last-opened-sheet", JSON.stringify(JSON.parse(legacy)[0]));
  const original = [...data.entries()];
  assert.deepEqual(getRecentOpenedCatalogSheets("account-a"), []);
  assert.deepEqual(getRecentOpenedCatalogSheets(), []);
  for (const owner of [undefined, null, "", false, NaN, Infinity, {}]) {
    assert.deepEqual(getRecentOpenedCatalogSheets(owner), []);
    rememberLastOpenedCatalogSheet("synthetic-subject", "synthetic-sheet", snapshot("Anonymous"), owner);
  }
  assert.deepEqual([...data.entries()], original);
  rememberLastOpenedCatalogSheet("synthetic-subject", "synthetic-sheet", snapshot("Account A"), "account-a");
  assert.equal(data.get("lock-in.materials.recent-opened-sheets"), legacy);
  assert.equal(getLastOpenedCatalogSheet("account-a")?.sheet.title, "Account A");
}));
