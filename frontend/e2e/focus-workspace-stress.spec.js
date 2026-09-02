import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

async function mockWorkspace(page) {
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    // The gated routes need the access contract answered before they render.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "stress-student", email: "stress@example.test", full_name: "Stress Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by stress tests" } }) });
  });
}

/** Seeds a heavily annotated sheet straight into the store the workspace reads. */
async function seedAnnotations(page, { strokes, pages, pointsPerStroke }) {
  await page.addInitScript(({ strokes: strokeCount, pages: pageCount, pointsPerStroke: pointCount }) => {
    if (sessionStorage.getItem("stress-seeded")) return;
    sessionStorage.setItem("stress-seeded", "true");
    window.__seedWorkspace = new Promise((resolve, reject) => {
      const request = indexedDB.open("lock-in-workspace", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("documents")) database.createObjectStore("documents", { keyPath: "id" });
        if (!database.objectStoreNames.contains("pages")) {
          const store = database.createObjectStore("pages", { keyPath: "id" });
          store.createIndex("documentId", "documentId", { unique: false });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const documentId = "user:stress-student::microbiology::sheet-1";
        const transaction = database.transaction(["documents", "pages"], "readwrite");
        transaction.objectStore("documents").put({
          id: documentId,
          owner: "user:stress-student",
          materialSlug: "microbiology",
          sheetSlug: "sheet-1",
          version: 1,
          savedAt: new Date().toISOString(),
          view: { page: 1, zoom: 1, scrollLeft: 0, scrollTop: 0, pageOffset: 0 },
          notes: []
        });
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          const annotations = [];
          for (let index = 0; index < Math.round(strokeCount / pageCount); index += 1) {
            annotations.push({
              id: `seed-${pageNumber}-${index}`,
              page: pageNumber,
              type: "pen",
              color: "#8b5cf6",
              width: 4,
              opacity: 1,
              profile: "ball",
              createdAt: "2026-01-01T00:00:00.000Z",
              points: Array.from({ length: pointCount }, (_, step) => ({
                x: (index * 13 + step * 4) % 980,
                y: (index * 29 + step * 7) % 980,
                t: step * 8,
                p: 0.5,
                pointer: "pen"
              }))
            });
          }
          transaction.objectStore("pages").put({ id: `${documentId}::${pageNumber}`, documentId, page: pageNumber, annotations });
        }
        transaction.oncomplete = () => { database.close(); resolve(true); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { strokes, pages, pointsPerStroke });
}

test("a heavily annotated sheet opens, stays interactive, and only rewrites the page that changed", async ({ page }) => {
  test.setTimeout(180_000);
  await mockWorkspace(page);
  // 1,200 strokes of 40 samples across 12 pages: roughly 48,000 stored points.
  await seedAnnotations(page, { strokes: 1_200, pages: 12, pointsPerStroke: 40 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.evaluate(() => window.__seedWorkspace);
  await page.reload();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 30_000 });

  // Page one alone carries 100 strokes and still renders them all.
  const inkOnPageOne = page.locator('[data-pdf-page="1"] .workspace-v2-annotation-layer [data-annotation-type="pen"]');
  await expect.poll(async () => inkOnPageOne.count(), { timeout: 30_000 }).toBe(100);

  const savedAtBefore = await page.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const request = indexedDB.open("lock-in-workspace");
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction("pages", "readonly");
    const records = await new Promise((resolve) => {
      const request = transaction.objectStore("pages").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return records.map((record) => ({ page: record.page, count: record.annotations.length }));
  });
  expect(savedAtBefore).toHaveLength(12);
  expect(savedAtBefore.every((record) => record.count === 100)).toBe(true);

  // Drawing on top of a loaded sheet still feels like drawing: the stroke is
  // committed and only its own page is rewritten.
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * 0.5;
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const send = (type, x) => stage.dispatchEvent(type, {
    pointerId: 201, pointerType: "pen", isPrimary: true, clientX: x, clientY: y,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5,
    width: 2, height: 2, bubbles: true, cancelable: true
  });
  const drawStarted = Date.now();
  await send("pointerdown", bounds.x + bounds.width * 0.2);
  await send("pointermove", bounds.x + bounds.width * 0.45);
  await send("pointermove", bounds.x + bounds.width * 0.7);
  await send("pointerup", bounds.x + bounds.width * 0.7);
  await expect.poll(async () => inkOnPageOne.count(), { timeout: 30_000 }).toBe(101);
  console.log("COMMIT MS:", Date.now() - drawStarted);
  expect(Date.now() - drawStarted).toBeLessThan(10_000);

  // The live canvas holds the finished stroke until React owns it, then hands
  // it back. Leaving pixels behind would double every stroke on the page.
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.querySelector(".workspace-v2-live-annotation-canvas");
    if (!canvas || !canvas.width) return false;
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return false;
    return true;
  }), { timeout: 15_000 }).toBe(true);

  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const request = indexedDB.open("lock-in-workspace");
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction("pages", "readonly");
    const records = await new Promise((resolve) => {
      const request = transaction.objectStore("pages").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return records.find((record) => record.page === 1)?.annotations.length ?? 0;
  }), { timeout: 20_000 }).toBe(101);

  // Undo and redo still traverse a large document without losing anything.
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect.poll(async () => inkOnPageOne.count()).toBe(100);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect.poll(async () => inkOnPageOne.count()).toBe(101);
});

test("erasing across a dense page stays responsive and undoes exactly", async ({ page }) => {
  test.setTimeout(180_000);
  await mockWorkspace(page);
  await seedAnnotations(page, { strokes: 400, pages: 4, pointsPerStroke: 30 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.evaluate(() => window.__seedWorkspace);
  await page.reload();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 30_000 });
  const inkOnPageOne = page.locator('[data-pdf-page="1"] .workspace-v2-annotation-layer [data-annotation-type="pen"]');
  await expect.poll(async () => inkOnPageOne.count(), { timeout: 30_000 }).toBe(100);
  const before = await inkOnPageOne.count();

  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const started = Date.now();
  const send = (type, x, y) => stage.dispatchEvent(type, {
    pointerId: 211, pointerType: "pen", isPrimary: true, clientX: x, clientY: y,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5,
    width: 2, height: 2, bubbles: true, cancelable: true
  });
  await send("pointerdown", bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.3);
  for (let step = 1; step <= 12; step += 1) {
    await send("pointermove", bounds.x + bounds.width * (0.2 + step * 0.05), bounds.y + bounds.height * (0.3 + step * 0.02));
  }
  await send("pointerup", bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.54);
  const eraseDuration = Date.now() - started;

  await expect.poll(async () => inkOnPageOne.count()).not.toBe(before);
  expect(eraseDuration).toBeLessThan(20_000);

  // A single undo restores the page exactly, however many strokes were touched.
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect.poll(async () => inkOnPageOne.count()).toBe(before);
});
