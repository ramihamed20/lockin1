import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * Zooming keeps the page where the reader left it.
 *
 * Zoom In/Out keeps the point at the stage centre fixed, so the page stays
 * centred only if it was placed centred. Two things broke that: placing the
 * reader (opening at a remembered zoom, starting or resuming Active Study)
 * aligned a zoomed page's left edge with the stage, and in Arabic the stage
 * inherited a right-to-left scroll axis that the zoom anchor and scroll bounds
 * clamp to 0, pinning the page to its right edge. Either way every later zoom
 * kept the page off to one side.
 */

const MATERIAL = "zoom-alignment";
const SHEET = "sheet-1";
const ROUTE = `/#/materials/catalog/${MATERIAL}/sheets/${SHEET}/workspace`;
const VERSION_ID = "4d9e0f1a-2b3c-4d5e-8f60-718293a4b5c6";
const DOCUMENT_ID = "5e0f1a2b-3c4d-4e5f-9a61-8293a4b5c6d7";
const FILE_ID = "6f1a2b3c-4d5e-4f60-8b72-93a4b5c6d7e8";
const pdf = readFile(new URL("./fixtures/pdf/sheet-17.pdf", import.meta.url));

async function mockReader(page, { language = "en", horizontal = false } = {}) {
  await withoutServiceWorker(page);
  await page.addInitScript(({ locale, horizontalPages }) => {
    try {
      window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
      window.localStorage.setItem("lock-in.locale", locale);
      if (horizontalPages) window.localStorage.setItem("lock-in.catalog-workspace.settings.v1", JSON.stringify({ pageDirection: "horizontal" }));
    } catch { /* private mode */ }
  }, { locale: language, horizontalPages: horizontal });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/auth/session") {
      return json({ user: { id: "zoom-alignment-reader", email: "align@example.test", full_name: "Zoom Reader", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    }
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "csrf" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (pathname === "/api/v1/focus/lock-in" && request.method() === "GET") return json({ active_session: null });
    if (pathname === "/api/v1/catalog/materials") {
      const editions = [{ edition: "university", label: "University Sheet", slug: SHEET, summaryPdf: null, summaryStatus: "missing", pageCount: 17, hasActiveStudy: false, deliverable: true }];
      return json({ count: 1, results: [{ slug: MATERIAL, title: "Zoom Alignment", sheets: [{ slug: SHEET, number: 1, title: "Sheet 1", summary: "", pageCount: 17, hasActiveStudy: false, deliverable: true, summaryPdf: null, summaryStatus: "missing", editions }] }] });
    }
    if (pathname === `/api/v1/catalog/documents/${MATERIAL}/${SHEET}`) {
      return json({ document: { id: DOCUMENT_ID, document_version_id: VERSION_ID, file_id: FILE_ID, view_url: `/api/v1/files/${FILE_ID}/view` } });
    }
    if (pathname === `/api/v1/files/${FILE_ID}/view`) return route.fulfill({ status: 200, contentType: "application/pdf", body: await pdf });
    if (pathname === `/api/v1/catalog/documents/${DOCUMENT_ID}/workspace` && request.method() === "GET") return json({ revision: 0, state: {} });
    if (pathname === `/api/v1/focus/documents/${VERSION_ID}/annotations` && request.method() === "GET") {
      return json({ collection_revision: 0, count: 0, next: null, previous: null, results: [] });
    }
    return json({ error: { code: "not_found", message: "Not used by the zoom alignment tests" } }, 404);
  });
}

async function openReader(page) {
  await page.goto(ROUTE);
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  // The study-mode chooser's first card is Normal Study in every language.
  const chooser = page.locator(".workspace-v2-mode-dialog");
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.locator(".workspace-v2-mode-card").first().click();
    await expect(chooser).toBeHidden();
  }
}

/** The page at the stage's centre line, measured against the stage's edges. */
function pageMargins(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const bounds = stage.getBoundingClientRect();
    const pages = [...document.querySelectorAll(".workspace-v2-a4-page[data-pdf-page]")];
    const middle = bounds.top + bounds.height / 2;
    const current = pages.find((item) => { const rect = item.getBoundingClientRect(); return rect.top <= middle && rect.bottom >= middle; }) || pages[0];
    const rect = current.getBoundingClientRect();
    return { left: Math.round(rect.left - bounds.left), right: Math.round(bounds.right - rect.right), width: Math.round(rect.width), scrollLeft: Math.round(stage.scrollLeft) };
  });
}

/** Once the reader settles, the page's overflow (or margin) is the same on both sides. */
async function expectCentred(page, label) {
  await expect(page.locator(".workspace-v2-a4-live-layer")).not.toHaveClass(/is-live-pinching|is-zoom-settling|is-springing-back/);
  await expect.poll(async () => {
    const margins = await pageMargins(page);
    return Math.abs(margins.left - margins.right) <= 2 ? "centred" : `${label}: left ${margins.left}, right ${margins.right}`;
  }, { timeout: 10_000 }).toBe("centred");
}

async function zoomWithButton(page, label) {
  const before = (await pageMargins(page)).width;
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect.poll(async () => (await pageMargins(page)).width).not.toBe(before);
  await expectCentred(page, label);
}

/** A two-finger pinch at the stage centre, as on an iPad. */
async function pinch(page, from, to) {
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await stage.boundingBox();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const before = (await pageMargins(page)).width;
  const touch = (type, pointerId, clientX) => stage.dispatchEvent(type, {
    pointerId, pointerType: "touch", isPrimary: pointerId === 71, clientX, clientY: centerY,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5,
    width: 9, height: 9, bubbles: true, cancelable: true
  });
  await touch("pointerdown", 71, centerX - from);
  await touch("pointerdown", 72, centerX + from);
  for (let step = 1; step <= 6; step += 1) {
    const distance = from + ((to - from) * step) / 6;
    await touch("pointermove", 71, centerX - distance);
    await touch("pointermove", 72, centerX + distance);
  }
  await touch("pointerup", 71, centerX - to);
  await touch("pointerup", 72, centerX + to);
  await expect.poll(async () => (await pageMargins(page)).width).not.toBe(before);
  await expectCentred(page, `pinch ${from}->${to}`);
}

test("Zoom In and Zoom Out keep the page centred on desktop", async ({ page }) => {
  await mockReader(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReader(page);
  await expectCentred(page, "open");
  for (const label of ["Zoom in", "Zoom in", "Zoom out", "Zoom in", "Zoom out", "Zoom out"]) await zoomWithButton(page, label);
  // Zooming further down the sheet keeps it centred too.
  await page.locator(".workspace-v2-document-stage").evaluate((stage) => { stage.scrollTop = stage.scrollHeight * .45; });
  for (const label of ["Zoom in", "Zoom in", "Zoom out"]) await zoomWithButton(page, label);
});

for (const viewport of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }]) {
  test(`pinch zoom keeps the page centred on an iPad at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await mockReader(page);
    await page.setViewportSize(viewport);
    await openReader(page);
    await expectCentred(page, "open");
    await pinch(page, 80, 160);
    await pinch(page, 80, 130);
    await pinch(page, 160, 110);
  });
}

test("a sheet reopened at a remembered zoom opens centred, and zooming keeps it there", async ({ page }) => {
  await mockReader(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReader(page);
  await zoomWithButton(page, "Zoom in");
  const rememberedWidth = (await pageMargins(page)).width;
  // The desktop reading-width fit can still be narrower than the viewport
  // after one step; persistence must restore the exact zoomed width.
  // The zoom is remembered with the reader's view once it settles.
  await page.waitForTimeout(1_500);
  await page.reload();
  await openReader(page);
  await expect.poll(async () => (await pageMargins(page)).width).toBe(rememberedWidth);
  await expectCentred(page, "reopened");
  await zoomWithButton(page, "Zoom in");
  await zoomWithButton(page, "Zoom out");
});

test("an Arabic reader zooms centred and can still pan across a zoomed page", async ({ page }) => {
  await mockReader(page, { language: "ar" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReader(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // V2 translates the Focus controls, so the Arabic reader names them in Arabic.
  for (const label of ["تكبير", "تكبير", "تصغير"]) await zoomWithButton(page, label);
  // Increase until the page actually overflows; 120% starts narrower than
  // a desktop viewport, so a fixed number of clicks may still fit the page.
  const stage = page.locator(".workspace-v2-document-stage");
  for (let i = 0; i < 6 && (await pageMargins(page)).scrollLeft <= 0; i += 1) {
    await zoomWithButton(page, "تكبير");
  }
  // A horizontal pan reaches both edges of the zoomed page.
  const centred = (await pageMargins(page)).scrollLeft;
  expect(centred).toBeGreaterThan(0);
  await stage.evaluate((node) => { node.scrollLeft = 0; });
  await expect.poll(async () => Math.abs((await pageMargins(page)).left)).toBeLessThanOrEqual(1);
  await stage.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await expect.poll(async () => Math.abs((await pageMargins(page)).right)).toBeLessThanOrEqual(1);
});

/** A distant PDF page and its relative focal point in the vertical reader. */
async function verticalFocalPoint(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const view = stage.getBoundingClientRect();
    const x = view.left + view.width / 2;
    const y = view.top + Math.min(180, view.height / 2);
    const candidates = [...stage.querySelectorAll(".workspace-v2-a4-page[data-pdf-page]")];
    let match = null;
    let distance = Infinity;
    for (const node of candidates) {
      const rect = node.getBoundingClientRect();
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      if (dy + dx * .05 >= distance) continue;
      distance = dy + dx * .05;
      match = { key: Number(node.dataset.pdfPage), x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, width: rect.width };
    }
    return match;
  });
}

async function alignVerticalReaderToPage(page, pageNumber) {
  await page.locator(`[data-pdf-page="${pageNumber}"]`).evaluate((element) => {
    const stage = element.closest(".workspace-v2-document-stage");
    const rect = element.getBoundingClientRect();
    const view = stage.getBoundingClientRect();
    stage.scrollTop += rect.top + rect.height * .25 - (view.top + Math.min(180, view.height / 2));
  });
  await expect.poll(async () => (await verticalFocalPoint(page))?.key).toBe(pageNumber);
}

test("vertical Zoom In/Out preserves a distant page and its focal position", async ({ page }) => {
  await mockReader(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReader(page);
  await expect(page.locator(".workspace-v2-a4-document")).not.toHaveClass(/is-horizontal/);
  await alignVerticalReaderToPage(page, 7);
  const initial = await verticalFocalPoint(page);
  for (const label of ["Zoom in", "Zoom in", "Zoom out", "Zoom in", "Zoom out", "Zoom out"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(async () => (await verticalFocalPoint(page))?.key).toBe(7);
    const current = await verticalFocalPoint(page);
    expect(Math.abs(current.y - initial.y), `${label}: vertical focal drift`).toBeLessThan(0.08);
  }
});

test("vertical two-finger pinch keeps the selected PDF page under the fingers", async ({ page }) => {
  await mockReader(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await openReader(page);
  await expect(page.locator(".workspace-v2-a4-document")).not.toHaveClass(/is-horizontal/);
  await alignVerticalReaderToPage(page, 5);
  const initial = await verticalFocalPoint(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await stage.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + Math.min(180, bounds.height / 2);
  const touch = (type, id, px) => stage.dispatchEvent(type, {
    pointerId: id, pointerType: "touch", isPrimary: id === 71,
    clientX: px, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
    pressure: type === "pointerup" ? 0 : .5, width: 9, height: 9,
    bubbles: true, cancelable: true
  });
  await touch("pointerdown", 71, x - 80);
  await touch("pointerdown", 72, x + 80);
  for (let step = 1; step <= 5; step += 1) {
    const distance = 80 + step * 20;
    await touch("pointermove", 71, x - distance);
    await touch("pointermove", 72, x + distance);
  }
  await touch("pointerup", 71, x - 180);
  await touch("pointerup", 72, x + 180);
  await expect(page.locator(".workspace-v2-a4-live-layer")).not.toHaveClass(/is-live-pinching|is-zoom-settling|is-springing-back/, { timeout: 10_000 });
  await expect.poll(async () => (await verticalFocalPoint(page))?.key).toBe(5);
  const final = await verticalFocalPoint(page);
  expect(Math.abs(final.y - initial.y), "pinch focal drift").toBeLessThan(0.08);
  expect(final.width).toBeGreaterThan(initial.width);
});

test("vertical zoom begins at 120 percent, cannot zoom out further, and can zoom in", async ({ page }) => {
  await mockReader(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReader(page);
  await expect(page.locator(".workspace-v2-a4-document")).not.toHaveClass(/is-horizontal/);
  const actualScale = () => page.locator(".workspace-v2-a4-zoom-surface").evaluate(
    (node) => Number.parseFloat(node.style.getPropertyValue("--workspace-a4-zoom"))
  );
  await expect.poll(actualScale).toBeCloseTo(1.2, 3);
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  await expect(zoomOut).toBeDisabled();
  await zoomIn.click();
  await expect.poll(actualScale).toBeGreaterThan(1.2);
  await expect(zoomOut).toBeEnabled();
  await zoomOut.click();
  await expect.poll(actualScale).toBeCloseTo(1.2, 3);
  await expect(zoomOut).toBeDisabled();
});

for (const viewport of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
  test(`vertical page one starts below the floating toolbar at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await mockReader(page);
    await page.setViewportSize(viewport);
    await openReader(page);
    await expect(page.locator(".workspace-v2-a4-document")).not.toHaveClass(/is-horizontal/);
    const pageClearance = async () => page.evaluate(() => {
      const toolbar = document.querySelector(".workspace-v2-reader > .workspace-v2-toolbar");
      const stage = document.querySelector(".workspace-v2-document-stage");
      const firstPage = stage?.querySelector('[data-pdf-page="1"]');
      if (!toolbar || !stage || !firstPage) return -999;
      return firstPage.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom;
    });
    // Don't merely assert "below the toolbar": a half-viewport blank gap
    // above the page passes that test. Page one must START near the rail.
    await expect.poll(pageClearance, { timeout: 10_000 }).toBeGreaterThanOrEqual(6);
    await expect.poll(pageClearance).toBeLessThanOrEqual(35);

    // A swipe away and return must land at the same physical beginning. The
    // old document-relative minScrollTop stopped early, hiding the page title
    // behind the overlay when the reader returned from later pages.
    const stage = page.locator(".workspace-v2-document-stage");
    await stage.evaluate((node) => { node.scrollTop = node.scrollHeight * 0.25; });
    await stage.evaluate((node) => { node.scrollTop = 0; });
    await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBe(0);
    await expect.poll(pageClearance).toBeGreaterThanOrEqual(6);
    await expect.poll(pageClearance).toBeLessThanOrEqual(35);
  });
}


test("finger drag returns vertical page one to the toolbar with no rubber-band gap", async ({ page }) => {
  await mockReader(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await openReader(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const firstPage = stage.locator('[data-pdf-page="1"]');
  const clearance = async () => page.evaluate(() => {
    const toolbar = document.querySelector(".workspace-v2-reader > .workspace-v2-toolbar");
    const pageOne = document.querySelector('.workspace-v2-document-stage [data-pdf-page="1"]');
    return pageOne.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom;
  });
  await expect(firstPage).toBeVisible();
  await expect.poll(clearance).toBeGreaterThanOrEqual(6);
  await expect.poll(clearance).toBeLessThanOrEqual(35);

  // Move into the document, then drag down beyond the beginning of the
  // scrolling range. This uses the same pointer events as iPad touch panning,
  // rather than assigning scrollTop which bypasses all gesture bounds.
  await stage.evaluate((node) => { node.scrollTop = 450; });
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBeGreaterThan(400);
  const bounds = await stage.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + Math.min(300, bounds.height / 3);
  const send = (type, py) => stage.dispatchEvent(type, {
    pointerId: 91, pointerType: "touch", isPrimary: true,
    clientX: x, clientY: py, button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    pressure: type === "pointerup" ? 0 : .5, width: 9, height: 9,
    bubbles: true, cancelable: true
  });
  await send("pointerdown", y);
  for (let i = 1; i <= 8; i += 1) await send("pointermove", y + i * 85);
  await send("pointerup", y + 8 * 85);
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop), { timeout: 10_000 }).toBe(0);
  await expect.poll(clearance).toBeGreaterThanOrEqual(6);
  await expect.poll(clearance).toBeLessThanOrEqual(35);
  // An edge pull on page one must not shift the PDF with a second elastic
  // transform or leave it springing back while the page is already at start.
  await send("pointerdown", y);
  for (let i = 1; i <= 3; i += 1) await send("pointermove", y + i * 70);
  await send("pointerup", y + 3 * 70);
  await expect.poll(async () => firstPage.evaluate((node) => node.closest(".workspace-v2-a4-live-layer")?.style.transform || "")).toBe("");
  await expect.poll(clearance).toBeGreaterThanOrEqual(6);
  await expect.poll(clearance).toBeLessThanOrEqual(35);
});
