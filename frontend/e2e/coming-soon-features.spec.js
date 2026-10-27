import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

async function mockStudent(page, locale = "en") {
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "coming-soon", email: "coming-soon@example.test", full_name: "Coming Soon Student", preferred_language: locale, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by this test" } }) });
  });
}

const features = [
  { id: "study-plan", route: "/study-plan" },
  { id: "community", route: "/community" }
];

async function expectComingSoon(page, feature) {
  const surface = page.locator(`.feature-coming-soon[data-feature-id="${feature.id}"][data-feature-status="coming-soon"]`);
  await expect(surface).toBeVisible();
  await expect(surface).toContainText("Coming soon");
  await expect(surface.locator(".feature-coming-soon-icon svg")).toBeVisible();
  if (feature.id === "study-plan") {
    await expect(page.locator(".study-plan-v2")).toHaveCount(0);
  }
}

// The rail carries only the primary destinations; scheduled features are
// listed in the expanded navigation it opens.
test("desktop navigation routes scheduled features to the coming-soon surface", async ({ page }) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".sidebar a[data-feature-status='coming-soon']")).toHaveCount(0);

  for (const feature of features) {
    await page.locator(".sidebar .rail-expand").click();
    const navItem = page.locator(`.mobile-drawer.open a[data-feature-id="${feature.id}"]`);
    await expect(navItem).toHaveAttribute("data-feature-status", "coming-soon");
    await expect(navItem).toContainText("Coming soon");
    await navItem.click();
    await expect(page).toHaveURL(new RegExp(`#${feature.route}$`));
    await expectComingSoon(page, feature);
    await page.goto("/#/");
  }
});

test("mobile drawer exposes the same locked state and cannot enter the real feature page", async ({ page }) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 390, height: 844 });

  for (const feature of features) {
    await page.goto("/#/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Mobile navigation" });
    const navItem = drawer.locator(`a[data-feature-id="${feature.id}"]`);
    await expect(navItem).toHaveAttribute("data-feature-status", "coming-soon");
    await expect(navItem).toContainText("Coming soon");
    await navItem.click();
    await expect(page).toHaveURL(new RegExp(`#${feature.route}$`));
    await expectComingSoon(page, feature);
  }
});

test("direct feature routes, including nested Community links, are all guarded", async ({ page }) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const feature of [
    ...features,
    { id: "community", route: "/community/discussions/a-direct-link" }
  ]) {
    await page.goto(`/#${feature.route}`);
    await expectComingSoon(page, feature);
  }
});

for (const locale of ["ar", "en"]) {
  test(`Study Plan is coming soon without loading planner data (${locale})`, async ({ page }) => {
    await mockStudent(page, locale);
    await page.addInitScript(locale => localStorage.setItem("lock-in.locale", locale), locale);
    const plannerRequests = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/study-plan") && path !== "/api/v1/study-plan/v2/exams") plannerRequests.push(request.url());
    });
    await page.goto("/#/study-plan");
    const surface = page.locator('.feature-coming-soon[data-feature-id="study-plan"]');
    await expect(surface).toBeVisible();
    await expect(surface).toContainText(locale === "ar" ? "قريبًا" : "Coming soon");
    await expect(page.locator(".study-plan-v2")).toHaveCount(0);
    expect(plannerRequests).toEqual([]);
  });
}
