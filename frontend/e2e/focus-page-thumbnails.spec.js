import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const SHEET_ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const LONG_ROUTE = "/#/materials/catalog/biochemistry-1/sheets/long-probe/workspace";
const SCREENSHOT_DIR = process.env.THUMBNAIL_SCREENSHOT_DIR || "output/playwright";

async function mockWorkspace(page, { language = "en", activeEnd = 10 } = {}) {
  await page.addInitScript((lang) => {
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    localStorage.setItem("lockin.language", lang);
  }, language);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") return json({ user: { id: "thumbs-student", email: "thumbs@example.test", full_name: "Thumbs Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "thumbs-csrf" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") return json({ active_session: null });
    if (pathname.startsWith("/api/v1/focus/managed-active-study/sheets/")) return json({ difficulties: ["easy", "medium", "hard"].map((difficulty) => ({ difficulty, status: "ready" })) });
    if (pathname === "/api/v1/focus/managed-active-study/start") {
      return json({ resumed: false, run: { id: "thumbs-run", difficulty: "medium", status: "active", stage: "reading", current_part: 1, number_of_parts: 4, current_page_range: { start_page: 1, end_page: activeEnd } } });
    }
    return json({ error: { code: "not_found", message: "Not used" } }, 404);
  });
}

async function openReader(page, route, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto(route);
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
}

async function openThumbnails(page) {
  await page.locator(".workspace-v2-page-number").click();
  await page.locator(".workspace-v2-page-thumbs-toggle").click();
  const panel = page.locator("#workspace-page-thumbnails");
  await expect(panel).toBeVisible();
  return panel;
}

const readyCount = (panel) => panel.locator('[data-thumb-state="ready"]').count();

test("the page dock opens thumbnails, marks the current page and jumps on click", async ({ page }) => {
  await mockWorkspace(page);
  await openReader(page, SHEET_ROUTE);
  const panel = await openThumbnails(page);

  await expect(panel.locator('[data-thumb-page="1"]')).toHaveAttribute("aria-current", "page");
  await expect.poll(() => readyCount(panel), { timeout: 15_000 }).toBeGreaterThan(0);
  const painted = await panel.locator('[data-thumb-state="ready"] canvas').first().evaluate((canvas) => canvas.width > 0 && canvas.height > canvas.width);
  expect(painted).toBe(true);

  await panel.locator('[data-thumb-page="7"]').click();
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 7 of 41");
  await expect(panel).toBeHidden();
  await expect(page.locator(".workspace-v2-page-thumbs-toggle")).toBeFocused();

  await page.locator(".workspace-v2-page-thumbs-toggle").click();
  await expect(page.locator('#workspace-page-thumbnails [data-thumb-page="7"]')).toHaveAttribute("aria-current", "page");
});

test("thumbnails support arrow keys and Escape returns focus to the dock", async ({ page }) => {
  await mockWorkspace(page);
  await openReader(page, SHEET_ROUTE);
  const panel = await openThumbnails(page);
  await expect(panel.locator('[data-thumb-page="1"]')).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(panel.locator('[data-thumb-page="2"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const columns = Number(await panel.locator("[data-thumb-columns]").getAttribute("data-thumb-columns"));
  await expect(panel.locator(`[data-thumb-page="${2 + columns}"]`)).toBeFocused();
  await page.keyboard.press("End");
  await expect(panel.locator('[data-thumb-page="41"]')).toBeFocused();
  // Arrow keys belong to the grid while it has focus: the reader must not scroll to another page.
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 41");
  await page.keyboard.press("Enter");
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 41 of 41");

  // The dock stays open after a jump; reopen the grid and dismiss it with Escape.
  await page.locator(".workspace-v2-page-thumbs-toggle").click();
  await expect(page.locator("#workspace-page-thumbnails")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#workspace-page-thumbnails")).toHaveCount(0);
  await expect(page.locator(".workspace-v2-page-number")).toBeFocused();
});

test("Arabic reverses the arrow keys", async ({ page }) => {
  await mockWorkspace(page, { language: "ar" });
  await openReader(page, SHEET_ROUTE);
  const panel = await openThumbnails(page);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".workspace-page-thumbs-scroller")).direction)).toBe("rtl");
  await panel.locator('[data-thumb-page="1"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(panel.locator('[data-thumb-page="2"]')).toBeFocused();
});

test("pages outside the Active Study range are locked and cannot be jumped to", async ({ page }) => {
  await mockWorkspace(page, { activeEnd: 10 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(SHEET_ROUTE);
  await page.getByRole("dialog", { name: "Choose study mode" }).getByRole("button", { name: /Start Active Study/ }).click();
  await expect(page.getByRole("button", { name: "Reach page 10 to unlock the checkpoint" })).toBeVisible();
  const panel = await openThumbnails(page);

  await expect(panel.locator('[data-thumb-page="10"]')).not.toHaveAttribute("aria-disabled", "true");
  await panel.locator("[data-thumb-columns]").evaluate((node) => { node.scrollTop = 160; });
  const locked = panel.locator('[data-thumb-page="11"]');
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  await expect(locked).toHaveAttribute("aria-label", "Page 11, locked");
  await expect(locked).toHaveAttribute("data-thumb-state", "locked");
  await locked.click({ force: true });
  await expect(panel).toBeVisible();
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 10");

  await panel.locator('[data-thumb-page="9"]').click();
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 9 of 10");
});

test("a 240-page PDF keeps the DOM and render work bounded and the reader rendering", async ({ page }) => {
  await mockWorkspace(page);
  await openReader(page, LONG_ROUTE);
  const panel = await openThumbnails(page);

  await expect.poll(() => readyCount(panel), { timeout: 20_000 }).toBeGreaterThan(0);
  const mounted = () => panel.locator("[data-thumb-page]").count();
  expect(await mounted()).toBeLessThan(40);

  const scroller = panel.locator("[data-thumb-columns]");
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(panel.locator('[data-thumb-page="240"]')).toBeVisible();
  expect(await mounted()).toBeLessThan(40);
  await expect.poll(() => panel.locator('[data-thumb-page="240"]').getAttribute("data-thumb-state"), { timeout: 20_000 }).toBe("ready");
  // Pages scrolled past without settling are never rendered.
  expect(await panel.locator('[data-thumb-page="120"]').count()).toBe(0);

  await panel.locator('[data-thumb-page="240"]').click();
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 240 of 240");
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
  test(`thumbnails panel screenshot at ${viewport.width}`, async ({ page }) => {
    await mockWorkspace(page);
    await openReader(page, SHEET_ROUTE, viewport);
    const panel = await openThumbnails(page);
    await expect.poll(() => readyCount(panel), { timeout: 15_000 }).toBeGreaterThan(3);
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    const cell = await panel.locator('[data-thumb-page="1"]').boundingBox();
    expect(cell.width).toBeGreaterThanOrEqual(44);
    expect(cell.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-page-thumbnails-${viewport.width}.png` });
  });
}
