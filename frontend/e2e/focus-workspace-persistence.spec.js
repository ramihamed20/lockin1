import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

async function mockWorkspace(page, { userId = "persistence-student" } = {}) {
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: userId, email: `${userId}@example.test`, full_name: "Persistence Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by persistence tests" } }) });
  });
}

async function openWorkspace(page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  if (page.url().includes(ROUTE.slice(1))) await page.goto("about:blank");
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
}

function visibleInk(page) {
  return page.locator(".workspace-v2-annotation-layer [data-annotation-type='pen']:not(.workspace-v2-annotation-hit)");
}

async function drawStroke(page, pointerId, offset = 0) {
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * (0.3 + offset * 0.06);
  const send = (type, x) => stage.dispatchEvent(type, {
    pointerId, pointerType: "pen", isPrimary: true, clientX: x, clientY: y,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5,
    width: 2, height: 2, bubbles: true, cancelable: true
  });
  await send("pointerdown", bounds.x + bounds.width * 0.25);
  await send("pointermove", bounds.x + bounds.width * 0.45);
  await send("pointermove", bounds.x + bounds.width * 0.62);
  await send("pointerup", bounds.x + bounds.width * 0.62);
}

/** Reads the workspace database exactly as the browser stored it. */
async function readWorkspaceDatabase(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("lock-in-workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!database.objectStoreNames.contains("documents")) {
      database.close();
      return { documents: [], pages: [] };
    }
    const transaction = database.transaction(["documents", "pages"], "readonly");
    const readAll = (store) => new Promise((resolve, reject) => {
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const documents = await readAll("documents");
    const pages = await readAll("pages");
    database.close();
    return { documents, pages };
  });
}

test("marks are stored per page in IndexedDB and survive a reload", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);

  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page, 61, 0);
  await drawStroke(page, 62, 1);
  await expect(visibleInk(page)).toHaveCount(2);

  await expect.poll(async () => (await readWorkspaceDatabase(page)).pages.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const stored = await readWorkspaceDatabase(page);
  expect(stored.documents).toHaveLength(1);
  expect(stored.documents[0].id).toContain("user:persistence-student");
  expect(stored.documents[0].materialSlug).toBe("microbiology");
  // Ink lives in its own per-page record rather than one document-sized blob.
  expect(stored.pages).toHaveLength(1);
  expect(stored.pages[0].page).toBe(1);
  expect(stored.pages[0].annotations).toHaveLength(2);

  await openWorkspace(page);
  await expect(visibleInk(page)).toHaveCount(2);
  // A reload must never let an empty pre-hydration state overwrite the record.
  await page.waitForTimeout(1_500);
  const afterReload = await readWorkspaceDatabase(page);
  expect(afterReload.pages[0].annotations).toHaveLength(2);
});

test("two accounts on one device never see each other's marks", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page, { userId: "student-one" });
  await openWorkspace(page);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page, 71, 0);
  await expect(visibleInk(page)).toHaveCount(1);
  await expect.poll(async () => (await readWorkspaceDatabase(page)).pages.length, { timeout: 15_000 }).toBe(1);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockWorkspace(page, { userId: "student-two" });
  await openWorkspace(page);
  // The second account opens the same sheet on the same device and sees nothing.
  await expect(visibleInk(page)).toHaveCount(0);
  await page.waitForTimeout(1_200);

  const stored = await readWorkspaceDatabase(page);
  const owners = stored.documents.map((record) => record.owner).sort();
  expect(owners).toEqual(["user:student-one", "user:student-two"]);
  const firstAccountPages = stored.pages.filter((record) => record.documentId.includes("student-one"));
  expect(firstAccountPages[0].annotations).toHaveLength(1);
});

test("a legacy localStorage sheet migrates once and the old copy is removed", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("legacy-seeded")) return;
    sessionStorage.setItem("legacy-seeded", "true");
    localStorage.setItem("lock-in.catalog-workspace.v1.microbiology.sheet-1", JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      page: 1,
      zoom: 1.2,
      scrollLeft: 0,
      scrollTop: 0,
      pageOffset: 0,
      annotations: [{
        id: "legacy-stroke",
        page: 1,
        type: "pen",
        color: "#8b5cf6",
        width: 4,
        opacity: 1,
        profile: "ball",
        createdAt: "2026-01-01T00:00:00.000Z",
        points: [{ x: 120, y: 200, t: 0, p: 0.5, pointer: "pen" }, { x: 420, y: 260, t: 8, p: 0.5, pointer: "pen" }]
      }],
      notes: [{ id: "legacy-note", page: 1, body: "kept from the old store", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]
    }));
  });

  await openWorkspace(page);
  await expect(visibleInk(page)).toHaveCount(1);
  await expect(page.locator('[data-annotation-id="legacy-stroke"]').first()).toBeAttached();

  const migrated = await readWorkspaceDatabase(page);
  expect(migrated.pages[0].annotations[0].id).toBe("legacy-stroke");
  expect(migrated.documents[0].notes).toHaveLength(1);
  // The legacy key is only dropped after the migrated document reads back.
  expect(await page.evaluate(() => localStorage.getItem("lock-in.catalog-workspace.v1.microbiology.sheet-1"))).toBeNull();

  // Re-opening must not duplicate the migrated stroke.
  await openWorkspace(page);
  await expect(visibleInk(page)).toHaveCount(1);
  const reopened = await readWorkspaceDatabase(page);
  expect(reopened.pages[0].annotations).toHaveLength(1);
});

test("a backup exports, restores, and refuses to cross into another sheet unasked", async ({ page }) => {
  test.setTimeout(120_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page, 81, 0);
  await expect(visibleInk(page)).toHaveCount(1);

  await page.getByRole("button", { name: "Workspace settings" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export marks and notes/ }).click()
  ]);
  const backupPath = await download.path();
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  expect(backup.kind).toBe("lock-in.focus-workspace.backup");
  expect(backup.annotations).toHaveLength(1);
  expect(download.suggestedFilename()).toMatch(/^lock-in-microbiology-sheet-1-\d{4}-\d{2}-\d{2}\.json$/);

  // Clear the sheet, then restore it from the file.
  await page.getByRole("button", { name: /Clear ink on page/ }).click();
  await expect(visibleInk(page)).toHaveCount(0);
  await page.locator('input[accept="application/json,.json"]').setInputFiles(backupPath);
  await expect(visibleInk(page)).toHaveCount(1);
  // Restoring is an ordinary edit, so it can be undone.
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(visibleInk(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect(visibleInk(page)).toHaveCount(1);

  // Restoring the same file again adds nothing, because the ids already exist.
  await page.locator('input[accept="application/json,.json"]').setInputFiles(backupPath);
  await expect(page.locator(".workspace-v2-toast")).toContainText(/already on this sheet/i);
  await expect(visibleInk(page)).toHaveCount(1);

  // A backup belonging to another sheet needs an explicit confirmation.
  const foreign = { ...backup, document: { ...backup.document, sheetSlug: "sheet-9", sheetTitle: "Sheet 9" }, annotations: backup.annotations.map((annotation) => ({ ...annotation, id: "foreign-stroke" })) };
  await page.locator('input[accept="application/json,.json"]').setInputFiles({ name: "foreign.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
  const confirmation = page.getByRole("group", { name: "Confirm restore from another sheet" });
  await expect(confirmation).toBeVisible();
  await expect(visibleInk(page)).toHaveCount(1);
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(visibleInk(page)).toHaveCount(1);

  await page.locator('input[accept="application/json,.json"]').setInputFiles({ name: "foreign.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
  await page.getByRole("button", { name: "Restore anyway" }).click();
  await expect(visibleInk(page)).toHaveCount(2);
});

test("a malformed backup is refused without disturbing the sheet", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page, 91, 0);
  await expect(visibleInk(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Workspace settings" }).click();
  const input = page.locator('input[accept="application/json,.json"]');

  for (const [name, body] of [
    ["not-json.json", "this is not json"],
    ["wrong-kind.json", JSON.stringify({ kind: "something-else", version: 1 })],
    ["polluted.json", '{"__proto__":{"polluted":true},"kind":"lock-in.focus-workspace.backup","version":1}']
  ]) {
    await input.setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(body) });
    await expect(visibleInk(page)).toHaveCount(1);
  }
  expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
  await expect(page.getByRole("group", { name: "Confirm restore from another sheet" })).toHaveCount(0);
});
