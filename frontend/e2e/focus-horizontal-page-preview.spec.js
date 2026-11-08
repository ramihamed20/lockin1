import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

async function openFixture(page, width, height) {
  await withoutServiceWorker(page);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/e2e-fixtures/pdf/**", (route) => route.fulfill({ path: "e2e/fixtures/pdf/sheet-41.pdf", contentType: "application/pdf" }));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/auth/session") return route.fulfill({ json: { user: studentSession() } });
    if (path === "/api/v1/auth/csrf") return route.fulfill({ json: { csrf_token: "focus-preview-csrf" } });
    if (path === "/api/v1/operations/session") return route.fulfill({ status: 403, json: { error: { code: "permission_denied", message: "Student account" } } });
    if (path === "/api/v1/focus/lock-in") return route.fulfill({ json: { active_session: null } });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Unused preview endpoint" } } });
  });
  await page.setViewportSize({ width, height });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect.poll(async () => page.locator('[data-pdf-page="1"] .workspace-v2-a4-canvas.is-visible').evaluate((canvas) => canvas.width > 0)).toBe(true);
}

// Keep this regression when sideways page turning is brought back later.
for (const viewport of [
  { width: 834, height: 1194, name: "ipad" },
  { width: 390, height: 844, name: "phone" }
]) {
  test(`PDF reading stays vertical on ${viewport.name} even with an old horizontal preference`, async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => {
      localStorage.setItem("lock-in.catalog-workspace.settings.v1", JSON.stringify({ pageDirection: "horizontal" }));
    });
    await openFixture(page, viewport.width, viewport.height);
    const stage = page.locator(".workspace-v2-document-stage");
    await expect(stage).toHaveAttribute("data-page-direction", "vertical");
    await expect(page.locator(".workspace-v2-a4-document")).not.toHaveClass(/is-horizontal/);
    await expect.poll(async () => page.locator(".workspace-v2-a4-page").evaluateAll((elements) => {
      const first = elements[0]?.getBoundingClientRect();
      const second = elements[1]?.getBoundingClientRect();
      return Boolean(first && second && second.top > first.bottom);
    })).toBe(true);

    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Workspace settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Workspace settings" });
    await settings.getByRole("tab", { name: "View" }).click();
    await expect(settings.getByRole("radio", { name: "Swipe pages" })).toHaveCount(0);
    await expect(stage).toHaveAttribute("data-page-direction", "vertical");

    const bounds = await settings.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    if (viewport.name === "phone") {
      expect(bounds.width).toBeLessThanOrEqual(300);
      expect(bounds.height).toBeLessThanOrEqual(viewport.height * .53);
      const close = await settings.getByRole("button", { name: "Close workspace settings" }).boundingBox();
      expect(close.width).toBeGreaterThanOrEqual(40);
      expect(close.height).toBeGreaterThanOrEqual(40);
    }

    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem("lock-in.catalog-workspace.settings.v1");
      return raw && JSON.parse(raw).pageDirection;
    })).toBe("vertical");
  });
}
