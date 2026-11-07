import { mkdir } from "node:fs/promises";
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

for (const viewport of [
  { width: 834, height: 1194, name: "ipad" },
  { width: 390, height: 844, name: "phone" }
]) {
  test(`horizontal PDF real UI preview on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(120000);
    await mkdir("output/playwright", { recursive: true });
    await openFixture(page, viewport.width, viewport.height);
    const stage = page.locator(".workspace-v2-document-stage");
    await expect(stage).toHaveAttribute("data-page-direction", "vertical");
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Workspace settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Workspace settings" });
    await settings.getByRole("tab", { name: "View" }).click();
    const horizontal = settings.getByRole("radio", { name: "Swipe pages" });
    await horizontal.click();
    await expect(horizontal).toHaveAttribute("aria-checked", "true");
    await expect(stage).toHaveAttribute("data-page-direction", "horizontal");
    await expect.poll(async () => page.locator(".workspace-v2-a4-page").evaluateAll((elements) => {
      const first = elements[0]?.getBoundingClientRect();
      const second = elements[1]?.getBoundingClientRect();
      return Boolean(first && second && second.left > first.right && Math.abs(second.top - first.top) < 2);
    })).toBe(true);
    await page.screenshot({ path: `output/playwright/focus-horizontal-${viewport.name}-settings.png`, fullPage: false });
    await settings.getByRole("button", { name: "Close workspace settings" }).click();
    await page.screenshot({ path: `output/playwright/focus-horizontal-${viewport.name}-reader.png`, fullPage: false });
  });
}
