import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

// The reader's toolbar layout contract: one row on a phone with one document
// open, the writing tools first and on screen, Undo/Redo pinned beside them,
// and every action dropped for room still reachable from More.

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function mockWorkspace(page, { language = "en" } = {}) {
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "toolbar-student", email: "toolbar@example.test", full_name: "Toolbar Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by toolbar tests" } }) });
  });
}

async function openWorkspace(page, viewport, options) {
  await mockWorkspace(page, options);
  await page.setViewportSize(viewport);
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).click();
  await expect(page.locator(".workspace-pane.is-active .workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
}

const toolbar = (page) => page.locator(".workspace-pane.is-active .workspace-v2-toolbar");

/** Where each control sits, and whether the rail shows all of it. */
async function toolbarReport(page) {
  return toolbar(page).evaluate((bar) => {
    // 44px for a finger; a mouse at phone width gets the compact 38px bar.
    const minTarget = matchMedia("(pointer: coarse)").matches ? 43.5 : 37.5;
    const rail = bar.querySelector(".workspace-v3-primary").getBoundingClientRect();
    const shown = (node) => node && node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== "none";
    const fullyInRail = (selector) => {
      const box = bar.querySelector(selector)?.getBoundingClientRect();
      return Boolean(box) && box.left >= rail.left - 1 && box.right <= rail.right + 1;
    };
    const onScreen = (selector) => {
      const node = bar.querySelector(selector);
      if (!shown(node)) return false;
      const box = node.getBoundingClientRect();
      return box.left >= -1 && box.right <= window.innerWidth + 1 && box.width >= minTarget && box.height >= minTarget;
    };
    return {
      height: bar.getBoundingClientRect().height,
      tabsShown: shown(bar.querySelector(".workspace-tabs")),
      writingTools: ["pen", "highlighter", "eraser", "select"].map((tool) => fullyInRail(`[data-workspace-tool="${tool}"]`)),
      undoRedo: [...bar.querySelectorAll(".workspace-v2-history.is-docked button")].map((button) => {
        const box = button.getBoundingClientRect();
        return box.width >= minTarget && box.left >= -1 && box.right <= window.innerWidth + 1;
      }),
      more: onScreen('[data-workspace-surface="more"]'),
      study: shown(bar.querySelector('[data-workspace-surface="study"]')),
      notes: shown(bar.querySelector('[data-workspace-tool="note"]')),
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
}

for (const viewport of [
  { width: 360, height: 800, name: "Android 360" },
  { width: 375, height: 667, name: "iPhone SE" },
  { width: 390, height: 844, name: "iPhone 390" },
  { width: 440, height: 956, name: "iPhone Pro Max 440" }
]) {
  test(`one document on ${viewport.name}: one row with Pen, Highlight, Eraser and Lasso on screen`, async ({ page }) => {
    test.setTimeout(60_000);
    await openWorkspace(page, viewport);
    const report = await toolbarReport(page);
    expect(report.tabsShown, "a single document still spends a row on tabs").toBe(false);
    expect(report.height, "the phone toolbar is taller than one row").toBeLessThanOrEqual(56);
    expect(report.writingTools, "a writing tool needs scrolling to reach").toEqual([true, true, true, true]);
    expect(report.undoRedo, "Undo/Redo are not pinned on screen").toEqual([true, true]);
    expect(report.more).toBe(true);
    expect(report.notes, "Notes stays in the toolbar on a phone").toBe(false);
    expect(report.study, "Study is shown only where it fits").toBe(viewport.width >= 400);
    expect(report.pageOverflow).toBeLessThanOrEqual(0);
  });
}

for (const viewport of [{ width: 768, height: 1024, name: "iPad mini" }, { width: 820, height: 1180, name: "iPad portrait" }]) {
  test.describe(`touch ${viewport.name}`, () => {
    // A finger on an iPad gets 44px targets; the whole bar must still fit one row.
    test.use({ hasTouch: true });
    test(`one row at ${viewport.width}px with every tool and Undo/Redo on screen`, async ({ page }) => {
      test.setTimeout(60_000);
      await mockWorkspace(page);
      await page.setViewportSize(viewport);
      await page.goto(ROUTE);
      const install = page.getByRole("button", { name: /Continue in browser/ });
      const normal = page.getByRole("button", { name: /Normal Study/ });
      await expect(install.or(normal)).toBeVisible({ timeout: 20_000 });
      if (await install.isVisible()) await install.click();
      await normal.click();
      await expect(page.locator(".workspace-pane.is-active .workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
      const report = await toolbarReport(page);
      expect(report.height).toBeLessThanOrEqual(56);
      expect(report.writingTools).toEqual([true, true, true, true]);
      expect(report.undoRedo, "Undo/Redo scrolled out of a touch iPad's bar").toEqual([true, true]);
      expect(await toolbar(page).locator(".workspace-v3-primary").evaluate((rail) => rail.scrollWidth - rail.clientWidth), "the touch iPad rail needs scrolling").toBeLessThanOrEqual(1);
    });
  });
}

test("More stands in for everything the phone toolbar folds away", async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkspace(page, { width: 390, height: 844 });
  await toolbar(page).getByRole("button", { name: "More workspace actions" }).click();
  const more = page.locator("#workspace-more-popover");
  await expect(more.locator(".workspace-v3-menu-document")).toContainText("Vitamin -1");
  for (const action of ["study", "notes", "new-whiteboard", "open-sheet", "video", "add"]) {
    await expect(more.locator(`[data-workspace-action="${action}"]`), `${action} is missing from More`).toBeVisible();
  }
  for (const label of ["Hand", "Shapes"]) await expect(more.getByRole("button", { name: label, exact: true })).toBeVisible();
  // Tool options open from the active tool itself; Pencil, Full screen and Undo history are gone.
  for (const action of ["tool-settings", "fullscreen"]) await expect(more.locator(`[data-workspace-action="${action}"]`)).toHaveCount(0);
  await expect(more.getByRole("button", { name: "Pencil", exact: true })).toHaveCount(0);
  await expect(more.getByRole("button", { name: "Undo history" })).toHaveCount(0);

  await more.locator('[data-workspace-action="study"]').click();
  await expect(page.getByRole("dialog", { name: "Study", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // Study's own button is folded away at this width, so focus returns to More.
  await expect(toolbar(page).locator('[data-workspace-surface="more"]')).toBeFocused();

  await toolbar(page).getByRole("button", { name: "More workspace actions" }).click();
  await more.locator('[data-workspace-action="notes"]').click();
  await expect(page.locator("#workspace-notes-panel")).toBeVisible();
  await page.keyboard.press("Escape");

  await toolbar(page).getByRole("button", { name: "More workspace actions" }).click();
  await more.locator('[data-workspace-action="open-sheet"]').click();
  await expect(page.getByRole("dialog", { name: "Open sheet" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Open sheet" })).toHaveCount(0);
});

test("a tablet's More menu does not repeat what its toolbar already shows", async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkspace(page, { width: 834, height: 1194 });
  await toolbar(page).getByRole("button", { name: "More workspace actions" }).click();
  const more = page.locator("#workspace-more-popover");
  // The tab row is gone for one document, so its name and New tab live here.
  for (const action of ["new-whiteboard", "open-sheet", "video"]) await expect(more.locator(`[data-workspace-action="${action}"]`)).toBeVisible();
  await expect(more.locator(".workspace-v3-menu-document")).toBeVisible();
  // Study, Notes, Hand and Add are all on the tablet toolbar.
  for (const action of ["study", "notes", "add"]) await expect(more.locator(`[data-workspace-action="${action}"]`)).toBeHidden();
  await expect(more.getByRole("button", { name: "Hand", exact: true })).toBeHidden();
});

test("a second document brings the tab row back, and closing it removes the row again", async ({ page }) => {
  test.setTimeout(90_000);
  await openWorkspace(page, { width: 390, height: 844 });
  await toolbar(page).getByRole("button", { name: "More workspace actions" }).click();
  await page.locator('#workspace-more-popover [data-workspace-action="new-whiteboard"]').click();
  await expect(page).toHaveURL(/\/whiteboards\/[a-f0-9-]+\/workspace$/);
  const tabs = toolbar(page).locator("[role='tab']");
  await expect(tabs).toHaveCount(2);
  await expect(toolbar(page).locator(".workspace-tabs")).toBeVisible();
  const withTabs = await toolbarReport(page);
  expect(withTabs.undoRedo).toEqual([true, true]);
  expect(withTabs.writingTools).toEqual([true, true, true, true]);

  await toolbar(page).getByRole("button", { name: /^Close Whiteboard/ }).click();
  await expect(page).toHaveURL(/\/sheets\/vitamin-1\/workspace$/);
  await expect(toolbar(page).locator(".workspace-tabs")).toBeHidden();
  expect((await toolbarReport(page)).height).toBeLessThanOrEqual(56);
});

test("the one-row landscape bar keeps its height when a second tab opens", async ({ page }) => {
  test.setTimeout(90_000);
  await openWorkspace(page, { width: 1194, height: 834 });
  const height = () => toolbar(page).evaluate((bar) => Math.round(bar.getBoundingClientRect().height));
  const single = await height();
  await toolbar(page).getByRole("button", { name: "New tab" }).click();
  await page.getByRole("menuitem", { name: /Whiteboard/ }).click();
  await expect(toolbar(page).locator("[role='tab']")).toHaveCount(2);
  expect(await height(), "a second tab made the one-row bar taller").toBe(single);
});

test("exactly one tool looks active, and the swatch follows the colour tool", async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkspace(page, { width: 834, height: 1194 });
  const bar = toolbar(page);
  for (const tool of ["highlighter", "eraser", "pen"]) {
    await bar.locator(`[data-workspace-tool="${tool}"]`).click();
    await page.keyboard.press("Escape");
    // Measure the settled state, not a frame of the slide.
    await expect.poll(() => bar.locator(".workspace-v2-tool-list").evaluate((list, active) => {
      const target = list.querySelector(`[data-workspace-tool="${active}"]`);
      const indicator = list.querySelector(".workspace-v2-tool-indicator");
      const lit = [...list.querySelectorAll(".workspace-v3-tool-button")].filter((button) => {
        const style = getComputedStyle(button);
        return style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
      }).length;
      const pressed = [...list.querySelectorAll('[aria-pressed="true"]')].map((button) => button.dataset.workspaceTool);
      const offset = Math.abs(indicator.getBoundingClientRect().left - target.getBoundingClientRect().left);
      return { pressed, lit, aligned: offset < 1.5 };
    }, tool)).toEqual({ pressed: [tool], lit: 0, aligned: true });
    await expect(bar.locator(".workspace-v3-tool-swatch")).toHaveCount(tool === "eraser" ? 0 : 1);
  }
});

test("the Arabic phone toolbar mirrors and keeps the same reach", async ({ page }) => {
  test.setTimeout(60_000);
  await openWorkspace(page, { width: 390, height: 844 }, { language: "ar" });
  const report = await toolbarReport(page);
  expect(report.height).toBeLessThanOrEqual(56);
  expect(report.writingTools).toEqual([true, true, true, true]);
  expect(report.undoRedo).toEqual([true, true]);
  const order = await toolbar(page).evaluate((bar) => ["pen", "highlighter"].map((tool) => bar.querySelector(`[data-workspace-tool="${tool}"]`).getBoundingClientRect().left));
  expect(order[0], "Pen should sit to the right of Highlight in Arabic").toBeGreaterThan(order[1]);
  await toolbar(page).locator('[data-workspace-surface="more"]').click();
  const menu = await page.locator("#workspace-more-popover").boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(-1);
  expect(menu.x + menu.width).toBeLessThanOrEqual(391);
});

for (const language of ["en", "ar"]) {
  test(`new tab menu stays inside the pane after resize (${language})`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
    await page.route("**/e2e-fixtures/pdf/**", (route) => route.fulfill({
      path: new URL("./fixtures/pdf/sheet-41.pdf", import.meta.url).pathname,
      contentType: "application/pdf"
    }));
    await openWorkspace(page, { width: 390, height: 844 }, { language });
    await toolbar(page).locator('[data-workspace-surface="more"]').click();
    await page.locator('.workspace-pane.is-active [data-workspace-action="new-whiteboard"]').click();
    await expect(toolbar(page).locator("[role='tab']")).toHaveCount(2);
    await toolbar(page).locator(".workspace-tabs-add").click();
    const menu = page.locator(".workspace-tabs-menu:visible");
    const fits = () => menu.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const pane = node.closest(".workspace-v2").getBoundingClientRect();
      return rect.left >= pane.left + 7 && rect.right <= pane.right - 7 && rect.bottom <= Math.min(pane.bottom, innerHeight) - 7;
    });
    await expect.poll(fits).toBe(true);
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect.poll(fits).toBe(true);
    await page.setViewportSize({ width: 390, height: 190 });
    await expect.poll(fits).toBe(true);
    const youtube = menu.getByRole("menuitem").last();
    await youtube.scrollIntoViewIfNeeded();
    await expect(youtube).toBeInViewport();
    await youtube.click();
    await expect(page.locator(".focus-video")).toBeVisible();
  });
}
