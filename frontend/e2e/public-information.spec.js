import { expect, test } from "@playwright/test";

test("public legal and support pages are reachable without an account", async ({ page }) => {
  await page.goto("/#/terms");
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();

  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();

  await page.getByRole("link", { name: "Support" }).click();
  await expect(page).toHaveURL(/#\/support$/);
  await expect(page.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
});
