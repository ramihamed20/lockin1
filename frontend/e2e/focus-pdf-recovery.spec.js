import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

async function mockWorkspace(page) {
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "pdf-student", email: "pdf@example.test", full_name: "PDF Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by PDF tests" } }) });
  });
}

test("a PDF that fails to load explains itself and retries without duplicating render work", async ({ page }) => {
  test.setTimeout(90_000);
  let failDownload = true;
  await mockWorkspace(page);
  // The service worker fetches assets on the page's behalf, and those requests
  // only reach a context-level route.
  await page.context().route("**/*.pdf", async (route) => {
    if (failDownload) {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();

  // The reader is told what happened rather than left with a blank sheet.
  const failure = page.locator(".workspace-v2-a4-status[role='alert']");
  await expect(failure).toBeVisible({ timeout: 20_000 });
  const retry = page.getByRole("button", { name: "Retry PDF" });
  await expect(retry).toBeVisible();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible();
  expect(await page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width)).toBe(0);

  failDownload = false;
  await retry.click();
  await expect.poll(
    async () => page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width > 0),
    { timeout: 25_000 }
  ).toBe(true);
  await expect(failure).toHaveCount(0);

  // The retry replaced the page's queued job rather than stacking another one:
  // each page still owns exactly its front and back buffer.
  const canvasesOnFirstPage = await page.locator('[data-pdf-page="1"] canvas.workspace-v2-a4-canvas').count();
  expect(canvasesOnFirstPage).toBe(2);
  const backedCanvases = await page.evaluate(() => [...document.querySelectorAll(".workspace-v2-a4-canvas")].filter((canvas) => canvas.width > 0).length);
  expect(backedCanvases).toBeGreaterThan(0);
  expect(backedCanvases).toBeLessThanOrEqual(8);
});

test("a PDF that never arrives still offers a way forward", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  // The request hangs: no response, no error. Without a notice the reader would
  // watch a spinner forever.
  await page.context().route("**/*.pdf", () => {});
  await page.addInitScript(() => {
    const originalSetTimeout = window.setTimeout;
    // Collapse only the slow-load notice so the test does not wait 15 seconds.
    window.setTimeout = function patchedSetTimeout(handler, delay, ...rest) {
      return originalSetTimeout(handler, delay === 15_000 ? 400 : delay, ...rest);
    };
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.getByText("This PDF is taking longer than usual.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Retry PDF" })).toBeVisible();
});
