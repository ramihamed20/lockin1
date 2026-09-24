import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * Laptop and desktop readers have a zoom bar that is always on screen. Phones
 * and iPads use direct pinch zoom without duplicate on-screen zoom controls.
 */

const MATERIAL = "zoom-anatomy";
const SHEET = "sheet-1";
const ROUTE = `/#/materials/catalog/${MATERIAL}/sheets/${SHEET}/workspace`;
const VERSION_ID = "7a2e3d4c-5b6a-4f9e-8d7c-2b3c4d5e6f71";
const DOCUMENT_ID = "6f1d2c3b-4a59-4e8d-9c7b-1a2b3c4d5e60";
const FILE_ID = "8b3f4e5d-6c7b-4a0f-9e8d-3c4d5e6f7082";
const pdf = readFile(new URL("./fixtures/pdf/sheet-17.pdf", import.meta.url));

async function mockReader(page) {
  await withoutServiceWorker(page);
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); } catch { /* private mode */ }
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/auth/session") {
      return json({ user: { id: "zoom-reader", email: "zoom@example.test", full_name: "Zoom Reader", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    }
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "csrf" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (pathname === "/api/v1/focus/lock-in" && request.method() === "GET") return json({ active_session: null });
    if (pathname === "/api/v1/catalog/materials") {
      const editions = [{ edition: "university", label: "University Sheet", slug: SHEET, summaryPdf: null, summaryStatus: "missing", pageCount: 17, hasActiveStudy: false, deliverable: true }];
      return json({ count: 1, results: [{ slug: MATERIAL, title: "Zoom Anatomy", sheets: [{ slug: SHEET, number: 1, title: "Sheet 1", summary: "", pageCount: 17, hasActiveStudy: false, deliverable: true, summaryPdf: null, summaryStatus: "missing", editions }] }] });
    }
    if (pathname === `/api/v1/catalog/documents/${MATERIAL}/${SHEET}`) {
      return json({ document: { id: DOCUMENT_ID, document_version_id: VERSION_ID, file_id: FILE_ID, view_url: `/api/v1/files/${FILE_ID}/view` } });
    }
    if (pathname === `/api/v1/files/${FILE_ID}/view`) return route.fulfill({ status: 200, contentType: "application/pdf", body: await pdf });
    if (pathname === `/api/v1/catalog/documents/${DOCUMENT_ID}/workspace` && request.method() === "GET") return json({ revision: 0, state: {} });
    if (pathname === `/api/v1/focus/documents/${VERSION_ID}/annotations` && request.method() === "GET") {
      return json({ collection_revision: 0, count: 0, next: null, previous: null, results: [] });
    }
    return json({ error: { code: "not_found", message: "Not used by the zoom tests" } }, 404);
  });
}

async function openReader(page) {
  await page.goto(ROUTE);
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  const chooseNormal = page.getByRole("button", { name: /Normal Study/ });
  if (await chooseNormal.isVisible().catch(() => false)) {
    await chooseNormal.click();
    await expect(chooseNormal).toBeHidden();
  }
}

const readerScale = (page) => page.locator(".workspace-v2-a4-document").evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--workspace-a4-zoom")));

async function pinchBelowFitWidth(page) {
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await stage.boundingBox();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + Math.min(bounds.height / 2, 300);
  const touch = (type, pointerId, clientX) => stage.dispatchEvent(type, {
    pointerId, pointerType: "touch", isPrimary: pointerId === 91, clientX, clientY: centerY,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5,
    width: 9, height: 9, bubbles: true, cancelable: true
  });
  await touch("pointerdown", 91, centerX - 180);
  await touch("pointerdown", 92, centerX + 180);
  await touch("pointermove", 91, centerX - 25);
  await touch("pointermove", 92, centerX + 25);
  await touch("pointerup", 91, centerX - 25);
  await touch("pointerup", 92, centerX + 25);
  await expect(page.locator(".workspace-v2-a4-live-layer")).not.toHaveClass(/is-live-pinching|is-zoom-settling|is-springing-back/);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`a ${viewport.width}px laptop reader has a zoom bar with zoom in, zoom out and reset to fit`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await mockReader(page);
    await page.setViewportSize(viewport);
    await openReader(page);

    const bar = page.getByRole("group", { name: "Zoom", exact: true });
    await expect(bar).toBeVisible();
    await expect(bar).toBeInViewport();
    const output = bar.locator("output");
    const start = await readerScale(page);

    await bar.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(() => readerScale(page)).toBeGreaterThan(start + .1);
    await expect(output).toHaveText(`${Math.round((await readerScale(page)) * 100)}%`);

    await bar.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect.poll(() => readerScale(page)).toBeLessThan(start + .1);

    // Reset returns to the zoom the reader opened at: the page width.
    await bar.getByRole("button", { name: "Zoom in", exact: true }).click();
    await bar.getByRole("button", { name: "Zoom in", exact: true }).click();
    const reset = bar.getByRole("button", { name: "Fit width", exact: true });
    await expect(reset).toHaveText("Fit");
    await reset.click();
    await expect.poll(() => readerScale(page)).toBeCloseTo(start, 1);
    await expect(bar.getByRole("button", { name: "Zoom out", exact: true })).toBeEnabled();
    await bar.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect.poll(() => readerScale(page)).toBeLessThan(start - .1);
    await reset.click();
    await expect.poll(() => readerScale(page)).toBeCloseTo(start, 1);

    // One set of zoom controls: the page dock drops its zoom row here.
    await page.locator(".workspace-v2-page-number").click();
    await expect(page.locator(".workspace-v2-page-navigator")).toBeVisible();
    await expect(page.locator(".workspace-v2-page-navigator .workspace-v2-zoom-control")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath(`zoom-bar-${viewport.width}.png`) });
  });
}

for (const device of [
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true },
  { name: "iPad portrait", viewport: { width: 820, height: 1180 }, isMobile: false },
  { name: "iPad Pro landscape", viewport: { width: 1366, height: 1024 }, isMobile: false }
]) {
  test(`the ${device.name} reader can pinch below fit without a laptop zoom bar`, async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ viewport: device.viewport, hasTouch: true, isMobile: device.isMobile });
    const page = await context.newPage();
    await mockReader(page);
    await openReader(page);
    await expect(page.locator(".workspace-v2-zoom-bar")).toBeHidden();
    const fitWidth = await readerScale(page);
    await pinchBelowFitWidth(page);
    await expect.poll(() => readerScale(page)).toBeLessThan(fitWidth - .05);
    const geometry = await page.locator(".workspace-v2-a4-live-layer").boundingBox();
    const stage = await page.locator(".workspace-v2-document-stage").boundingBox();
    expect(Math.abs(geometry.x + geometry.width / 2 - stage.x - stage.width / 2)).toBeLessThan(2);
    await page.locator(".workspace-v2-page-number").click();
    await expect(page.locator(".workspace-v2-page-navigator .workspace-v2-zoom-control")).toBeHidden();
    await expect(page.locator(".workspace-v2-page-navigator .workspace-v4-zoom-presets")).toBeHidden();
    await context.close();
  });
}
