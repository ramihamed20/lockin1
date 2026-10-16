import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { PERFORMANCE_CATALOG_MATERIALS } from "../scripts/fixtures/performance-catalog.mjs";

test.use({ serviceWorkers: "block", viewport: { width: 834, height: 1194 } });

async function setup(page, holdStorage, preferredLanguage = "en") {
  await page.addInitScript((held) => {
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    if (!held) return;
    const releases = [];
    window.__releaseWorkspaceOpen = () => {
      window.__workspaceOpenReleased = true;
      for (const release of releases.splice(0)) release();
    };
    const originalOpen = IDBFactory.prototype.open;
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess");
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      const request = originalGet.apply(this, args);
      if (this.name === "documents" && this.transaction.db.name === "lock-in-workspace" && String(args[0]).includes("hydration-student")) {
        request.addEventListener("success", () => requestAnimationFrame(() => requestAnimationFrame(() => { window.__workspaceDocumentReadSettled = true; })));
      }
      return request;
    };
    IDBFactory.prototype.open = function (...args) {
      const request = originalOpen.apply(this, args);
      if (args[0] !== "lock-in-workspace") return request;
      // Hold only the database-open promise. Reads retain their native event
      // and transaction lifetimes; delaying a get callback would invalidate it.
      let handler;
      Object.defineProperty(request, "onsuccess", {
        configurable: true,
        get: () => handler,
        set: (next) => {
          handler = next;
          descriptor.set.call(request, (event) => {
            const release = () => {
              descriptor.set.call(request, next);
              next.call(request, event);
            };
            if (window.__workspaceOpenReleased) release();
            else {
              window.__workspaceOpenHeld = true;
              releases.push(release);
            }
          });
        }
      });
      return request;
    };
  }, holdStorage);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") return route.fulfill({ json: { user: { id: "hydration-student", email: "hydration@example.test", full_name: "Synthetic Student", preferred_language: preferredLanguage, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } } });
    if (pathname === "/api/v1/operations/session") return route.fulfill({ status: 403, json: { error: { code: "permission_denied", message: "Synthetic student" } } });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/catalog/materials") return route.fulfill({ json: { count: PERFORMANCE_CATALOG_MATERIALS.length, results: PERFORMANCE_CATALOG_MATERIALS } });
    if (pathname === "/api/v1/focus/lock-in") return route.fulfill({ json: { active_session: null } });
    return route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } });
  });
  await page.goto("/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace");
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20000 });
}

async function drawWithMouse(page) {
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await page.keyboard.press("Escape");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + 260;
  await page.mouse.move(bounds.x + bounds.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.5, y + 20, { steps: 8 });
  await page.mouse.move(bounds.x + bounds.width * 0.7, y + 15, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("[data-annotation-id]")).toHaveCount(1);
  return page.locator("[data-annotation-id]").getAttribute("data-annotation-id");
}

test("control: native mouse writing commits after ordinary workspace initialization", async ({ page }) => {
  await setup(page, false);
  await drawWithMouse(page);
});

test("saved-state initialization gates editing while PDF paint and exit remain available", async ({ page }) => {
  test.setTimeout(60000);
  await setup(page, true);
  await page.waitForFunction(() => window.__workspaceOpenHeld === true);
  const workspace = page.locator("main.workspace-v2");
  try {
    await expect(workspace).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".workspace-v2-hydration-status")).toHaveText("Restoring your saved work…");
    await expect(page.locator('button[data-workspace-tool="pen"]')).toBeDisabled();
    await expect(page.getByRole("button", { name: "Exit Workspace", exact: true })).toBeEnabled();
    await expect(page.locator('.workspace-v2-document-stage')).toHaveAttribute("inert", "");
    // Real browser input while pending cannot create a draft that hydration erases.
    const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + 260);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + 280, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-annotation-id]")).toHaveCount(0);
    await page.evaluate(() => window.__releaseWorkspaceOpen());
    await expect(workspace).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".workspace-v2-hydration-status")).toHaveCount(0);
    const id = await drawWithMouse(page);
    await expect.poll(() => page.evaluate(async (annotationId) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("lock-in-workspace");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const records = await new Promise((resolve, reject) => {
          const request = database.transaction("pages", "readonly").objectStore("pages").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return records.some((record) => record.annotations?.some((annotation) => annotation.id === annotationId));
      } finally { database.close(); }
    }, id), { timeout: 15000 }).toBe(true);
    await page.reload();
    await page.waitForFunction(() => window.__workspaceOpenHeld === true);
    await page.evaluate(() => window.__releaseWorkspaceOpen());
    await expect(workspace).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(`[data-annotation-id="${id}"]`)).toHaveCount(1);
  } finally {
    await page.evaluate(() => window.__releaseWorkspaceOpen?.()).catch(() => undefined);
  }
});

test("Arabic phone restoration is visible and keyboard navigation skips pending editors", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, true, "ar");
  try {
    await page.waitForFunction(() => window.__workspaceOpenHeld === true);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".workspace-v2-hydration-status")).toHaveText("جارٍ استعادة عملك المحفوظ…");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const exit = page.getByRole("button", { name: "الخروج من مساحة العمل", exact: true });
    await exit.focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[inert]")))).toBe(false);
    await page.screenshot({ path: `output/performance/hydration-pending-ar-phone-${browserName}.png` });
    await page.evaluate(() => window.__releaseWorkspaceOpen());
    await expect(page.locator("main.workspace-v2")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator('button[data-workspace-tool="pen"]')).toBeEnabled();
  } finally {
    await page.evaluate(() => window.__releaseWorkspaceOpen?.()).catch(() => undefined);
  }
});
