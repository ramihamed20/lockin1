import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

const PHONES = [
  { width: 320, height: 568, name: "phone-320" },
  { width: 360, height: 800, name: "phone-360" },
  { width: 390, height: 844, name: "phone-390" },
  { width: 412, height: 915, name: "phone-412" }
];

const TABLETS = [
  { width: 768, height: 1024, name: "tablet-768" },
  { width: 820, height: 1180, name: "tablet-820" },
  { width: 834, height: 1194, name: "tablet-834" },
  { width: 1024, height: 1366, name: "tablet-1024" }
];

async function mockAuthenticatedWorkspace(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "responsive-student", email: "responsive@example.test", full_name: "Responsive Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    // The workspace is behind the subscription gate, so the access contract has
    // to answer before the reader will render anything to measure.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by responsive tests" } }) });
  });
}

/** Every visible control must stay inside the viewport and remain tappable. */
async function auditViewport(page, viewport) {
  const report = await page.evaluate((size) => {
    const root = document.querySelector(".workspace-v2");
    const rootBounds = root.getBoundingClientRect();
    const overflowing = [];
    const undersized = [];
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    for (const control of root.querySelectorAll("button:not([disabled]), input, [role='switch']")) {
      const bounds = control.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      // Closed drawers park their controls off-screen and mark them inert.
      if (control.closest("[inert], [aria-hidden='true']")) continue;
      const scroller = control.closest(".workspace-v2-toolbar-scroll, .workspace-v2-tool-options, .workspace-v2-settings-content, .workspace-v2-side-content");
      if (!scroller && (bounds.right > size.width + 1 || bounds.left < -1 || bounds.bottom > size.height + 1 || bounds.top < -1)) {
        overflowing.push(`${control.className || control.tagName}@${Math.round(bounds.left)},${Math.round(bounds.top)} ${Math.round(bounds.width)}x${Math.round(bounds.height)}`);
      }
      const target = Math.min(bounds.width, bounds.height);
      if (coarse && target < 24) undersized.push(`${control.getAttribute("aria-label") || control.className} ${Math.round(bounds.width)}x${Math.round(bounds.height)}`);
    }
    return {
      overflowing,
      undersized,
      documentScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      workspaceWidth: Math.round(rootBounds.width),
      workspaceHeight: Math.round(rootBounds.height),
      stageScrollsSideways: (() => {
        const stage = document.querySelector(".workspace-v2-document-stage");
        return stage ? stage.scrollWidth > stage.clientWidth + 1 : false;
      })()
    };
  }, viewport);
  expect(report.overflowing, `controls escaped the ${viewport.name} viewport`).toEqual([]);
  expect(report.documentScrollsSideways, `${viewport.name} scrolled the page sideways`).toBe(false);
  expect(report.workspaceWidth).toBe(viewport.width);
  return report;
}

for (const orientation of ["portrait", "landscape"]) {
  for (const device of [...PHONES, ...TABLETS]) {
    const viewport = orientation === "portrait"
      ? { ...device, name: `${device.name}-portrait` }
      : { width: device.height, height: device.width, name: `${device.name}-landscape` };

    test(`the workspace fits ${viewport.name} with the page dock and tool options open`, async ({ page }) => {
      test.setTimeout(60_000);
      await mockAuthenticatedWorkspace(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(ROUTE);
      await page.getByRole("button", { name: /Normal Study/ }).click();
      await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
      if (viewport.width < 1200) expect((await page.locator(".workspace-v2-toolbar").boundingBox()).y).toBeGreaterThanOrEqual(34);

      // The reader always fills the viewport, and the page dock is reachable.
      await auditViewport(page, viewport);
      await expect(page.locator(".workspace-v2-page-number")).toBeVisible();
      await page.locator(".workspace-v2-page-number").click();
      await expect(page.locator(".workspace-v2-page-navigator")).toBeVisible();
      const directPinchLayout = await page.evaluate(() => window.innerWidth < 1024 || matchMedia("(any-pointer: coarse)").matches);
      if (directPinchLayout) {
        await expect(page.locator(".workspace-v2-page-navigator .workspace-v2-zoom-control")).toBeHidden();
        await expect(page.locator(".workspace-v2-page-navigator .workspace-v4-zoom-presets")).toBeHidden();
        await expect(page.locator(".workspace-v2-zoom-bar")).toBeHidden();
      }
      await auditViewport(page, viewport);
      await page.locator(".workspace-v2-page-number").click();

      // The pen palette is the widest surface the toolbar can open.
      const pen = page.locator('[data-workspace-tool="pen"]');
      await pen.scrollIntoViewIfNeeded();
      await pen.click();
      await expect(page.locator("#workspace-pen-options")).toBeVisible();
      const optionsFit = await page.locator("#workspace-pen-options").evaluate((node, size) => {
        const bounds = node.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, bottom: bounds.bottom, viewportWidth: size.width, viewportHeight: size.height };
      }, viewport);
      expect(optionsFit.left).toBeGreaterThanOrEqual(-1);
      expect(optionsFit.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(optionsFit.bottom).toBeLessThanOrEqual(viewport.height + 1);
      await auditViewport(page, viewport);

      // The primary tools stay on one line in compact layouts.
      const rail = await page.locator(".workspace-v2-tool-list").evaluate((list) => {
        const scroller = list.closest(".workspace-v3-primary");
        const buttons = [...list.querySelectorAll("button")];
        const visibleButtons = buttons.filter((button) => button.getBoundingClientRect().width > 0);
        const tops = visibleButtons.map((button) => button.getBoundingClientRect().top);
        return {
          tools: buttons.length,
          rowSpread: Math.max(...tops) - Math.min(...tops),
          clipsOverflow: getComputedStyle(scroller).overflowX === "hidden"
        };
      });
      expect(rail.tools).toBe(6);
      expect(rail.rowSpread, `the tool rail wrapped on ${viewport.name}`).toBeLessThan(2);
      expect(rail.clipsOverflow, `the primary toolbar exposed horizontal scrolling on ${viewport.name}`).toBe(true);
    });
  }
}

for (const viewport of [
  { width: 1440, height: 900, name: "desktop-1440" },
  { width: 2560, height: 1440, name: "desktop-2560" }
]) {
  test(`the workspace keeps a stable fixed toolbar at ${viewport.name}`, async ({ page }) => {
    await mockAuthenticatedWorkspace(page);
    await page.setViewportSize(viewport);
    await page.goto(ROUTE);
    await page.getByRole("button", { name: /Normal Study/ }).click();
    await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
    await auditViewport(page, viewport);
    await auditViewport(page, viewport);
    await expect(page.locator(".workspace-v2-toolbar")).toHaveCSS("overflow-x", "hidden");
  });
}

test("writing controls open immediately and preserve tool state while every secondary tool remains reachable", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  const pen = page.locator('.workspace-v2-toolbar [data-workspace-tool="pen"]');
  await pen.click();
  await page.getByRole("slider", { name: "Thickness" }).fill("9");
  await pen.click();
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await pen.click();
  await expect(page.getByRole("slider", { name: "Thickness" })).toHaveValue("9");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  for (const label of ["Image", "Text"]) await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  for (const label of ["Pencil", "Shapes"]) await expect(page.getByRole("dialog", { name: "Add to page" }).getByRole("button", { name: label, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add text annotation" })).toBeVisible();
  await page.getByRole("button", { name: "Close text editor" }).click();

  await page.getByRole("button", { name: "More workspace actions" }).click();
  for (const label of ["Pencil", "Shapes"]) await expect(page.getByRole("dialog", { name: "More workspace actions" }).getByRole("button", { name: new RegExp(`^${label} `) })).toBeVisible();
  for (const label of ["Highlight", "Eraser", "Lasso", "Bookmarks", "Full.screen", "settings"]) await expect(page.getByRole("button", { name: new RegExp(label, "i") })).toBeVisible();
  const toolbar = page.locator(".workspace-v2-toolbar");
  await expect.poll(async () => toolbar.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
});

test("the iPad toolbar keeps direct tools, quick colors, and Active Study usable in both themes", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  const toolbar = page.locator(".workspace-v2-toolbar");
  await expect(toolbar).toHaveCSS("border-radius", "26px");
  expect((await toolbar.boundingBox()).y).toBeGreaterThanOrEqual(34);
  await expect(toolbar.locator(".workspace-v3-quick-color")).toHaveCount(3);
  const sizing = await toolbar.evaluate((node) => {
    const boxes = [...node.querySelectorAll("button")].filter((button) => getComputedStyle(button).display !== "none").map((button) => ({ label: button.getAttribute("aria-label"), box: button.getBoundingClientRect() }));
    const rail = node.querySelector(".workspace-v3-primary").getBoundingClientRect();
    return {
      tooSmall: boxes.filter(({ box }) => box.width < 44 || box.height < 44).map(({ label }) => label),
      clipped: boxes.filter(({ box, label }) => label && box.left >= rail.left && box.left < rail.right && box.right > rail.right + 3).map(({ label }) => label),
      toolbarOverflow: node.scrollWidth - node.clientWidth
    };
  });
  expect(sizing.tooSmall).toEqual([]);
  expect(sizing.clipped).toEqual([]);
  expect(sizing.toolbarOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("ipad-portrait-night.png") });

  const pen = toolbar.getByRole("button", { name: "Pen", exact: true });
  if (await pen.getAttribute("aria-pressed") !== "true") await pen.click();
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await pen.click();
  await expect(page.getByRole("dialog", { name: "Pen options" })).toBeVisible();
  await expect.poll(() => page.locator("#workspace-pen-options").evaluate((node) => node.scrollTop)).toBe(0);
  await expect.poll(() => page.locator("#workspace-pen-options").evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("ipad-pen-options-night.png") });
  await expect(page.getByRole("group", { name: "Pen type" }).getByRole("button")).toHaveCount(3);
  await page.getByRole("button", { name: "Set thickness to 8" }).click();
  await expect(page.getByRole("slider", { name: "Thickness" })).toHaveValue("8");
  await page.getByText("Presets & pen gestures").click();
  await expect(page.getByRole("slider", { name: "Pressure sensitivity" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Stroke smoothing" })).toBeVisible();
  await page.keyboard.press("Escape");

  const color = toolbar.locator(".workspace-v3-quick-color").nth(1);
  await color.click();
  await expect(color).toHaveAttribute("aria-pressed", "true");
  const highlighter = toolbar.getByRole("button", { name: "Highlight", exact: true });
  await highlighter.click();
  await highlighter.click();
  await expect(page.getByRole("dialog", { name: "Highlight options" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Opacity" })).toBeVisible();
  await expect.poll(() => page.getByRole("dialog", { name: "Highlight options" }).evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("ipad-highlighter-options-night.png") });
  await page.keyboard.press("Escape");
  const eraser = toolbar.getByRole("button", { name: "Eraser", exact: true });
  await eraser.click();
  await eraser.click();
  await expect(eraser).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "Eraser options" })).toHaveCount(0);
  await expect(toolbar.locator(".workspace-v3-quick-color").first()).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("ipad-precision-eraser-night.png") });
  const lasso = toolbar.getByRole("button", { name: "Lasso", exact: true });
  await lasso.click();
  await lasso.click();
  await expect(page.getByRole("dialog", { name: "Lasso options" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Lasso mode" }).getByRole("button")).toHaveCount(2);
  await expect.poll(() => page.getByRole("dialog", { name: "Lasso options" }).evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("ipad-lasso-options-night.png") });
  await page.keyboard.press("Escape");
  const shapes = toolbar.getByRole("button", { name: "Shapes", exact: true });
  await shapes.click();
  await shapes.click();
  await expect(page.getByRole("dialog", { name: "Shape options" })).toBeVisible();
  await expect.poll(() => page.locator("#workspace-shapes-options").evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.getByRole("group", { name: "Shape type" }).getByRole("button")).toHaveCount(9);
  await expect.poll(() => page.getByRole("dialog", { name: "Shape options" }).evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("ipad-shapes-options-night.png") });
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "Add", exact: true }).click();
  const addMenu = page.getByRole("dialog", { name: "Add to page" });
  for (const label of ["Text", "Image", "Add Page"]) await expect(addMenu.getByRole("button", { name: label, exact: true })).toBeVisible();
  await expect(addMenu.getByRole("button", { name: "Pencil", exact: true })).toHaveCount(0);
  await expect(addMenu.getByRole("button", { name: "Shapes", exact: true })).toHaveCount(0);
  await expect(addMenu.getByRole("button", { name: /Open notes/ })).toBeVisible();
  await expect(addMenu.getByRole("button", { name: /Bookmark page/ })).toBeVisible();
  await expect.poll(() => addMenu.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("ipad-add-menu-night.png") });
  await page.keyboard.press("Escape");
  await expect(toolbar.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" })).toBeDisabled();
  await toolbar.getByRole("button", { name: "Open notes" }).click();
  await expect(page.locator("#workspace-notes-panel")).toBeVisible();
  await toolbar.getByRole("button", { name: "Close notes" }).click();
  await toolbar.getByRole("button", { name: "More workspace actions" }).click();
  await expect(page.getByRole("dialog", { name: "More workspace actions" })).toBeVisible();
  await expect.poll(() => page.getByRole("dialog", { name: "More workspace actions" }).evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("ipad-more-menu-night.png") });
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await expect(page.getByRole("dialog", { name: "Workspace settings" })).toBeVisible();
  await expect.poll(() => page.getByRole("dialog", { name: "Workspace settings" }).evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("ipad-settings-night.png") });
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "Choose study mode" }).click();
  await expect(page.getByRole("dialog", { name: /Choose study mode/i })).toBeVisible();
  await page.getByRole("button", { name: /Normal Study/ }).click();

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "day"; });
  await expect(toolbar.locator(".workspace-v2-tool-caption").first()).toBeVisible();
  await expect.poll(() => toolbar.locator(".workspace-v3-tool-button.is-active").evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect.poll(async () => toolbar.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("ipad-landscape-day.png") });
});

test("the contextual inspector overlays the reader and preserves page and zoom", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 41");
  const before = await page.locator(".workspace-v2-document-stage").evaluate((node) => ({ height: node.clientHeight, zoom: getComputedStyle(document.querySelector(".workspace-v2-a4-document")).getPropertyValue("--workspace-a4-zoom") }));
  const pen = page.locator('[data-workspace-tool="pen"]');
  await pen.click();
  await expect(page.getByRole("dialog", { name: "Pen options" })).toBeVisible();
  const opened = await page.locator(".workspace-v2-document-stage").evaluate((node) => ({ height: node.clientHeight, zoom: getComputedStyle(document.querySelector(".workspace-v2-a4-document")).getPropertyValue("--workspace-a4-zoom") }));
  expect(opened).toEqual(before);
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 41");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Pen options" })).toHaveCount(0);
  const closed = await page.locator(".workspace-v2-document-stage").evaluate((node) => ({ height: node.clientHeight, zoom: getComputedStyle(document.querySelector(".workspace-v2-a4-document")).getPropertyValue("--workspace-a4-zoom") }));
  expect(closed).toEqual(before);
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 41");
  await expect(pen).toBeFocused();
});

test("touch iPad uses pinch zoom without visible zoom controls", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 834, height: 1194 }, hasTouch: true });
  const page = await context.newPage();
  await mockAuthenticatedWorkspace(page);
  await page.goto(ROUTE);
  const continueInBrowser = page.getByRole("button", { name: "Continue in browser" });
  if (await continueInBrowser.isVisible().catch(() => false)) await continueInBrowser.click();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);
  await expect(page.locator(".workspace-v2-zoom-bar")).toBeHidden();
  await page.locator(".workspace-v2-page-number").click();
  await expect(page.locator(".workspace-v2-page-navigator .workspace-v2-zoom-control")).toBeHidden();
  await expect(page.locator(".workspace-v2-page-navigator .workspace-v4-zoom-presets")).toBeHidden();
  await context.close();
});
