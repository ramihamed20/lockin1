import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

test.use({ serviceWorkers: "block" });

test("recent study links stay with their account through an authenticated identity change", async ({ page }) => {
  test.setTimeout(90000);
  let account = "history-account-a";
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/api/v1/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value, status = 200) => route.fulfill({ status, json: value });
    if (pathname === "/api/v1/auth/session") return json({ user: { id: account, email: account + "@example.test", full_name: "Synthetic Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Synthetic student" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in") return json({ active_session: null });
    if (pathname === "/api/v1/dashboard") return json({});
    return json({ count: 0, next: null, previous: null, results: [] });
  });
  await page.goto("/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace");
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20000 });
  await page.goto("/#/dashboard");
  await expect(page.locator(".dashboard")).toBeVisible();
  // One opened sheet is offered by Continue (the list beneath it starts with
  // the sheet before), so Continue is where this account's history shows.
  const resume = page.locator(".continue-card a[href*='vitamin-1']");
  const title = page.locator(".continue-card h2");
  await expect(resume).toHaveCount(1);
  const firstTitle = await title.textContent();
  account = "history-account-b";
  await page.reload();
  await expect(page.locator(".dashboard")).toBeVisible();
  await expect(resume).toHaveCount(0);
  await expect(page.locator(".continue-card").getByRole("link", { name: "Browse materials" })).toBeVisible();
  account = "history-account-a";
  await page.reload();
  await expect(resume).toHaveCount(1);
  await expect(title).toHaveText(firstTitle);
});
