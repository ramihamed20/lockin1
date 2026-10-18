import { expect, test } from "@playwright/test";

test("public legal and support pages are reachable without an account", async ({ page }) => {
  await page.goto("/#/terms");
  await expect(page.getByRole("heading", { name: "Terms and refund policy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();

  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();

  // Exact, because the support address is itself a link and getByRole matches
  // names by substring: any address beginning "support@" also answers to
  // "Support". CI builds without VITE_SUPPORT_EMAIL so only the nav link
  // exists there, which is why this only bites a build configured like
  // production.
  await page.getByRole("link", { name: "Support", exact: true }).click();
  await expect(page).toHaveURL(/#\/support$/);
  await expect(page.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
});


test("refund rights and the approved document are accessible on a narrow Arabic page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/refunds");
  await expect(page.getByText(/50% من مجموع/)).toBeVisible();
  await expect(page.getByText(/48 ساعة من وصول الطلب/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Download the complete Arabic/ })).toHaveAttribute("href", "/policies/Lockin_User_Policies_2026.pdf");
  await expect(page.locator("[lang=ar][dir=rtl]")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
