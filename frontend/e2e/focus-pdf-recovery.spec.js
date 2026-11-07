import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

test.use({ hasTouch: true });

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function mockWorkspace(page) {
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    // The gated routes need the access contract answered before they render.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "pdf-student", email: "pdf@example.test", full_name: "PDF Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by PDF tests" } }) });
  });
}

test("returning from another app repaints reclaimed PDF bitmaps without reloading the sheet", async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  const front = page.locator('[data-pdf-page="1"] .workspace-v2-a4-canvas.is-visible');
  await expect.poll(() => front.evaluate((canvas) => canvas.width), { timeout: 20_000 }).toBeGreaterThan(0);
  const originalSize = await front.evaluate((canvas) => [canvas.width, canvas.height]);
  const stage = page.locator(".workspace-v2-document-stage");
  await stage.evaluate((node) => { node.scrollTop = 120; });
  await expect.poll(() => stage.evaluate((node) => node.scrollTop)).toBe(120);
  const originalScroll = await stage.evaluate((node) => [node.scrollLeft, node.scrollTop]);
  let pdfRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith(".pdf")) pdfRequests++; });

  // Safari may reclaim backing pixels while a music/video app has the screen.
  // Keep the canvas dimensions: checking width alone cannot detect this loss.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    const canvas = document.querySelector('[data-pdf-page="1"] .workspace-v2-a4-canvas.is-visible');
    const context = canvas.getContext("2d");
    context.fillStyle = "#ff00ff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  });

  // Repeated lifecycle notifications must not leave rendering suspended.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => front.evaluate((canvas) => {
    if (!canvas.width || !canvas.height) return false;
    const pixel = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
    return pixel[0] !== 255 || pixel[1] !== 0 || pixel[2] !== 255;
  }), { timeout: 6_000 }).toBe(true);
  expect(await front.evaluate((canvas) => [canvas.width, canvas.height])).toEqual(originalSize);
  const restoredScroll = await stage.evaluate((node) => [node.scrollLeft, node.scrollTop]);
  expect(Math.abs(restoredScroll[0] - originalScroll[0])).toBeLessThanOrEqual(1);
  expect(Math.abs(restoredScroll[1] - originalScroll[1])).toBeLessThanOrEqual(1);
  expect(pdfRequests).toBe(0);
  await expect(page.locator(".workspace-v2-a4-status[role='alert']")).toHaveCount(0);
});

test("backgrounding releases PDF raster memory and restores the same reading position", async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  const front = page.locator('[data-pdf-page="1"] .workspace-v2-a4-canvas.is-visible');
  await expect.poll(() => front.evaluate((canvas) => canvas.width), { timeout: 20_000 }).toBeGreaterThan(0);
  const stage = page.locator(".workspace-v2-document-stage");
  await stage.evaluate((node) => { node.scrollTop = 120; });
  await expect.poll(() => stage.evaluate((node) => node.scrollTop)).toBe(120);
  const rasterPixels = () => page.locator(".workspace-v2-a4-canvas, .workspace-v2-a4-detail-canvas")
    .evaluateAll((canvases) => canvases.reduce((total, canvas) => total + canvas.width * canvas.height, 0));
  expect(await rasterPixels()).toBeGreaterThan(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(rasterPixels).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => front.evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
  expect(await stage.evaluate((node) => node.scrollTop)).toBe(120);
  await expect(page.getByRole("button", { name: "Retry page 1", exact: true })).toHaveCount(0);
});

for (const failure of ["unavailable", "lost"]) test(`a ${failure} foreground canvas offers a page retry without reloading the PDF`, async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize(failure === "unavailable" ? { width: 390, height: 844 } : { width: 834, height: 1194 });
  await page.addInitScript(({ failure }) => {
    window.__denyPdfCanvas = true;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (window.__denyPdfCanvas && kind === "2d" && this.matches(".workspace-v2-a4-canvas")
        && this.closest('[data-pdf-page="1"]')) {
        if (failure === "unavailable") return null;
        const context = original.call(this, kind, ...args);
        context.isContextLost = () => window.__denyPdfCanvas;
        return context;
      }
      return original.call(this, kind, ...args);
    };
  }, { failure });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  const retry = page.getByRole("button", { name: "Retry page 1", exact: true });
  await expect(retry).toBeVisible();
  // An unavailable canvas on one page cannot strand the shared render queue.
  await expect.poll(() => page.locator('[data-pdf-page="2"] .workspace-v2-a4-canvas.is-visible')
    .evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
  let pdfRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith(".pdf")) pdfRequests++; });
  await page.evaluate(() => { window.__denyPdfCanvas = false; });
  await retry.tap();
  await expect.poll(() => page.locator('[data-pdf-page="1"] .workspace-v2-a4-canvas.is-visible')
    .evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
  await expect(retry).toHaveCount(0);
  expect(pdfRequests).toBe(0);
});

test("a PDF that fails to load explains itself and retries without duplicating render work", async ({ page }) => {
  test.setTimeout(90_000);
  let failDownload = true;
  await mockWorkspace(page);
  // The service worker fetches assets on the page's behalf, and those requests
  // only reach a context-level route.
  await page.context().route("**/*.pdf", async (route) => {
    if (failDownload) {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();

  // The reader is told what happened rather than left with a blank sheet.
  const failure = page.locator(".workspace-v2-a4-status[role='alert']");
  await expect(failure).toBeVisible({ timeout: 20_000 });
  const retry = page.getByRole("button", { name: "Retry PDF" });
  await expect(retry).toBeVisible();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible();
  expect(await page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width)).toBe(0);

  failDownload = false;
  await retry.click();
  await expect.poll(
    async () => page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width > 0),
    { timeout: 25_000 }
  ).toBe(true);
  await expect(failure).toHaveCount(0);

  // The retry replaced the page's queued job rather than stacking another one:
  // each page still owns exactly its front and back buffer.
  const canvasesOnFirstPage = await page.locator('[data-pdf-page="1"] canvas.workspace-v2-a4-canvas').count();
  expect(canvasesOnFirstPage).toBe(2);
  const backedCanvases = await page.evaluate(() => [...document.querySelectorAll(".workspace-v2-a4-canvas")].filter((canvas) => canvas.width > 0).length);
  expect(backedCanvases).toBeGreaterThan(0);
  expect(backedCanvases).toBeLessThanOrEqual(8);
});

test("a PDF that never arrives still offers a way forward", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  // The request hangs: no response, no error. Without a notice the reader would
  // watch a spinner forever.
  await page.context().route("**/*.pdf", () => {});
  await page.addInitScript(() => {
    const originalSetTimeout = window.setTimeout;
    // Collapse only the slow-load notice so the test does not wait 15 seconds.
    window.setTimeout = function patchedSetTimeout(handler, delay, ...rest) {
      return originalSetTimeout(handler, delay === 15_000 ? 400 : delay, ...rest);
    };
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.getByText("This PDF is taking longer than usual.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Retry PDF" })).toBeVisible();
});
