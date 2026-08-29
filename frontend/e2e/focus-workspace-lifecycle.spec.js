import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";
const SHEET_ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1";

async function mockWorkspace(page) {
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "lifecycle-student", email: "lifecycle@example.test", full_name: "Lifecycle Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by lifecycle tests" } }) });
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

function sendPointer(stage, type, pointerId, x, y, pointerType = "pen") {
  return stage.dispatchEvent(type, {
    pointerId, pointerType, isPrimary: true, clientX: x, clientY: y,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5,
    width: pointerType === "pen" ? 2 : 9, height: pointerType === "pen" ? 2 : 9,
    bubbles: true, cancelable: true
  });
}

async function storedAnnotationCount(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("lock-in-workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!database.objectStoreNames.contains("pages")) {
      database.close();
      return 0;
    }
    const transaction = database.transaction("pages", "readonly");
    const records = await new Promise((resolve, reject) => {
      const request = transaction.objectStore("pages").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records.reduce((total, record) => total + record.annotations.length, 0);
  });
}

test("a second pointer arriving mid-stroke cannot discard the stroke in progress", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * 0.32;
  await page.getByRole("button", { name: "Pen", exact: true }).click();

  await sendPointer(stage, "pointerdown", 101, bounds.x + bounds.width * 0.25, y);
  await sendPointer(stage, "pointermove", 101, bounds.x + bounds.width * 0.4, y + 10);
  // A second stylus (or a mouse on a convertible) touches down mid-stroke.
  await sendPointer(stage, "pointerdown", 102, bounds.x + bounds.width * 0.7, y + 120, "mouse");
  await sendPointer(stage, "pointermove", 101, bounds.x + bounds.width * 0.58, y + 18);
  await sendPointer(stage, "pointerup", 102, bounds.x + bounds.width * 0.7, y + 120, "mouse");
  await sendPointer(stage, "pointerup", 101, bounds.x + bounds.width * 0.58, y + 18);

  // The original stroke survives intact and the intruder created nothing.
  await expect(visibleInk(page)).toHaveCount(1);
  await expect(page.locator(".workspace-v2-document-stage")).not.toHaveClass(/is-writing-locked/);
});

test("a stroke interrupted by a pinch is kept, and no gesture state stays stuck", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * 0.35;
  await page.getByRole("button", { name: "Pen", exact: true }).click();

  await sendPointer(stage, "pointerdown", 111, bounds.x + bounds.width * 0.3, y);
  await sendPointer(stage, "pointermove", 111, bounds.x + bounds.width * 0.45, y + 12);
  await sendPointer(stage, "pointermove", 111, bounds.x + bounds.width * 0.58, y + 4);
  // Two fingers land while the pen is still down.
  await sendPointer(stage, "pointerdown", 112, bounds.x + 120, y + 200, "touch");
  await sendPointer(stage, "pointerdown", 113, bounds.x + 320, y + 200, "touch");
  await sendPointer(stage, "pointermove", 112, bounds.x + 90, y + 210, "touch");
  await sendPointer(stage, "pointermove", 113, bounds.x + 360, y + 210, "touch");
  await sendPointer(stage, "pointerup", 112, bounds.x + 90, y + 210, "touch");
  await sendPointer(stage, "pointerup", 113, bounds.x + 360, y + 210, "touch");
  await sendPointer(stage, "pointercancel", 111, bounds.x + bounds.width * 0.58, y + 4);

  // The interrupted stroke is committed rather than thrown away.
  await expect(visibleInk(page)).toHaveCount(1);
  const layer = page.locator(".workspace-v2-a4-live-layer");
  await expect(layer).not.toHaveClass(/is-live-pinching|is-zoom-settling|is-springing-back|is-live-panning/);
  await expect(stage).not.toHaveClass(/is-writing-locked/);
  expect(await layer.evaluate((node) => node.style.transform)).toBe("");

  // The workspace still accepts a completely ordinary stroke afterwards.
  await sendPointer(stage, "pointerdown", 114, bounds.x + bounds.width * 0.3, y + 90);
  await sendPointer(stage, "pointermove", 114, bounds.x + bounds.width * 0.55, y + 96);
  await sendPointer(stage, "pointerup", 114, bounds.x + bounds.width * 0.55, y + 96);
  await expect(visibleInk(page)).toHaveCount(2);
});

test("losing the window during a stroke leaves no stuck drawing state", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * 0.3;
  await page.getByRole("button", { name: "Pen", exact: true }).click();

  await sendPointer(stage, "pointerdown", 121, bounds.x + bounds.width * 0.3, y);
  await sendPointer(stage, "pointermove", 121, bounds.x + bounds.width * 0.5, y + 14);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));

  // The partial stroke is kept and the stage is released for the next gesture.
  await expect(visibleInk(page)).toHaveCount(1);
  await expect(stage).not.toHaveClass(/is-writing-locked/);
  await sendPointer(stage, "pointerdown", 122, bounds.x + bounds.width * 0.3, y + 80);
  await sendPointer(stage, "pointermove", 122, bounds.x + bounds.width * 0.5, y + 88);
  await sendPointer(stage, "pointerup", 122, bounds.x + bounds.width * 0.5, y + 88);
  await expect(visibleInk(page)).toHaveCount(2);
});

test("leaving the workspace immediately after drawing still saves the last marks", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * 0.3;
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await sendPointer(stage, "pointerdown", 131, bounds.x + bounds.width * 0.3, y);
  await sendPointer(stage, "pointermove", 131, bounds.x + bounds.width * 0.55, y + 12);
  await sendPointer(stage, "pointerup", 131, bounds.x + bounds.width * 0.55, y + 12);
  await expect(visibleInk(page)).toHaveCount(1);

  // Leave well inside the autosave debounce window.
  await page.getByRole("button", { name: "Exit Workspace" }).click();
  await expect(page).toHaveURL(new RegExp(SHEET_ROUTE.replace(/[/#]/g, "\\$&").replace("\\#", "#")));
  await expect.poll(async () => storedAnnotationCount(page), { timeout: 15_000 }).toBe(1);

  await openWorkspace(page);
  await expect(visibleInk(page)).toHaveCount(1);
});

test("hiding the tab flushes a pending save", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * 0.4;
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await sendPointer(stage, "pointerdown", 141, bounds.x + bounds.width * 0.3, y);
  await sendPointer(stage, "pointermove", 141, bounds.x + bounds.width * 0.55, y + 12);
  await sendPointer(stage, "pointerup", 141, bounds.x + bounds.width * 0.55, y + 12);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => storedAnnotationCount(page), { timeout: 10_000 }).toBe(1);
});

test("resizing while zoomed and while a palette is open keeps the reader usable", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 900 });
  const stage = page.locator(".workspace-v2-document-stage");
  const readerScale = () => page.locator(".workspace-v2-a4-document").evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--workspace-a4-zoom")));

  await page.mouse.move(640, 450);
  await page.keyboard.down("Control");
  for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect.poll(readerScale).toBeGreaterThan(1.6);

  const pen = page.locator('[data-workspace-tool="pen"]');
  await pen.click();
  await pen.click();
  await expect(page.locator("#workspace-pen-options")).toBeVisible();

  // Rotate to landscape phone geometry with the palette open.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#workspace-pen-options")).toBeVisible();
  const optionsFit = await page.locator("#workspace-pen-options").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, bottom: bounds.bottom };
  });
  expect(optionsFit.left).toBeGreaterThanOrEqual(-1);
  expect(optionsFit.right).toBeLessThanOrEqual(845);
  expect(optionsFit.bottom).toBeLessThanOrEqual(391);

  // The reader never drops below fit width after the viewport changes.
  await expect.poll(async () => page.evaluate(() => {
    const viewport = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return pdf.width - viewport.width;
  })).toBeGreaterThan(-1.5);
  await expect(stage).toBeVisible();
});
