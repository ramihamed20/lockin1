import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const WORKSPACE_ROUTE = "/#/materials/catalog/oral-histology/sheets/sheet-4/workspace";
const SHARED_TEST_SHEET_ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";
const SCREENSHOT_DIR = "output/playwright";

async function mockAuthenticatedWorkspace(page) {
  let catalogBookmarked = false;
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "focus-visual-student",
            email: "student@example.test",
            full_name: "Focus Student",
            preferred_language: "en",
            status: "active",
            is_email_verified: true,
            roles: ["student"],
            date_joined: "2026-01-01T00:00:00Z"
          }
        })
      });
      return;
    }
    if (pathname === "/api/v1/auth/csrf") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ csrf_token: "focus-workspace-csrf" }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } })
      });
      return;
    }
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    if (pathname.startsWith("/api/v1/bookmarks/catalog/")) {
      if (route.request().method() === "DELETE") {
        catalogBookmarked = false;
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (catalogBookmarked) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "catalog-bookmark", learning_object: null, catalog_material_slug: "oral-histology", catalog_material_title: "Oral Histology", catalog_sheet_slug: "sheet-4", catalog_sheet_title: "Sheet 4", position: { page: 1 }, created_at: "2026-01-01T00:00:00Z" }) });
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Bookmark not found" } }) });
      }
      return;
    }
    if (pathname === "/api/v1/bookmarks" && route.request().method() === "POST") {
      catalogBookmarked = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "catalog-bookmark", learning_object: null, ...route.request().postDataJSON(), created_at: "2026-01-01T00:00:00Z" }) });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found", message: "Not used by this visual test" } })
    });
  });
}

async function expectViewportOwnedWorkspace(page, width, height) {
  await page.setViewportSize({ width, height });
  const workspace = page.locator(".workspace-v2");
  await expect(workspace).toBeVisible();
  await expect.poll(async () => workspace.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      viewportHeight: Math.round(window.visualViewport?.height || window.innerHeight),
      bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })).toEqual({ width, height, viewportHeight: height, bodyOverflowX: 0 });
}

async function expectContainedInViewport(locator, width, height) {
  await expect.poll(async () => locator.evaluate((node, viewport) => {
    const bounds = node.getBoundingClientRect();
    return {
      contained: bounds.left >= -0.5 && bounds.top >= -0.5 && bounds.right <= viewport.width + 0.5 && bounds.bottom <= viewport.height + 0.5,
      overflowX: node.scrollWidth - node.clientWidth
    };
  }, { width, height })).toEqual({ contained: true, overflowX: 0 });
}

async function expectBoundsInViewport(locator, width, height) {
  await expect.poll(async () => locator.evaluate((node, viewport) => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= -0.5 && bounds.top >= -0.5 && bounds.right <= viewport.width + 0.5 && bounds.bottom <= viewport.height + 0.5;
  }, { width, height })).toBe(true);
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
});

test("Focus Workspace owns each production viewport and keeps panels contextual @chromium-only", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockAuthenticatedWorkspace(page);
  await page.addInitScript(() => {
    window.__workspaceWakeLock = { requests: 0, releases: 0 };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          window.__workspaceWakeLock.requests += 1;
          return {
            addEventListener() {},
            async release() { window.__workspaceWakeLock.releases += 1; }
          };
        }
      }
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(WORKSPACE_ROUTE);
  const studyDialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(studyDialog).toBeVisible();
  await expect(studyDialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".workspace-v2 > [aria-hidden='true']").first()).toBeAttached();
  for (const viewport of [
    { width: 390, height: 844, name: "phone" },
    { width: 834, height: 1194, name: "ipad" }
  ]) {
    await page.setViewportSize(viewport);
    await expectContainedInViewport(studyDialog, viewport.width, viewport.height);
    await expect.poll(async () => studyDialog.evaluate((node) => Math.round(node.getBoundingClientRect().height))).toBeLessThan(440);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-study-mode-${viewport.name}.png`, fullPage: false });
  }
  const normalStudy = studyDialog.getByRole("button", { name: /Normal Study/ });
  await expect(normalStudy).toBeEnabled();
  await normalStudy.click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => page.locator(".workspace-v2").evaluate((root) => {
    const canvases = [...root.querySelectorAll(".workspace-v2-a4-canvas")];
    return canvases.filter((canvas) => canvas.width > 0 && canvas.height > 0).length;
  })).toBeGreaterThan(0);
  const canvasMetrics = await page.locator(".workspace-v2").evaluate((root) => {
    const canvases = [...root.querySelectorAll(".workspace-v2-a4-canvas")];
    return {
      backedCanvases: canvases.filter((canvas) => canvas.width > 0 && canvas.height > 0).length,
      backingPixels: canvases.reduce((total, canvas) => total + canvas.width * canvas.height, 0)
    };
  });
  expect(canvasMetrics.backedCanvases).toBeLessThanOrEqual(8);
  expect(canvasMetrics.backingPixels).toBeLessThanOrEqual(64_000_000);
  await expectViewportOwnedWorkspace(page, 1440, 900);
  await expect(page.locator(".workspace-v2-header, .workspace-v2-tool-inspector, .workspace-v2-mobile-panel")).toHaveCount(0);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-desktop-1440x900.png`, fullPage: false });

  await expectViewportOwnedWorkspace(page, 1194, 834);
  await expect(page.getByRole("complementary", { name: "Workspace notes and actions" })).toBeHidden();
  const penTool = page.locator('[data-workspace-tool="pen"]');
  await penTool.click();
  await expect(penTool).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#workspace-pen-options")).toHaveCount(0);
  await penTool.click();
  const penOptions = page.locator("#workspace-pen-options");
  await expect(penOptions).toBeVisible();
  await expectBoundsInViewport(penOptions, 1194, 834);
  await expect(penOptions.getByRole("button", { name: "Ball Pen" })).toBeVisible();
  await expect(penOptions.getByRole("button", { name: "Brush Pen" })).toBeVisible();
  const penThickness = penOptions.getByRole("slider", { name: "Thickness" });
  const penOpacity = penOptions.getByRole("slider", { name: "Opacity" });
  await penThickness.fill("9");
  await penOpacity.fill("0.55");
  await expect(penThickness).toHaveValue("9");
  await expect(penOpacity).toHaveValue("0.55");
  await expect(penOptions.getByText("Scribble erase")).toHaveCount(0);
  const settingsButton = page.getByRole("button", { name: "Workspace settings", exact: true });
  await expect(page.getByRole("button", { name: "Enter full screen" })).toHaveCount(0);
  await settingsButton.click();
  await expect(penOptions).toHaveCount(0);
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("switch", { name: /Scribble erase/ })).toBeVisible();
  await expect(settings.getByRole("switch", { name: /Hold to shape/ })).toBeVisible();
  await expect(settings.getByRole("switch", { name: /Circle erase/ })).toBeVisible();
  await expect(settings.getByRole("switch", { name: /Remember last position/ })).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByRole("switch", { name: /Remember zoom level/ })).toHaveAttribute("aria-checked", "true");
  const pageNumberToggle = settings.getByRole("switch", { name: /Show page number/ });
  await expect(page.locator(".workspace-v2-page-number")).toBeVisible();
  await pageNumberToggle.click();
  await expect(page.locator(".workspace-v2-page-number")).toHaveCount(0);
  await pageNumberToggle.click();
  await expect(page.locator(".workspace-v2-page-number")).toBeVisible();
  const wakeToggle = settings.getByRole("switch", { name: /Keep screen awake/ });
  await wakeToggle.click();
  await expect.poll(async () => page.evaluate(() => window.__workspaceWakeLock.requests)).toBe(1);
  await wakeToggle.click();
  await expect.poll(async () => page.evaluate(() => window.__workspaceWakeLock.releases)).toBeGreaterThan(0);
  const stageForFit = page.locator(".workspace-v2-document-stage");
  const fitPoint = await stageForFit.boundingBox();
  await stageForFit.dispatchEvent("wheel", { bubbles: true, cancelable: true, clientX: fitPoint.x + fitPoint.width / 2, clientY: fitPoint.y + 160, ctrlKey: true, deltaY: -120 });
  await expect.poll(async () => page.locator(".workspace-v2-a4-live-layer").evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(fitPoint.width + 20);
  await settings.getByRole("button", { name: /Fit Width/ }).click();
  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return Math.abs(stage.width - pdf.width);
  })).toBeLessThan(1.5);
  await expect(settings.getByRole("button", { name: /Enter fullscreen/ })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-settings-ipad-landscape.png`, fullPage: false });
  await settingsButton.click();
  await expect(settings).toHaveCount(0);
  const notesTool = page.locator('[data-workspace-tool="note"]');
  await notesTool.click();
  const sidePanel = page.getByRole("complementary", { name: "Workspace notes and actions" });
  await expect(sidePanel).toBeVisible();
  await expectContainedInViewport(sidePanel, 1194, 834);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-ipad-landscape-1194x834.png`, fullPage: false });
  await notesTool.click();
  await expect(sidePanel).toBeHidden();

  await expectViewportOwnedWorkspace(page, 834, 1194);
  const highlighterTool = page.locator('[data-workspace-tool="highlighter"]');
  await highlighterTool.click();
  await expect(page.locator("#workspace-highlighter-options")).toHaveCount(0);
  await highlighterTool.click();
  const highlighterOptions = page.locator("#workspace-highlighter-options");
  await expect(highlighterOptions).toBeVisible();
  await expectBoundsInViewport(highlighterOptions, 834, 1194);
  await expect(page.getByRole("button", { name: "Use #8b5cf6" })).toHaveCSS("width", "44px");
  await expect(highlighterOptions.getByRole("slider", { name: "Thickness" })).toBeVisible();
  await expect(highlighterOptions.getByRole("slider", { name: "Opacity" })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-ipad-portrait-834x1194.png`, fullPage: false });
  await page.getByRole("button", { name: "Close Highlight options" }).click();

  const lassoTool = page.locator('[data-workspace-tool="select"]');
  await lassoTool.click();
  await lassoTool.click();
  const lassoOptions = page.locator("#workspace-select-options");
  await expect(lassoOptions).toBeVisible();
  await expect(lassoOptions.locator(".workspace-v2-colors")).toHaveCount(0);
  await expect(lassoOptions.getByRole("button", { name: "Freeform lasso" })).toBeVisible();
  await page.getByRole("button", { name: "Close Lasso options" }).click();

  const shapeTool = page.locator('[data-workspace-tool="shapes"]');
  await shapeTool.click();
  await shapeTool.click();
  const shapeOptions = page.locator("#workspace-shapes-options");
  await expect(shapeOptions.getByRole("button", { name: "Rectangle" })).toBeVisible();
  await expect(shapeOptions.getByRole("button", { name: "Circle" })).toBeVisible();
  await expect(shapeOptions.getByRole("button", { name: "Triangle" })).toBeVisible();
  await page.getByRole("button", { name: "Close Shape options" }).click();

  await expectViewportOwnedWorkspace(page, 844, 390);
  await expect(page.locator(".workspace-v2-toolbar")).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-iphone-landscape-844x390.png`, fullPage: false });

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 810, height: 1080 },
    { width: 820, height: 1180 },
    { width: 1024, height: 1366 },
    { width: 1024, height: 768 }
  ]) {
    await expectViewportOwnedWorkspace(page, viewport.width, viewport.height);
    await expect(page.locator(".workspace-v2-toolbar")).toBeVisible();
  }

  await expectViewportOwnedWorkspace(page, 390, 844);
  await penTool.click();
  await expect(page.locator("#workspace-pen-options")).toHaveCount(0);
  await penTool.click();
  await expect(penOptions).toBeVisible();
  await expectBoundsInViewport(penOptions, 390, 844);
  for (const color of ["#123456", "#234567", "#345678", "#456789", "#56789a"]) {
    await penOptions.getByRole("button", { name: "Add Color" }).click();
    await penOptions.locator('input[aria-label="Choose custom color"]').fill(color);
    await penOptions.getByRole("button", { name: "Save custom color" }).click();
    await expect(penOptions.getByRole("button", { name: `Use ${color}` })).toHaveCount(1);
  }
  await expect(penOptions.getByRole("button", { name: "Add Color" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.recent-colors.v1") || "[]").length)).toBe(5);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-pen-colors-phone.png`, fullPage: false });
  await penOptions.getByRole("button", { name: "Use #123456" }).click();
  await penOptions.getByRole("button", { name: "Delete #123456" }).click();
  await expect(penOptions.getByRole("button", { name: "Use #123456" })).toHaveCount(0);
  await expect(penOptions.getByRole("button", { name: "Add Color" })).toBeVisible();
  await expect(penOptions.getByRole("button", { name: "Use #8b5cf6" })).toHaveAttribute("aria-pressed", "true");
  await penOptions.getByRole("button", { name: "Add Color" }).click();
  await penOptions.locator('input[aria-label="Choose custom color"]').fill("#6789ab");
  await penOptions.getByRole("button", { name: "Save custom color" }).click();
  await expect(penOptions.getByRole("button", { name: "Add Color" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.recent-colors.v1") || "[]").length)).toBe(5);
  await page.reload();
  await expect(studyDialog).toBeVisible();
  await studyDialog.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await penTool.click();
  await penTool.click();
  await expect(penOptions.getByRole("button", { name: "Use #123456" })).toHaveCount(0);
  await expect(penOptions.getByRole("button", { name: "Use #6789ab" })).toHaveCount(1);
  await expect(penOptions.getByRole("slider", { name: "Thickness" })).toHaveValue("9");
  await expect(penOptions.getByRole("slider", { name: "Opacity" })).toHaveValue("0.55");
  await expect(page.locator('[data-workspace-tool="text"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Close Pen options" }).click();
  const bookmark = page.getByRole("button", { name: "Save to Bookmarks" });
  await bookmark.click();
  await expect(page.getByRole("button", { name: "Remove from Bookmarks" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Remove from Bookmarks" }).click();
  await expect(page.getByRole("button", { name: "Save to Bookmarks" })).toHaveAttribute("aria-pressed", "false");
  await notesTool.click();
  await expect(sidePanel).toBeVisible();
  await expectContainedInViewport(sidePanel, 390, 844);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-iphone-portrait-390x844.png`, fullPage: false });
  await notesTool.click();
  await expect(sidePanel).toBeHidden();

  expect(pageErrors).toEqual([]);
});

test("PDF view preferences restore position and zoom only while enabled @chromium-only", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("workspace-view-seeded")) return;
    sessionStorage.setItem("workspace-view-seeded", "true");
    localStorage.setItem("lock-in.catalog-workspace.settings.v1", JSON.stringify({ rememberLastPosition: true, rememberZoomLevel: true, showPageNumber: true }));
    localStorage.setItem("lock-in.catalog-workspace.v1.oral-histology.sheet-4", JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      page: 3,
      zoom: 2.2,
      // The scale 2.2 was reached against this fit-to-width basis (834px of
      // stage over a 595px A4 page). The reader restores the magnification the
      // basis describes, so on this same viewport it resolves back to 2.2.
      zoomFitBasis: 834 / 595,
      scrollLeft: 140,
      scrollTop: 2800,
      pageOffset: .25,
      annotations: [],
      notes: []
    }));
  });
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(WORKSPACE_ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "Page 3 of 16");
  await expect.poll(async () => page.locator(".workspace-v2-a4-document").evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--workspace-a4-zoom")))).toBeCloseTo(2.2, 5);
  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const thirdPage = document.querySelector('[data-pdf-page="3"]').getBoundingClientRect();
    return Math.abs((stage.top - thirdPage.top) / thirdPage.height - .25);
  })).toBeLessThan(.03);

  await page.getByRole("button", { name: "Workspace settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await settings.getByRole("switch", { name: /Remember last position/ }).click();
  await settings.getByRole("switch", { name: /Remember zoom level/ }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.settings.v1")))).toMatchObject({ rememberLastPosition: false, rememberZoomLevel: false });
  await page.reload();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "Page 1 of 16");
  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return Math.abs(stage.width - pdf.width);
  })).toBeLessThan(1.5);
});

test("the shared Oral Histology test PDF renders in a regular catalogue sheet", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockAuthenticatedWorkspace(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(SHARED_TEST_SHEET_ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.getByRole("link", { name: "Open original PDF in a new tab" })).toHaveCount(0);

  const canvas = page.locator(".workspace-v2-a4-canvas.is-visible").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => canvas.evaluate((node) => {
    const context = node.getContext("2d", { willReadFrequently: true });
    if (!context || !node.width || !node.height) return false;
    const pixels = context.getImageData(0, 0, node.width, node.height).data;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) return true;
    }
    return false;
  }), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => page.locator(".workspace-v2-a4-page").first().evaluate((pageNode) => {
    const stage = pageNode.closest(".workspace-v2-document-stage");
    if (!stage) return false;
    const pageBounds = pageNode.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    return pageBounds.width <= stageBounds.width + 1 && pageBounds.height > pageBounds.width;
  })).toBe(true);

  const pageShell = page.locator(".workspace-v2-a4-page").first();
  const beforeZoom = await pageShell.boundingBox();
  await page.locator(".workspace-v2-document-stage").dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: beforeZoom.x + beforeZoom.width / 2,
    clientY: beforeZoom.y + beforeZoom.height / 2,
    ctrlKey: true,
    deltaY: -100
  });
  await expect.poll(async () => (await pageShell.boundingBox()).width / beforeZoom.width).toBeGreaterThan(1.02);
  const wheelZoomRatio = (await pageShell.boundingBox()).width / beforeZoom.width;
  expect(wheelZoomRatio).toBeLessThan(1.09);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-shared-test-sheet-1280x800.png`, fullPage: false });
  expect(pageErrors).toEqual([]);
});
