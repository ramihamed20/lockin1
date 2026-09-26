import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const WORKSPACE_ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace";
const SHARED_TEST_SHEET_ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
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
    // The workspace sits behind the subscription gate, so the access contract
    // has to answer before the reader renders.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    if (pathname.startsWith("/api/v1/focus/managed-active-study/sheets/") && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ difficulties: ["easy", "medium", "hard"].map((difficulty) => ({ difficulty, status: "ready" })) }) });
      return;
    }
    if (pathname === "/api/v1/focus/managed-active-study/start" && route.request().method() === "POST") {
      const { difficulty = "medium" } = route.request().postDataJSON() || {};
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ resumed: false, run: { id: "visual-active-run", difficulty, status: "active", stage: "reading", current_part: 1, number_of_parts: 4, current_page_range: { start_page: 1, end_page: 10 } } }) });
      return;
    }
    if (pathname.startsWith("/api/v1/bookmarks/catalog/")) {
      if (route.request().method() === "DELETE") {
        catalogBookmarked = false;
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (catalogBookmarked) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "catalog-bookmark", learning_object: null, catalog_material_slug: "biochemistry-1", catalog_material_title: "Biochemistry 1", catalog_sheet_slug: "vitamin-2", catalog_sheet_title: "Vitamin -2", position: { page: 1 }, created_at: "2026-01-01T00:00:00Z" }) });
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

  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-desktop-write-1440x900.png`, fullPage: false });

  await expectViewportOwnedWorkspace(page, 1194, 834);
  await expect(page.getByRole("complementary", { name: "Workspace notes and actions" })).toBeHidden();
  const penTool = page.locator('[data-workspace-tool="pen"]');
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
  await expect(page.getByRole("button", { name: "Enter full screen" })).toHaveCount(0);
  await page.getByRole("button", { name: "More workspace actions" }).click();
  const settingsButton = page.getByRole("button", { name: "Workspace settings", exact: true });
  await settingsButton.click();
  await expect(penOptions).toHaveCount(0);
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("switch", { name: /Scribble to erase/ })).toBeVisible();
  await expect(settings.getByRole("switch", { name: /Perfect shapes on release/ })).toBeVisible();
  await settings.getByRole("button", { name: /Gestures Touch and shortcuts/ }).click();
  await expect(settings.getByRole("switch", { name: /Circle to erase/ })).toBeVisible();
  await settings.getByRole("button", { name: /Workspace Pages and study tools/ }).click();
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
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-settings-ipad-landscape.png`, fullPage: false });
  const stageForFit = page.locator(".workspace-v2-document-stage");
  const fitPoint = await stageForFit.boundingBox();
  await stageForFit.dispatchEvent("wheel", { bubbles: true, cancelable: true, clientX: fitPoint.x + fitPoint.width / 2, clientY: fitPoint.y + 160, ctrlKey: true, deltaY: -120 });
  await expect.poll(async () => page.locator(".workspace-v2-a4-live-layer").evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(fitPoint.width + 20);
  await settings.getByRole("button", { name: "Close workspace settings" }).click();
  await page.getByRole("button", { name: "Fit width", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return Math.abs(stage.width - pdf.width);
  })).toBeLessThan(1.5);
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
  const highlighterTool = page.locator('button[data-workspace-tool="highlighter"]');
  await highlighterTool.click();
  await expect(page.locator("#workspace-highlighter-options")).toHaveCount(0);
  await highlighterTool.click();
  const highlighterOptions = page.locator("#workspace-highlighter-options");
  await expect(highlighterOptions).toBeVisible();
  await expectBoundsInViewport(highlighterOptions, 834, 1194);
  await expect(highlighterOptions.getByRole("button", { name: "Use #8b5cf6" })).toHaveCSS("width", "44px");
  await expect(highlighterOptions.getByRole("slider", { name: "Thickness" })).toBeVisible();
  await expect(highlighterOptions.getByRole("slider", { name: "Opacity" })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-ipad-portrait-834x1194.png`, fullPage: false });
  await highlighterTool.click();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-ipad-portrait-write-834x1194.png`, fullPage: false });

  const lassoTool = page.locator('button[data-workspace-tool="select"]');
  await lassoTool.click();
  await lassoTool.click();
  const lassoOptions = page.locator("#workspace-select-options");
  await expect(lassoOptions).toBeVisible();
  await expect(lassoOptions.locator(".workspace-v2-colors")).toHaveCount(0);
  await expect(lassoOptions.getByRole("button", { name: "Freeform lasso" })).toBeVisible();
  await lassoTool.click();

  const shapeTool = page.locator('.workspace-v2-toolbar [data-workspace-tool="shapes"]');
  await page.getByRole("button", { name: "Add" }).click();
  await shapeTool.click();
  await page.getByRole("button", { name: "Add" }).click();
  await shapeTool.click();
  const shapeOptions = page.locator("#workspace-shapes-options");
  await expect(shapeOptions.getByRole("button", { name: "Rectangle" })).toBeVisible();
  await expect(shapeOptions.getByRole("button", { name: "Circle" })).toBeVisible();
  await expect(shapeOptions.getByRole("button", { name: "Triangle" })).toBeVisible();
  await page.keyboard.press("Escape");

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
  for (const color of ["#123456", "#234567"]) {
    await penOptions.getByRole("button", { name: "Add Color" }).click();
    await penOptions.locator('input[aria-label="Choose custom color"]').fill(color);
    await penOptions.getByRole("button", { name: "Save custom color" }).click();
    await expect(penOptions.getByRole("button", { name: `Use ${color}` })).toHaveCount(1);
  }
  await expect(penOptions.getByRole("button", { name: "Add Color" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.recent-colors.v1") || "[]").length)).toBe(2);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-pen-colors-phone.png`, fullPage: false });
  await penOptions.getByRole("button", { name: "Use #123456" }).click();
  await penOptions.getByRole("button", { name: "Delete #123456" }).click();
  await expect(penOptions.getByRole("button", { name: "Use #123456" })).toHaveCount(0);
  await expect(penOptions.getByRole("button", { name: "Add Color" })).toBeVisible();
  await expect(penOptions.getByRole("button", { name: "Use #2196f3" })).toHaveAttribute("aria-pressed", "true");
  await penOptions.getByRole("button", { name: "Add Color" }).click();
  await penOptions.locator('input[aria-label="Choose custom color"]').fill("#6789ab");
  await penOptions.getByRole("button", { name: "Save custom color" }).click();
  await expect(penOptions.getByRole("button", { name: "Add Color" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.recent-colors.v1") || "[]").length)).toBe(2);
  await page.reload();
  await expect(studyDialog).toBeVisible();
  await studyDialog.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await penTool.click();
  await expect(penOptions.getByRole("button", { name: "Use #123456" })).toHaveCount(0);
  await expect(penOptions.getByRole("button", { name: "Use #6789ab" })).toHaveCount(1);
  await expect(penOptions.getByRole("slider", { name: "Thickness" })).toHaveValue("9");
  await expect(penOptions.getByRole("slider", { name: "Opacity" })).toHaveValue("0.55");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator('[data-workspace-tool="text"]')).toBeVisible();
  await page.getByRole("button", { name: "Close Add menu" }).click();
  await page.locator('[data-workspace-tool="pen"]').click();
  await page.getByRole("button", { name: "More workspace actions" }).click();
  const bookmark = page.getByRole("button", { name: "Save to Bookmarks" });
  await bookmark.click();
  await expect(page.getByRole("button", { name: "Remove from Bookmarks" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Remove from Bookmarks" }).click();
  await expect(page.getByRole("button", { name: "Save to Bookmarks" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "More workspace actions" }).click();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-iphone-portrait-390x844.png`, fullPage: false });
  await notesTool.click();
  await expect(sidePanel).toBeVisible();
  await expectContainedInViewport(sidePanel, 390, 844);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-iphone-portrait-notes-390x844.png`, fullPage: false });
  await notesTool.click();
  await expect(sidePanel).toBeHidden();

  expect(pageErrors).toEqual([]);
});

test("Active Study reading chrome and checkpoint remain unobstructed @chromium-only", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(SHARED_TEST_SHEET_ROUTE);
  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Start Active Study/ }).click();
  await expect(page.getByRole("button", { name: "Active Study: part 1 of 4" })).toBeVisible();
  const checkpoint = page.locator(".workspace-v2-checkpoint-dock");
  await expect(checkpoint).toBeVisible();
  await expect(page.getByRole("button", { name: "Reach page 10 to unlock the checkpoint" })).toBeVisible();
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]").first()).toBeVisible();
  const sourcePageCount = await page.locator(".workspace-v2-a4-page[data-pdf-page]").count();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Add Page" }).click();
  await page.getByRole("dialog", { name: "Choose workspace page background" }).getByRole("button", { name: /Blank/ }).click();
  await expect(page.locator(".workspace-v2-a4-page.is-virtual")).toHaveCount(1);
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]")).toHaveCount(sourcePageCount);
  await expect(page.getByRole("button", { name: "Reach page 10 to unlock the checkpoint" })).toBeVisible();
  const overlap = await page.evaluate(() => {
    const dock = document.querySelector(".workspace-v2-checkpoint-dock")?.getBoundingClientRect();
    const pageDock = document.querySelector(".workspace-v2-page-dock")?.getBoundingClientRect();
    const toolbar = document.querySelector(".workspace-v2-toolbar")?.getBoundingClientRect();
    const intersects = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return { pageDock: intersects(dock, pageDock), toolbar: intersects(dock, toolbar) };
  });
  expect(overlap).toEqual({ pageDock: false, toolbar: false });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-active-study-reading-834x1194.png`, fullPage: false });
});

test("Active Study can restart saved progress from Part 1 without changing the PDF", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let restartRequests = 0;
  await page.route("**/api/v1/focus/managed-active-study/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.includes("/sheets/") && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        difficulties: ["easy", "medium", "hard"].map((difficulty) => ({
          difficulty, status: "ready", progress: difficulty === "medium" ? {
            id: "saved-active-run", difficulty, status: "active", stage: "reading",
            current_part: 3, number_of_parts: 4, completed_parts: [1, 2]
          } : null
        }))
      }) });
      return;
    }
    if (pathname.endsWith("/saved-active-run/restart") && route.request().method() === "POST") {
      restartRequests += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ run: {
        id: "fresh-active-run", difficulty: "medium", status: "active", stage: "reading",
        current_part: 1, number_of_parts: 4, completed_parts: [], current_page_range: { start_page: 1, end_page: 10 }
      } }) });
      return;
    }
    await route.fallback();
  });
  await page.goto(SHARED_TEST_SHEET_ROUTE);
  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog.getByRole("button", { name: "Restart Medium from the beginning" })).toBeVisible();
  await dialog.getByRole("button", { name: "Restart Medium from the beginning" }).click();
  await expect(dialog.getByText(/Your PDF notes and annotations stay/)).toBeVisible();
  await dialog.getByRole("button", { name: "Restart from Part 1" }).click();
  await expect(page.getByRole("button", { name: "Active Study: part 1 of 4" })).toBeVisible();
  await expect(page.locator(".workspace-v2-a4-page[data-pdf-page]").first()).toBeVisible();
  expect(restartRequests).toBe(1);
});

test("PDF sheets open at page one and restore zoom only while enabled @chromium-only", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.setItem("lock-in.catalog-workspace.settings.v1", JSON.stringify({ rememberLastPosition: true, rememberZoomLevel: true, showPageNumber: true }));
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("lock-in-workspace", 1);
      request.onupgradeneeded = () => {
        const nextDatabase = request.result;
        if (!nextDatabase.objectStoreNames.contains("documents")) nextDatabase.createObjectStore("documents", { keyPath: "id" });
        if (!nextDatabase.objectStoreNames.contains("pages")) {
          const pages = nextDatabase.createObjectStore("pages", { keyPath: "id" });
          pages.createIndex("documentId", "documentId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("documents", "readwrite");
    transaction.objectStore("documents").put({
      id: "user:focus-visual-student::biochemistry-1::vitamin-2",
      owner: "user:focus-visual-student",
      materialSlug: "biochemistry-1",
      sheetSlug: "vitamin-2",
      version: 1,
      savedAt: new Date().toISOString(),
      view: {
        page: 3,
        zoom: 2.2,
        // The scale 2.2 was reached against this fit-to-width basis (834px of
        // stage over a 595px A4 page). The reader restores the magnification the
        // basis describes, so on this same viewport it resolves back to 2.2.
        zoomFitBasis: 834 / 595,
        scrollLeft: 140,
        scrollTop: 2800,
        pageOffset: .25
      },
      notes: []
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(WORKSPACE_ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  // A sheet always opens at its visual beginning: the stored view keeps its
  // page and offset for backup, but never moves the reader. Zoom is still
  // restored while "Remember zoom level" is on.
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 17");
  await expect.poll(async () => page.locator(".workspace-v2-a4-document").evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--workspace-a4-zoom")))).toBeCloseTo(2.2, 5);
  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const firstPage = document.querySelector('[data-pdf-page="1"]').getBoundingClientRect();
    const paddingTop = Number.parseFloat(getComputedStyle(stage).paddingTop) || 0;
    return Math.abs(firstPage.top - (stage.getBoundingClientRect().top + paddingTop));
  })).toBeLessThan(2);

  await page.getByRole("button", { name: "More workspace actions" }).click();
  await page.getByRole("button", { name: "Workspace settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await settings.getByRole("button", { name: /Workspace Pages and study tools/ }).click();
  await settings.getByRole("switch", { name: /Remember last position/ }).click();
  await settings.getByRole("switch", { name: /Remember zoom level/ }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.settings.v1")))).toMatchObject({ rememberLastPosition: false, rememberZoomLevel: false });
  await page.reload();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "PDF page 1 of 17");
  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return Math.abs(stage.width - pdf.width);
  })).toBeLessThan(1.5);
});

test("a published catalogue sheet renders its PDF and zooms with the wheel", async ({ page }) => {
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
    return pageBounds.width <= stageBounds.width + 1 && pageBounds.height > 0;
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

  await page.screenshot({ path: `${SCREENSHOT_DIR}/focus-published-sheet-1280x800.png`, fullPage: false });
  expect(pageErrors).toEqual([]);
});

test("an Active Study checkpoint asks before closing, saves or discards only the attempt, restarts, and explains misses", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const questions = [
    { question: "Which vitamin is fat-soluble?", options: { A: "Vitamin C", B: "Vitamin K", C: "Vitamin B1", D: "Vitamin B12" }, correct: "B", explanation: "Vitamins A, D, E and K are fat-soluble." },
    { question: "Scurvy is caused by a lack of…", options: { A: "Vitamin C", B: "Vitamin D", C: "Vitamin A", D: "Iron" }, correct: "A", explanation: "Vitamin C is needed for collagen synthesis." }
  ];
  const run = { id: "checkpoint-run", difficulty: "medium", status: "active", stage: "checkpoint", current_part: 2, number_of_parts: 4, completed_parts: [1], current_page_range: { start_page: 11, end_page: 20 } };
  let attempt = 1;
  let serverAnswers = {};
  const calls = [];
  await page.route("**/api/v1/focus/managed-active-study/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/focus/managed-active-study/start") return json({ resumed: true, run });
    if (!pathname.includes("/checkpoint-run/")) return route.fallback();
    calls.push(pathname.split("/").pop());
    if (pathname.endsWith("/questions")) {
      return json({ run, attempt_id: `attempt-${attempt}`, kind: "checkpoint", questions: questions.map((item, index) => ({ position: index + 1, question: item.question, options: item.options, answered: serverAnswers[index + 1] || null })) });
    }
    if (pathname.endsWith("/discard-attempt")) {
      serverAnswers = {};
      attempt += 1;
      return json({ run });
    }
    if (pathname.endsWith("/answer")) {
      const body = route.request().postDataJSON();
      serverAnswers[body.position] = body.selected_answer;
      const item = questions[body.position - 1];
      return json({ correct: body.selected_answer === item.correct, correct_answer: item.correct, explanation: item.explanation, answered_count: Object.keys(serverAnswers).length, total: questions.length });
    }
    if (pathname.endsWith("/submit")) {
      return json({ run: { ...run, stage: "checkpoint_result" }, result: { score: 1, total: 2, passed: false, xp_awarded: 0 } });
    }
    return json({ run });
  });
  await page.goto(SHARED_TEST_SHEET_ROUTE);
  await page.getByRole("dialog", { name: "Choose study mode" }).getByRole("button", { name: /Start Active Study/ }).click();
  const openCheckpoint = () => page.getByRole("button", { name: "Open checkpoint" }).click();
  const quiz = page.getByRole("dialog", { name: /Which vitamin|Scurvy/ });
  const exit = page.getByRole("alertdialog", { name: "Leave this checkpoint?" });

  // Answer question 1, move on, then try to close: the student is asked first.
  await openCheckpoint();
  await quiz.getByRole("radio", { name: /Vitamin C/ }).click();
  await quiz.getByRole("button", { name: /Next/ }).click();
  await expect(quiz.getByText("Question 2 of 2")).toBeVisible();
  await quiz.getByRole("button", { name: "Close test" }).click();
  await expect(exit.getByRole("button")).toHaveText(["Cancel", "Exit Without Saving", "Exit & Save"]);
  await exit.getByRole("button", { name: "Cancel" }).click();
  await expect(quiz.getByText("Question 2 of 2")).toBeVisible();

  // Exit & Save: reopening resumes on question 2 with question 1 still chosen.
  await page.keyboard.press("Escape");
  await exit.getByRole("button", { name: "Exit & Save" }).click();
  await expect(quiz).toHaveCount(0);
  await openCheckpoint();
  await expect(quiz.getByText("Question 2 of 2")).toBeVisible();
  await expect(quiz.getByText("1 of 2 answered")).toBeVisible();
  expect(calls).not.toContain("discard-attempt");

  // Restart asks, then clears the attempt and starts at question 1.
  await quiz.getByRole("button", { name: "Restart" }).click();
  await page.getByRole("alertdialog", { name: "Restart this checkpoint?" }).getByRole("button", { name: "Restart" }).click();
  await expect(quiz.getByText("Question 1 of 2")).toBeVisible();
  await expect(quiz.getByText("0 of 2 answered")).toBeVisible();
  expect(calls.filter((call) => call === "discard-attempt")).toHaveLength(1);

  // Back is caught; Exit Without Saving throws away this attempt only.
  await quiz.getByRole("radio", { name: /Vitamin K/ }).click();
  await page.goBack();
  await expect(exit).toBeVisible();
  await exit.getByRole("button", { name: "Exit Without Saving" }).click();
  await expect(quiz).toHaveCount(0);
  expect(calls.filter((call) => call === "discard-attempt")).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Active Study: part 2 of 4" })).toBeVisible();
  await openCheckpoint();
  await expect(quiz.getByText("0 of 2 answered")).toBeVisible();

  // Submit with one miss: the result offers that question's explanation.
  await quiz.getByRole("radio", { name: /Vitamin C/ }).click();
  await quiz.getByRole("button", { name: /Next/ }).click();
  await quiz.getByRole("radio", { name: /Vitamin C/ }).click();
  await quiz.getByRole("button", { name: "Submit test" }).click();
  const result = page.getByRole("dialog", { name: "1 / 2" });
  const missed = result.getByRole("list", { name: "Missed questions" });
  await expect(missed.getByText(questions[0].question)).toBeVisible();
  await expect(missed.getByText(questions[1].question)).toHaveCount(0);
  await expect(missed.getByText(questions[0].explanation)).toHaveCount(0);
  await missed.getByRole("button", { name: "Explanation" }).click();
  await expect(missed.getByText(questions[0].explanation)).toBeVisible();
});
