import { expect, test } from "@playwright/test";
import { POLICY_VERSION } from "../src/lib/policyContent.js";
import { studentSession } from "./fixtures/productionApi.js";
import { mockStudentApi } from "./helpers/mock-student-api.js";

test("an existing student can read their work before explicitly accepting the updated policies", async ({ page }) => {
  await mockStudentApi(page, { policyVersion: "2025.01" });
  await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ csrf_token: "e2e-csrf-token" })
  }));
  let acceptance = null;
  await page.route("**/api/v1/account/policies", async (route) => {
    acceptance = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ user: studentSession({ id: "viewport-student", policy_version: POLICY_VERSION, policy_accepted_at: "2026-10-16T13:00:00Z" }) })
    });
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.goto("/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();
  const notice = page.getByRole("region", { name: /تحديث السياسات/ });
  await expect(notice).toBeVisible();
  const refundsLink = notice.getByRole("link", { name: "الاسترداد", exact: true });
  await expect(refundsLink).toHaveAttribute("href", "#/refunds");
  // The policy links stand out from the sentence they sit in.
  const colors = await refundsLink.evaluate((link) => [getComputedStyle(link).color, getComputedStyle(link.parentElement).color, getComputedStyle(link).textDecorationLine]);
  expect(colors[0]).not.toBe(colors[1]);
  expect(colors[2]).toContain("underline");
  await page.screenshot({ path: test.info().outputPath("policy-notice-links.png") });
  const save = notice.getByRole("button", { name: "حفظ الموافقة" });
  await expect(save).toBeDisabled();
  expect(acceptance).toBeNull();
  await notice.getByRole("checkbox").check();
  await save.click();
  await expect(notice).toHaveCount(0);
  expect(acceptance).toEqual({ version: POLICY_VERSION, accept_policies: true });
  await expect(page.getByText("Nothing saved yet")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
