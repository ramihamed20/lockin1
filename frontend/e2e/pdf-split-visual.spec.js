import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const SECOND_ROUTE = "/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace";

async function openTwoSheets(page, width, height) {
  await withoutServiceWorker(page);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/e2e-fixtures/pdf/**", route => route.fulfill({ path: "e2e/fixtures/pdf/sheet-41.pdf", contentType: "application/pdf" }));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/auth/session") return route.fulfill({ json: { user: studentSession() } });
    if (path === "/api/v1/auth/csrf") return route.fulfill({ json: { csrf_token: "split-preview-csrf" } });
    if (path === "/api/v1/operations/session") return route.fulfill({ status: 403, json: { error: { code: "permission_denied", message: "Student account" } } });
    if (path === "/api/v1/focus/lock-in") return route.fulfill({ json: { active_session: null } });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Unused preview endpoint" } } });
  });
  await page.setViewportSize({ width, height });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-pane.is-active .workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 25000 });
  await page.evaluate(route => { location.hash = route; }, SECOND_ROUTE);
  await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Vitamin -2", { timeout: 25000 });
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await page.locator(".workspace-pane.is-active .workspace-tab [role=tab]").filter({ hasText: "Vitamin -1" }).click();
  await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Vitamin -1");
}

for (const viewport of [
  { width: 1180, height: 820, name: "ipad" },
  { width: 390, height: 844, name: "phone" },
]) {
  test(`PDF split visual on ${viewport.name}: open, drag and side-by-side view`, async ({ page }) => {
    test.setTimeout(120000);
    await mkdir("output/playwright", { recursive: true });
    await openTwoSheets(page, viewport.width, viewport.height);
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-before.png`, fullPage: false });

    const sourceTab = page.locator(".workspace-pane.is-active .workspace-tab").filter({ hasText: "Vitamin -2" }).locator("[role=tab]");
    await sourceTab.scrollIntoViewIfNeeded();
    const source = await sourceTab.boundingBox();
    const stage = await page.locator(".workspace-pane.is-active .workspace-v2-document-stage").boundingBox();
    expect(source).toBeTruthy();
    expect(stage).toBeTruthy();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 25, source.y + 45, { steps: 4 });
    await page.mouse.move(stage.x + stage.width * .78, stage.y + stage.height * .45, { steps: 14 });
    await expect(page.locator(".workspace-tab-drop-highlight.is-end")).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-dragging.png`, fullPage: false });
    await page.mouse.up();

    await expect(page.locator(".workspace-split-layout.is-split")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".workspace-pane.is-secondary .workspace-v3-document-context strong")).toHaveText("Vitamin -2");
    await expect(page.locator(".workspace-pane.is-secondary .workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-after.png`, fullPage: false });
  });
}
