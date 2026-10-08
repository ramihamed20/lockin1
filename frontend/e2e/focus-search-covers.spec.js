import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * Searching inside the open PDF, and hiding parts of a page to recall them:
 * covers drawn over an area, covers laid over every search match, revealing
 * them with a tap, undoing them, and keeping them across a reload.
 */

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function mockWorkspace(page, { language = "en" } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (pathname === "/api/v1/auth/session") return json({ user: { id: "search-student", email: "search@example.test", full_name: "Search Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") return json({ active_session: null });
    return json({ error: { code: "not_found", message: "Not used by search tests" } }, 404);
  });
}

async function openWorkspace(page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).first().click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width > 0)).toBe(true);
}

async function openSearch(page) {
  await page.locator('[data-workspace-surface="more"]').click();
  await page.locator('[data-workspace-action="search"]').click();
  const field = page.getByRole("searchbox");
  await expect(field).toBeFocused();
  return field;
}

/** A finger tap at a point: it lands on whatever is drawn there, as a real contact would. */
async function tapAt(page, x, y, pointerId) {
  await page.evaluate(({ x, y, pointerId }) => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const options = { pointerId, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, width: 9, height: 9, bubbles: true, cancelable: true, composed: true };
    document.elementFromPoint(x, y).dispatchEvent(new PointerEvent("pointerdown", { ...options, buttons: 1, pressure: .5 }));
    stage.dispatchEvent(new PointerEvent("pointerup", { ...options, buttons: 0, pressure: 0 }));
  }, { x, y, pointerId });
}

/** The type of every mark this device has stored for the sheet. */
async function storedAnnotationTypes(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("lock-in-workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!database.objectStoreNames.contains("pages")) {
      database.close();
      return [];
    }
    const pages = await new Promise((resolve, reject) => {
      const request = database.transaction("pages", "readonly").objectStore("pages").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return pages.flatMap((record) => (record.annotations || []).map((item) => item.type));
  });
}

async function centreOf(locator) {
  // WebKit scrollIntoView on an SVG group follows the outer page SVG rather
  // than the cover's rectangle. Scroll the reader to the actual touch target.
  await locator.evaluate((element) => {
    const stage = element.closest(".workspace-v2-document-stage");
    const target = element.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    stage.scrollTop += target.y + target.height / 2 - frame.y - frame.height / 2;
    stage.scrollLeft += target.x + target.width / 2 - frame.x - frame.width / 2;
  });
  // SVG intersection/bounding-box protocol measurements differ in WebKit;
  // the DOM bounds and the actual contact target are the geometry we need.
  await expect.poll(() => locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
}

test("search finds text on every page, steps through it and shows the page it is on", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  const field = await openSearch(page);

  await field.fill("reader TEST fixture");
  const results = page.getByRole("list", { name: "Search results" }).getByRole("button");
  // Results arrive page by page; the count is only stated once every page is read.
  const summary = page.locator("#workspace-search-summary");
  await expect(summary).toHaveText(/^Matches: \d+$/, { timeout: 15_000 });
  const total = Number((await summary.textContent()).match(/\d+/)[0]);
  // The fixture prints its title once on every page.
  expect(total).toBe(await page.locator(".workspace-v2-a4-page[data-pdf-page]").count());
  await expect(results).toHaveCount(total);

  await field.fill("end of page 12");
  await expect(results).toHaveCount(1, { timeout: 15_000 });
  await field.press("Enter");
  await expect(page.locator("#workspace-search-summary")).toHaveText("1 of 1");
  const active = page.locator('[data-pdf-page="12"] .workspace-search-highlights > span.is-active');
  await expect(active).toHaveCount(1);
  await expect(active).toBeInViewport();

  // Closed, the panel leaves the term and the arrows on screen.
  await page.getByRole("button", { name: "Close search" }).click();
  const navigator = page.locator(".workspace-search-navigator");
  await expect(navigator).toContainText("end of page 12");
  await expect(navigator).toContainText("1 of 1");
  await navigator.getByRole("button", { name: "Clear search" }).click();
  await expect(navigator).toHaveCount(0);
  await expect(page.locator(".workspace-search-highlights")).toHaveCount(0);
});

test("Find opens the reader's own search", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  // The toolbar lies over the stage's top edge; focus the stage in the gap below it.
  const toolbarBottom = await page.locator(".workspace-v2-toolbar").evaluate((node) => node.getBoundingClientRect().bottom);
  await page.locator(".workspace-v2-document-stage").click({ position: { x: 5, y: Math.ceil(toolbarBottom) + 4 } });
  await page.keyboard.press("Control+f");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});

test("every match can be hidden at once, revealed with a tap, and undone", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  const field = await openSearch(page);
  await field.fill("end of page 2");
  const hide = page.getByRole("button", { name: /Hide every match \(\d+\)/ });
  await expect(hide).toBeVisible({ timeout: 15_000 });
  await hide.click();

  const cover = page.locator('[data-pdf-page="2"] [data-annotation-type="cover"]');
  await expect(cover).toHaveCount(1);
  await expect(cover).not.toHaveClass(/is-revealed/);
  // Hiding clears the search, so nothing else is drawn over the answer.
  await expect(page.locator(".workspace-search-highlights")).toHaveCount(0);

  await cover.scrollIntoViewIfNeeded();
  const point = await centreOf(cover);
  await tapAt(page, point.x, point.y, 61);
  await expect(cover).toHaveClass(/is-revealed/);
  await tapAt(page, point.x, point.y, 62);
  await expect(cover).not.toHaveClass(/is-revealed/);

  await page.keyboard.press("Control+z");
  await expect(cover).toHaveCount(0);
});

test("an area hidden from the Add menu stays hidden after reopening the sheet", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  await page.locator('[data-workspace-surface="add"]').click();
  await page.locator('[data-workspace-tool="cover"]').click();

  const sheetPage = page.locator(".workspace-v2-a4-page").first();
  const box = await sheetPage.boundingBox();
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .3, { steps: 6 });
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .35, { steps: 6 });
  await page.mouse.up();

  const cover = page.locator('[data-annotation-type="cover"]');
  await expect(cover).toHaveCount(1);
  const drawn = await cover.boundingBox();
  expect(drawn.width).toBeGreaterThan(box.width * .3);
  expect(drawn.height).toBeGreaterThan(box.height * .1);

  // Reveal-all lives in the More menu while the sheet has covers.
  await page.locator('[data-workspace-surface="more"]').click();
  await page.getByRole("button", { name: /Reveal all hidden/ }).click();
  await expect(cover).toHaveClass(/is-revealed/);

  // Saved with the sheet; a new visit starts with every answer hidden again.
  await expect.poll(async () => (await storedAnnotationTypes(page)).includes("cover"), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).first().click();
  const restored = page.locator('[data-annotation-type="cover"]');
  await expect(restored).toHaveCount(1, { timeout: 20_000 });
  await expect(restored).not.toHaveClass(/is-revealed/);
});

test("the search reads Arabic and lays out right to left", async ({ page }, testInfo) => {
  await mockWorkspace(page, { language: "ar" });
  await openWorkspace(page, { width: 390, height: 844 });
  await page.locator('[data-workspace-surface="more"]').click();
  const entry = page.locator('[data-workspace-action="search"]');
  await expect(entry).toContainText("البحث في المستند");
  await entry.click();
  const field = page.getByRole("searchbox");
  await field.fill("end of page 7");
  const results = page.getByRole("list", { name: "نتائج البحث" }).getByRole("button");
  await expect(results).toHaveCount(1, { timeout: 15_000 });
  const panel = page.locator("#workspace-search-popover");
  const bounds = await panel.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("search-arabic.png") });

  // On a phone, showing a match closes the panel; the navigator keeps the place.
  await results.first().click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".workspace-search-navigator")).toContainText("1 من 1");
});

test("changing the query invalidates results before debounce can run", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  const field = await openSearch(page);
  await field.fill("end of page 2");
  await expect(page.getByRole("button", { name: /Hide every match/ })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await field.fill("new query");
  await expect(page.locator(".workspace-search-results")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Hide every match/ })).toHaveCount(0);
  await field.press("Enter");
  await expect(page.locator('[data-annotation-type="cover"]')).toHaveCount(0);
});

test("hide one result keeps the search available and prevents duplicate covers", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  const field = await openSearch(page);
  await field.fill("end of page 12");
  await expect(page.getByRole("list", { name: "Search results" }).getByRole("button")).toHaveCount(1);
  await field.press("Enter");
  await page.locator(".workspace-search-footer").getByRole("button", { name: /^Hide this match/ }).click();
  await expect(page.locator('[data-annotation-type="cover"]')).toHaveCount(1);
  await expect(field).toHaveValue("end of page 12");
  await expect(page.locator(".workspace-search-footer").getByRole("button", { name: /^Already hidden/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Hide every match (0)" })).toBeDisabled();
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.locator(".workspace-search-navigator").getByRole("button", { name: "Already hidden" })).toBeDisabled();
});

test("returning to a sheet within the workspace hides its answers again", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  const field = await openSearch(page);
  await field.fill("end of page 2");
  await page.getByRole("button", { name: /Hide every match/ }).click();
  const cover = page.locator('[data-annotation-type="cover"]');
  await expect(cover).toHaveCount(1);
  await cover.scrollIntoViewIfNeeded();
  const point = await centreOf(cover);
  await tapAt(page, point.x, point.y, 91);
  await expect(cover).toHaveClass(/is-revealed/);
  await expect.poll(async () => (await storedAnnotationTypes(page)).includes("cover")).toBe(true);
  // Client-side route changes reuse the workspace component.
  await page.evaluate(() => { location.hash = "#/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace"; });
  await expect(page.locator('[data-annotation-type="cover"]')).toHaveCount(0);
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]")).toHaveCount(17);
  await page.evaluate(() => { location.hash = "#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace"; });
  await expect(cover).toHaveCount(1);
  await expect(cover).not.toHaveClass(/is-revealed/);
});

test("a finger can hide an area while drawing stays restricted to a stylus", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page, { width: 390, height: 844 });
  await page.locator('[data-workspace-surface="add"]').click();
  await page.locator('[data-workspace-tool="cover"]').click();
  await page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const bounds = document.querySelector(".workspace-v2-a4-page").getBoundingClientRect();
    const start = { x: bounds.x + bounds.width * .2, y: bounds.y + bounds.height * .2 };
    const end = { x: bounds.x + bounds.width * .6, y: bounds.y + bounds.height * .35 };
    const event = (type, point) => new PointerEvent(type, {
      pointerId: 111, pointerType: "touch", isPrimary: true, clientX: point.x, clientY: point.y,
      button: 0, buttons: type === "pointerup" ? 0 : 1, width: 9, height: 9,
      bubbles: true, cancelable: true
    });
    document.elementFromPoint(start.x, start.y).dispatchEvent(event("pointerdown", start));
    stage.dispatchEvent(event("pointermove", end));
    stage.dispatchEvent(event("pointerup", end));
  });
  await expect(page.locator('[data-annotation-type="cover"]')).toHaveCount(1);
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(0);
});

for (const viewport of [
  { width: 320, height: 568, label: "phone" },
  { width: 834, height: 1112, label: "iPad portrait" },
  { width: 1194, height: 834, label: "iPad landscape" },
  { width: 844, height: 390, label: "phone landscape" }
]) {
  test(`search and recall controls remain reachable on ${viewport.label}`, async ({ page }, testInfo) => {
    await mockWorkspace(page);
    await openWorkspace(page, viewport);
    const field = await openSearch(page);
    await field.fill("reader test fixture");
    await expect(page.locator("#workspace-search-summary")).toHaveText(/^Matches: \d+$/);
    const panel = page.locator("#workspace-search-popover");
    const bounds = await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath("search-results.png") });
    await field.press("Enter");
    if (viewport.width <= 820) await expect(panel).toHaveCount(0);
    else await page.getByRole("button", { name: "Close search" }).click();
    const navigator = page.locator(".workspace-search-navigator");
    await expect(navigator.getByRole("button", { name: "Hide this match" })).toBeInViewport();
    const controlBounds = await navigator.boundingBox();
    expect(controlBounds.x).toBeGreaterThanOrEqual(0);
    expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(viewport.width);
    expect(controlBounds.height).toBeLessThanOrEqual(56);
    expect((await navigator.locator(".workspace-search-navigator-query").boundingBox()).width).toBeGreaterThanOrEqual(90);
    await navigator.getByRole("button", { name: "Hide this match" }).click();
    await expect(navigator.getByRole("button", { name: "Already hidden" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("recall-navigator.png") });
  });
}

test.describe("search above the virtual keyboard", () => {
  test.use({ hasTouch: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 834, height: 1112 }]) {
    test(`typing keeps results reachable at ${viewport.width}px`, async ({ page }) => {
      await mockWorkspace(page);
      await openWorkspace(page, viewport);
      const field = await openSearch(page);
      await field.fill("reader test fixture");
      await expect(page.locator("#workspace-search-summary")).toHaveText(/^Matches: \d+$/);
      const keyboardHeight = viewport.width === 320 ? 260 : 380;
      await page.evaluate((height) => {
        Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => document.documentElement.clientHeight - height });
        window.visualViewport.dispatchEvent(new Event("resize"));
      }, keyboardHeight);
      await expect(page.locator(".workspace-v2")).toHaveAttribute("data-keyboard", "open");
      const panel = page.locator("#workspace-search-popover");
      const bounds = await panel.boundingBox();
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - keyboardHeight);
      expect(await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
      const results = page.locator(".workspace-search-results");
      expect(await results.evaluate((element) => element.clientHeight)).toBeGreaterThan(44);
      const first = results.getByRole("button").first();
      await first.scrollIntoViewIfNeeded();
      const resultBounds = await first.boundingBox();
      expect(resultBounds.y).toBeLessThan(viewport.height - keyboardHeight);
      await first.click();
      await expect.poll(() => page.evaluate(() => document.activeElement?.matches('input[type="search"]'))).toBe(false);
      // The harness restores the viewport as the real keyboard would.
      await page.evaluate(() => {
        delete window.visualViewport.height;
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      await expect(page.locator(".workspace-v2")).not.toHaveAttribute("data-keyboard", "open");
      if (viewport.width > 820) await expect(page.locator(".workspace-search-footer").getByRole("button", { name: /^Hide this match/ })).toBeVisible();
      else await expect(page.locator(".workspace-search-navigator")).toBeVisible();
    });
  }
});
