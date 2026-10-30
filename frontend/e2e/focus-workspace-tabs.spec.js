import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { keepRawInk } from "./helpers/workspaceSettings.js";


const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function mockAuthenticatedWorkspace(page) {
  // This suite mocks API responses across reloads; the real worker has its own coverage.
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "tabs-student", email: "tabs@example.test", full_name: "Tabs Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by tab tests" } }) });
  });
}

// Open tabs stay mounted behind the one on screen; everything below is read
// from the reader that is showing.
const onScreen = (page, selector) => page.locator(`.workspace-pane.is-active ${selector}`);
const tabs = (page) => onScreen(page, ".workspace-v2-toolbar [role='tab']");

test("sheets and whiteboards open as tabs, each keeping its own state", async ({ page }) => {
  test.setTimeout(90_000);
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(onScreen(page, ".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect(tabs(page)).toHaveText(["Vitamin -1"]);
  // The tools no longer carry captions; their names are tooltips.
  await expect(page.locator(".workspace-v2-tool-caption")).toHaveCount(0);
  await expect(page.locator('[data-workspace-tool="pen"]')).toHaveAttribute("title", "Pen");

  // Marks this reader, to tell later whether coming back reused it or rebuilt it.
  await onScreen(page, ".workspace-v2").evaluate((element) => { element.dataset.keepAliveProbe = "first-sheet"; });

  // Another sheet opens in a new tab and asks for its own study mode.
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("menuitem", { name: /Open sheet/ }).click();
  const picker = page.getByRole("dialog", { name: "Open sheet" });
  // The picker asks for the subject first, then the sheet.
  await picker.getByRole("button", { name: /Biochemistry 1/ }).click();
  await picker.getByRole("button", { name: /Vitamin -2/ }).click();
  await expect(page).toHaveURL(/\/sheets\/vitamin-2\/workspace$/);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Vitamin -2"]);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");

  // Returning to the first sheet skips the question it already answered.
  await tabs(page).first().click();
  await expect(page).toHaveURL(/\/sheets\/vitamin-1\/workspace$/);
  await expect(onScreen(page, ".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog", { name: /Choose study mode/i })).toHaveCount(0);
  // The same reader, not a reload: switching tabs keeps each one mounted.
  await expect(onScreen(page, ".workspace-v2[data-keep-alive-probe='first-sheet']")).toHaveCount(1);
  // Only the tab on screen can be seen or used.
  await expect(page.locator(".workspace-pane.is-kept")).toHaveCount(1);
  await expect(page.locator(".workspace-pane.is-kept")).toHaveAttribute("inert", "");

  // A whiteboard is a lined page that grows from the button under its last page.
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("menuitem", { name: /Whiteboard/ }).click();
  await expect(page).toHaveURL(/\/whiteboards\/[a-f0-9-]+\/workspace$/);
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Whiteboard 1", "Vitamin -2"]);
  await expect(onScreen(page, '[data-workspace-page="1"] .workspace-v2-a4-canvas.is-visible')).toBeVisible({ timeout: 20_000 });
  await expect(onScreen(page, ".workspace-v2-study-mode-button")).toHaveCount(0);
  await expect(onScreen(page, ".workspace-v2-page-number")).toContainText("/ 1");
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(onScreen(page, ".workspace-v2-a4-page.is-virtual.is-background-lined")).toHaveCount(1);
  await expect(onScreen(page, ".workspace-v2-page-number")).toContainText("/ 2");

  // Sheet and whiteboard switch both ways without reloading either.
  await onScreen(page, ".workspace-v2").evaluate((element) => { element.dataset.keepAliveProbe = "whiteboard"; });
  await tabs(page).first().click();
  await expect(onScreen(page, ".workspace-v2[data-keep-alive-probe='first-sheet']")).toHaveCount(1);
  await tabs(page).nth(1).click();
  await expect(onScreen(page, ".workspace-v2[data-keep-alive-probe='whiteboard']")).toHaveCount(1);
  await expect(onScreen(page, ".workspace-v2-page-number")).toContainText("/ 2");

  // The whiteboard keeps its pages on this device across a reload.
  await page.waitForTimeout(1_500);
  await page.reload();
  await expect(onScreen(page, ".workspace-v2-a4-page.is-virtual.is-background-lined")).toHaveCount(1, { timeout: 20_000 });
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Whiteboard 1", "Vitamin -2"]);

  // Closing the open tab moves to its neighbour.
  await page.getByRole("button", { name: "Close Whiteboard 1" }).click();
  await expect(page).toHaveURL(/\/sheets\/vitamin-2\/workspace$/);
  await expect(tabs(page)).toHaveText(["Vitamin -1", "Vitamin -2"]);
});

test("five kept PDF tabs release hidden raster buffers and repaint the same reader on return", async ({ page }) => {
  test.setTimeout(120_000);
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  const pixels = (selector) => page.evaluate((selector) => [...document.querySelectorAll(selector)].reduce((total, canvas) => total + canvas.width * canvas.height, 0), selector);
  const activeCanvases = ".workspace-pane.is-active .workspace-v2-a4-canvas";
  await expect.poll(() => pixels(activeCanvases)).toBeGreaterThan(0);
  await onScreen(page, ".workspace-v2").evaluate((element) => { element.dataset.memoryProbe = "original-reader"; });

  for (const [slug, title] of [["vitamin-2", "Vitamin -2"], ["vitamin-3", "Vitamin -3"], ["range-probe", "Range probe"], ["long-probe", "Long probe"]]) {
    await page.evaluate((slug) => { location.hash = `/materials/catalog/biochemistry-1/sheets/${slug}/workspace`; }, slug);
    await expect(onScreen(page, ".workspace-v3-document-context strong")).toHaveText(title);
    await page.getByRole("button", { name: /Normal Study/ }).click();
    await expect.poll(() => pixels(activeCanvases)).toBeGreaterThan(0);
    await expect.poll(() => pixels(".workspace-pane.is-kept .workspace-v2-a4-canvas")).toBe(0);
  }
  await expect(page.locator(".workspace-pane.is-kept")).toHaveCount(4);
  // Native tab navigation preserves the component and its geometry/state.
  await tabs(page).filter({ hasText: "Vitamin -1" }).click();
  await expect(onScreen(page, ".workspace-v2[data-memory-probe='original-reader']")).toHaveCount(1);
  await expect.poll(() => pixels(activeCanvases)).toBeGreaterThan(0);
  await expect.poll(() => pixels(".workspace-pane.is-kept .workspace-v2-a4-canvas")).toBe(0);
  await expect(page.getByRole("dialog", { name: /Choose study mode/i })).toHaveCount(0);
  // Compact tab strips expose the close action only on the selected tab.
  await tabs(page).filter({ hasText: "Long probe" }).click();
  await expect.poll(() => pixels(activeCanvases)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close Long probe" }).click();
  await expect(page.locator(".workspace-pane.is-kept")).toHaveCount(3);
});


test("five written tabs release hidden live buffers without losing ink, undo or durable state", async ({ page }) => {
  test.setTimeout(120_000);
  await mockAuthenticatedWorkspace(page);
  await keepRawInk(page);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.setViewportSize({ width: 834, height: 1194 });
  const documents = [["vitamin-1", "Vitamin -1"], ["vitamin-2", "Vitamin -2"], ["vitamin-3", "Vitamin -3"], ["range-probe", "Range probe"], ["long-probe", "Long probe"]];
  const saved = new Map();
  const ink = () => onScreen(page, '[data-pdf-page="1"] [data-annotation-type="pen"]');
  const hiddenPixels = () => page.evaluate(() => [...document.querySelectorAll(".workspace-pane.is-kept canvas")].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0));
  await page.goto(ROUTE);
  for (const [index, [slug, title]] of documents.entries()) {
    if (index) await page.evaluate((slug) => { location.hash = '/materials/catalog/biochemistry-1/sheets/' + slug + '/workspace'; }, slug);
    await expect(onScreen(page, ".workspace-v3-document-context strong")).toHaveText(title);
    await page.getByRole("button", { name: /Normal Study/ }).click();
    await expect.poll(() => onScreen(page, ".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pen", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.evaluate(async (pointerId) => {
      const stage = document.querySelector(".workspace-pane.is-active .workspace-v2-document-stage");
      const bounds = document.querySelector('.workspace-pane.is-active [data-pdf-page="1"]').getBoundingClientRect();
      const send = (type, step) => stage.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: "pen", isPrimary: true, clientX: bounds.x + bounds.width * (.2 + step * .01), clientY: bounds.y + Math.min(bounds.height, 700) * .35 + Math.sin(step) * 8, buttons: type === "pointerup" ? 0 : 1, button: 0, pressure: .5, bubbles: true, cancelable: true }));
      send("pointerdown", 0);
      for (let step = 1; step <= 24; step++) { await new Promise(requestAnimationFrame); send("pointermove", step); }
      send("pointerup", 24);
    }, 300 + index);
    await expect(ink()).toHaveCount(1);
    saved.set(slug, await ink().evaluate((mark) => ({ id: mark.dataset.annotationId, path: mark.getAttribute("d") })));
    if (index) await expect.poll(hiddenPixels).toBe(0);
  }
  await expect(page.locator(".workspace-pane.is-kept")).toHaveCount(4);
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect.poll(hiddenPixels).toBe(0);
  for (const [slug, title] of documents) {
    await tabs(page).filter({ hasText: title }).click();
    await expect(onScreen(page, ".workspace-v3-document-context strong")).toHaveText(title);
    await expect(ink()).toHaveCount(1);
    expect(await ink().evaluate((mark) => ({ id: mark.dataset.annotationId, path: mark.getAttribute("d") }))).toEqual(saved.get(slug));
    await expect.poll(hiddenPixels).toBe(0);
  }
  await tabs(page).filter({ hasText: "Vitamin -1" }).click();
  await expect(onScreen(page, ".workspace-v3-document-context strong")).toHaveText("Vitamin -1");
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(ink()).toHaveCount(0);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect(ink()).toHaveCount(1);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("lock-in-workspace"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const rows = await new Promise((resolve, reject) => { const request = db.transaction("pages").objectStore("pages").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close();
    return rows.filter((row) => row.documentId.startsWith("user:tabs-student::") && row.page === 1 && row.annotations.length === 1).length;
  })).toBe(5);
  await page.reload();
  await expect(ink()).toHaveCount(1, { timeout: 20_000 });
  expect(await ink().evaluate((mark) => ({ id: mark.dataset.annotationId, path: mark.getAttribute("d") }))).toEqual(saved.get("vitamin-1"));
});


test("an unfinished live stroke repaints after a tab return and commits once", async ({ page }) => {
  test.setTimeout(90_000);
  await mockAuthenticatedWorkspace(page);
  await keepRawInk(page);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(onScreen(page, ".workspace-v2-a4-canvas.is-visible").first()).toBeVisible();
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const stage = document.querySelector(".workspace-pane.is-active .workspace-v2-document-stage");
    const bounds = document.querySelector('.workspace-pane.is-active [data-pdf-page="1"]').getBoundingClientRect();
    const x = bounds.x + bounds.width * .25, y = bounds.y + Math.min(bounds.height, 700) * .35;
    window.__tabStroke = { x: x + 140, y: y + 10 };
    for (const [type, dx] of [["pointerdown", 0], ["pointermove", 60], ["pointermove", 140]]) {
      stage.dispatchEvent(new PointerEvent(type, { pointerId: 451, pointerType: "pen", isPrimary: true, clientX: x + dx, clientY: y + dx / 14, buttons: 1, button: 0, pressure: .5, bubbles: true, cancelable: true }));
      await new Promise(requestAnimationFrame);
    }
  });
  const livePaint = () => onScreen(page, ".workspace-v2-live-annotation-canvas").evaluate((canvas) => {
    if (!canvas.width || !canvas.height) return 0;
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;
    for (let i = 3; i < data.length; i += 4) alpha += data[i];
    return alpha;
  });
  await expect.poll(livePaint).toBeGreaterThan(0);
  await page.evaluate(() => { location.hash = "/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace"; });
  await expect(onScreen(page, ".workspace-v3-document-context strong")).toHaveText("Vitamin -2");
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect.poll(() => page.locator(".workspace-pane.is-kept .workspace-v2-live-annotation-canvas").evaluate((canvas) => canvas.width * canvas.height)).toBe(0);
  await tabs(page).filter({ hasText: "Vitamin -1" }).click();
  await expect(onScreen(page, ".workspace-v3-document-context strong")).toHaveText("Vitamin -1");
  await expect.poll(livePaint).toBeGreaterThan(0);
  await page.evaluate(() => {
    const point = window.__tabStroke;
    document.querySelector(".workspace-pane.is-active .workspace-v2-document-stage").dispatchEvent(new PointerEvent("pointerup", { pointerId: 451, pointerType: "pen", isPrimary: true, clientX: point.x, clientY: point.y, buttons: 0, button: 0, pressure: 0, bubbles: true, cancelable: true }));
  });
  const ink = onScreen(page, '[data-pdf-page="1"] [data-annotation-type="pen"]');
  await expect(ink).toHaveCount(1);
  await expect.poll(livePaint).toBe(0);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(ink).toHaveCount(0);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect(ink).toHaveCount(1);
});

// Hidden readers retain their documents, but must not own global menus/keys.
test("only the visible reader opens a sheet picker and keeps keyboard focus inside it", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await page.evaluate(() => { location.hash = "/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace"; });
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-pane.is-kept")).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lockin:workspace-sheet-picker")));
  // Count includes hidden readers: a visible-only assertion misses the bug.
  await expect(page.locator(".workspace-tabs-picker")).toHaveCount(1);
  const picker = page.getByRole("dialog", { name: "Open sheet" });
  const first = picker.locator("button").first();
  const last = picker.locator("button").last();
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await picker.getByRole("button", { name: /Biochemistry 1/ }).click();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveAttribute("data-step", "subjects");
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace-tabs-picker")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New tab" })).toBeFocused();
  // Reopening the old sheet must not resurrect its hidden picker.
  await tabs(page).first().click();
  await expect(page.locator(".workspace-tabs-picker")).toHaveCount(0);
});

test("switching away dismisses a picker without letting its Escape handler steal focus", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lockin:workspace-sheet-picker")));
  await expect(page.locator(".workspace-tabs-picker")).toHaveCount(1);
  await page.evaluate(() => { location.hash = "/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace"; });
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-tabs-picker")).toHaveCount(0);
  await tabs(page).first().click();
  await expect(page.locator(".workspace-tabs-picker")).toHaveCount(0);
});
