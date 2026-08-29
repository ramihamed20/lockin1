import { expect, test } from "@playwright/test";

/** Small navigation affordances that were missing rather than broken. */

async function mockStudent(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "nav", email: "nav@example.test", full_name: "Nav Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by the navigation tests" } }) });
  });
}

// The dashboard answers to both "/" and "/dashboard". Matching "/" on equality
// alone left the second one with nothing highlighted and no aria-current, so a
// screen reader could not say which destination was open.
for (const route of ["/#/", "/#/dashboard"]) {
  test(`the dashboard destination is marked current at ${route}`, async ({ page }) => {
    await mockStudent(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    const dashboard = page.locator(".sidebar .nav-btn", { hasText: "Dashboard" });
    await expect(dashboard).toHaveClass(/active/);
    await expect(dashboard).toHaveAttribute("aria-current", "page");
    // Exactly one destination claims to be the current page.
    await expect(page.locator(".sidebar .nav-btn[aria-current='page']")).toHaveCount(1);
  });
}

test("the bottom bar marks the dashboard current on both of its routes", async ({ page }) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/dashboard");
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await expect(page.locator(".bottom-nav a[aria-current='page']")).toHaveCount(1);
  await expect(page.locator(".bottom-nav a[aria-current='page']")).toContainText("Dashboard");
});

// Store and Progress are both Personal, but they sat either side of the Social
// pair, and the sidebar labels a group whenever it changes between consecutive
// items - so "Personal" was printed twice.
test("the sidebar names each destination group once", async ({ page }) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".sidebar")).toBeVisible();
  const headings = await page.locator(".sidebar .nav-section-label").allTextContents();
  expect(headings.length).toBeGreaterThan(0);
  expect(new Set(headings).size, `duplicate group headings: ${headings.join(", ")}`).toBe(headings.length);
});

// Opening search from the topbar icon means the intent is to type. The icon is
// the compact shells route to search - wider viewports carry the field itself.
test("search from the topbar icon opens with the field focused", async ({ page }) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/");
  await page.locator(".topbar-search-action").click();
  await expect(page).toHaveURL(/#\/search$/);
  const field = page.locator(".page-shell input[type='search']");
  await expect(field).toBeFocused();
});

// A visit that already carries a query came from a submitted search, where the
// results deserve attention more than the box does.
test("a search opened with a query does not steal focus from its results", async ({ page }) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/search?q=anatomy");
  const field = page.locator(".page-shell input[type='search']");
  await expect(field).toHaveValue("anatomy");
  await expect(field).not.toBeFocused();
});
