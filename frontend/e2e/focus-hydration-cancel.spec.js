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
    const nativeClose = IDBDatabase.prototype.close;
    IDBDatabase.prototype.close = function (...args) {
      if (this.name === "lock-in-workspace") window.__hydrationCloseCount = (window.__hydrationCloseCount || 0) + 1;
      return nativeClose.apply(this, args);
    };
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === "documents" && this.transaction.db.name === "lock-in-workspace") window.__hydrationDocumentReads = (window.__hydrationDocumentReads || 0) + 1;
      const request = originalGet.apply(this, args);
      if (this.name === "documents" && this.transaction.db.name === "lock-in-workspace" && String(args[0]).includes("hydration-student")) {
        request.addEventListener("success", () => requestAnimationFrame(() => requestAnimationFrame(() => { window.__workspaceDocumentReadSettled = true; })));
      }
      return request;
    };
    IDBFactory.prototype.open = function (...args) {
      const request = originalOpen.apply(this, args);
      if (args[0] !== "lock-in-workspace") return request;
      window.__hydrationOpenRequests = (window.__hydrationOpenRequests || 0) + 1;
      request.addEventListener("success", () => { window.__hydrationOpenCount = (window.__hydrationOpenCount || 0) + 1; });
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



test("exiting during storage open does not reopen and read the discarded document", async ({ page }) => {
  test.setTimeout(30000);
  await setup(page, true);
  try {
    await page.waitForFunction(() => window.__workspaceOpenHeld === true);
    await expect(page.locator("main.workspace-v2")).toHaveAttribute("aria-busy", "true");
    await page.getByRole("button", { name: "Exit Workspace", exact: true }).click();
    await expect(page.locator("main.workspace-v2")).toHaveCount(0);
    await page.evaluate(() => window.__releaseWorkspaceOpen());
    // The first native close is a transitional state on the predecessor.
    // Drain browser frames before checking that no subsequent open was issued.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect.poll(() => page.evaluate(() => ({ reads: window.__hydrationDocumentReads || 0, opens: window.__hydrationOpenCount || 0, openRequests: window.__hydrationOpenRequests || 0, closes: window.__hydrationCloseCount || 0 }))).toEqual({ reads: 0, opens: 1, openRequests: 1, closes: 1 });
  } finally {
    await page.evaluate(() => window.__releaseWorkspaceOpen?.()).catch(() => undefined);
  }
});
