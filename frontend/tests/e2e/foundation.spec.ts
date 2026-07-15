import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/health/live", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "lockin-api" })
    });
  });
});

test("foundation is readable and does not overflow on desktop", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Lock-in");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Built for the hours that matter."
  );
  await expect(page.getByRole("heading", { name: "Foundation status" })).toBeVisible();
  await expect(page.getByText("Available")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
});

test("mobile foundation keeps the primary content and status visible", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-specific assertion");
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Foundation status")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
});
