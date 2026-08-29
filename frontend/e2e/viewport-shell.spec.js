import { expect, test } from "@playwright/test";

async function mockShortAuthenticatedPage(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const normalizedPath = pathname.replace(/\/$/, "");

    if (normalizedPath === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "viewport-student",
            email: "viewport@example.test",
            full_name: "Viewport Student",
            preferred_language: "en",
            status: "active",
            is_email_verified: true,
            roles: ["student"],
            date_joined: "2026-01-01T00:00:00Z"
          }
        })
      });
      return;
    }

    if (normalizedPath === "/api/v1/operations/session") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } })
      });
      return;
    }

    if (normalizedPath === "/api/v1/bookmarks") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ count: 0, next: null, previous: null, results: [] })
      });
      return;
    }

    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found", message: "Not used by the viewport test" } })
    });
  });
}

async function shellMetrics(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const root = document.getElementById("root");
    const pageShell = document.querySelector(".page-shell");
    const nav = document.querySelector(".bottom-nav");
    const shellBounds = shell?.getBoundingClientRect();
    const rootBounds = root?.getBoundingClientRect();
    const navBounds = nav?.getBoundingClientRect();
    const navStyle = nav ? getComputedStyle(nav) : null;
    const visibleHeight = window.visualViewport?.height || window.innerHeight;

    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      shellCoversViewport: Boolean(shellBounds && shellBounds.top <= 0.5 && shellBounds.bottom >= visibleHeight - 0.5),
      rootCoversViewport: Boolean(rootBounds && rootBounds.height >= visibleHeight - 0.5),
      navVisible: Boolean(navStyle && navStyle.display !== "none"),
      navBottomDelta: navStyle?.display !== "none" && navBounds ? Math.round(visibleHeight - navBounds.bottom) : null,
      navTransform: navStyle?.display !== "none" ? navStyle.transform : null,
      pageOverflowY: pageShell ? getComputedStyle(pageShell).overflowY : null,
      viewportToken: getComputedStyle(document.documentElement).getPropertyValue("--app-viewport-height").trim()
    };
  });
}

test("short pages own the initial phone and iPad viewport without a first swipe", async ({ page }) => {
  await mockShortAuthenticatedPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  const navigationEntry = page.url();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 414, height: 896 },
    { width: 430, height: 932 }
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => shellMetrics(page)).toEqual({
      horizontalOverflow: 0,
      shellCoversViewport: true,
      rootCoversViewport: true,
      navVisible: true,
      navBottomDelta: 0,
      navTransform: "none",
      pageOverflowY: "visible",
      viewportToken: "100dvh"
    });
    expect(page.url()).toBe(navigationEntry);
  }

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 834, height: 1194 },
    { width: 1024, height: 768 }
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => shellMetrics(page)).toEqual({
      horizontalOverflow: 0,
      shellCoversViewport: true,
      rootCoversViewport: true,
      navVisible: false,
      navBottomDelta: null,
      navTransform: null,
      pageOverflowY: "auto",
      viewportToken: "100dvh"
    });
    expect(page.url()).toBe(navigationEntry);
  }
});

test("public pages without app navigation still paint through the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/support");
  await expect(page.getByRole("heading", { name: "Support", exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const pageRoot = document.querySelector(".public-info-page")?.getBoundingClientRect();
    const root = document.getElementById("root")?.getBoundingClientRect();
    const visibleHeight = window.visualViewport?.height || window.innerHeight;
    return {
      publicPageCoversViewport: Boolean(pageRoot && pageRoot.height >= visibleHeight - 0.5),
      rootCoversViewport: Boolean(root && root.height >= visibleHeight - 0.5),
      bottomNavigationCount: document.querySelectorAll(".bottom-nav").length,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })).toEqual({
    publicPageCoversViewport: true,
    rootCoversViewport: true,
    bottomNavigationCount: 0,
    horizontalOverflow: 0
  });
});
