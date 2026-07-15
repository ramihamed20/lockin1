import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "e2e-user",
  email: "student@example.com",
  full_name: "Rami Student",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student"],
  date_joined: "2026-07-15T00:00:00Z"
};

test.beforeEach(async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrf_token: "e2e-csrf" }) });
    } else if (path.endsWith("/auth/login")) {
      authenticated = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    } else if (path.endsWith("/auth/session")) {
      await route.fulfill({ status: authenticated ? 200 : 403, contentType: "application/json", body: JSON.stringify(authenticated ? { user } : { error: { code: "not_authenticated", message: "Authentication required." } }) });
    } else if (path.endsWith("/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ roles: ["student"], account: { email_verified: true, active_sessions: 1, preferred_language: "en" }, workspaces: [] }) });
    } else if (path.endsWith("/auth/register")) {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ status: "verification_required" }) });
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }) });
    }
  });
});

test("sign-in reaches a truthful, accessible student overview", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("University email").fill(user.email);
  await page.getByLabel("Password").fill("secure-password-2026");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("heading", { name: "Your Lock-in overview" })).toBeVisible();
  await expect(page.getByText("Your student workspace is ready. Creator and moderator tools appear only when assigned.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
});

test("registration adapts to mobile and switches to real RTL", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-specific assertion");
  await page.goto("/register");
  await page.getByRole("button", { name: "العربية" }).click();

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "ابنِ مساحة دراستك." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("registration-rtl.png"), fullPage: true });
});

test("protected pages return anonymous users to sign-in", async ({ page }) => {
  await page.goto("/security");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});
