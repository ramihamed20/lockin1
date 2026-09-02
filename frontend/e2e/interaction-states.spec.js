import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { STOREFRONT_SHIPPED } from "./helpers/storefront.js";

/**
 * The interaction-state contract, exercised on real surfaces.
 *
 * Each test here corresponds to a defect the rebuild set out to remove:
 * a control that stayed lit after a tap, a click that left a focus ring, two
 * indicators on one element, or a list row that acquired a selection just by
 * being touched.
 */

async function mockStudent(page) {
  // The install prompt is a modal dialog over the shell; these tests are about
  // the controls behind it, so start from a session that already dismissed it.
  await withoutServiceWorker(page);
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); } catch { /* private mode */ }
  });
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    // The gated routes need the access contract answered before they render.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "ix", email: "ix@example.test", full_name: "Interaction Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    // The shell gates every study route on an access-granting subscription, so
    // the mock has to satisfy it before any of these surfaces render.
    if (pathname === "/api/v1/subscriptions/current") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ subscription: { id: "sub-ix", status: "active", plan_id: "plan-ix", access_allowed: true, expires_at: "2999-01-01T00:00:00Z", current_period_ends_at: "2999-01-01T00:00:00Z" } }) });
      return;
    }
    if (pathname === "/api/v1/entitlements/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [] }) });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Unused by the interaction tests" } }) });
  });
}

/** Number of simultaneously rendered indicators on one element. */
async function indicatorCount(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const transparent = (value) => !value || value === "none" || /rgba\(0, 0, 0, 0\)|transparent/.test(value);
    let count = 0;
    if (!transparent(style.outlineStyle) && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) count += 1;
    if (!transparent(style.backgroundColor)) count += 1;
    if (!transparent(style.boxShadow)) count += 1;
    return count;
  });
}

test.describe("desktop pointer", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a mouse click leaves no focus ring, keyboard focus still shows one", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    await page.locator(".sidebar .nav-btn", { hasText: "Questions" }).waitFor();
    await page.locator(".sidebar .nav-btn", { hasText: "Questions" }).click();
    // The clicked link keeps DOM focus, which is correct; what it must not
    // keep is a visible ring.
    const outlineAfterClick = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    expect(outlineAfterClick).toBe("none");

    await page.keyboard.press("Tab");
    const outlineAfterTab = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outlineAfterTab.style).not.toBe("none");
    expect(outlineAfterTab.width).toBeGreaterThan(0);
  });

  test("the press state is cleared the moment the pointer lifts", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    const button = page.locator(".notifications-menu-wrap .icon-btn");
    await button.waitFor();
    const box = await button.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(button).toHaveAttribute("data-ix-pressed", "");
    await page.mouse.up();
    await expect(button).not.toHaveAttribute("data-ix-pressed", "");
  });

  test("a press that turns into a drag is cancelled, not left behind", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    const button = page.locator(".notifications-menu-wrap .icon-btn");
    await button.waitFor();
    const box = await button.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(button).toHaveAttribute("data-ix-pressed", "");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 6 });
    await expect(button).not.toHaveAttribute("data-ix-pressed", "");
    await page.mouse.up();
  });

  test("exactly one navigation item is current, and it is decided by the route", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/questions");
    await expect(page.locator(".sidebar .nav-btn[aria-current='page']")).toHaveCount(1);
    await expect(page.locator(".sidebar .nav-btn[data-ix-current]")).toHaveCount(1);

    // Focusing a different destination must not move the current marker.
    await page.locator(".sidebar .nav-btn", { hasText: "Review" }).focus();
    await expect(page.locator(".sidebar .nav-btn[aria-current='page']")).toHaveCount(1);
    await expect(page.locator(".sidebar .nav-btn[aria-current='page']")).toContainText("Questions");
  });

  test("the current navigation item shows a single indicator", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/questions");
    const current = page.locator(".sidebar .nav-btn[aria-current='page']");
    await expect(current).toHaveCount(1);
    // Background tint only: no ring, no border, no shadow stacked on top.
    expect(await indicatorCount(current)).toBe(1);
  });
});

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a tap does not leave hover visuals behind", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    const bell = page.locator(".notifications-menu-wrap .icon-btn");
    await bell.waitFor();

    const before = await bell.evaluate((node) => getComputedStyle(node).backgroundColor);
    await bell.tap();
    await expect(page.locator("html")).not.toHaveClass(/ix-hover/);
    await expect(bell).not.toHaveAttribute("data-ix-pressed", "");
    // Close the surface the tap opened, then compare the resting appearance.
    await page.keyboard.press("Escape");
    await bell.tap();
    const after = await bell.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(after).toBe(before);
  });

  test("a long press releases cleanly instead of sticking", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    const bell = page.locator(".notifications-menu-wrap .icon-btn");
    await bell.waitFor();
    const box = await bell.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.touchscreen.tap(point.x, point.y);
    await page.waitForTimeout(700);
    await expect(bell).not.toHaveAttribute("data-ix-pressed", "");
    await expect(page.locator("[data-ix-pressed]")).toHaveCount(0);
  });

  test("navigating away and back leaves no stale interaction state", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    await page.locator(".bottom-nav a", { hasText: "Review" }).tap();
    await expect(page.locator(".bottom-nav a[aria-current='page']")).toContainText("Review");
    await page.locator(".bottom-nav a", { hasText: "Dashboard" }).tap();
    await expect(page.locator(".bottom-nav a[aria-current='page']")).toContainText("Dashboard");
    await expect(page.locator("[data-ix-pressed]")).toHaveCount(0);
    await expect(page.locator(".bottom-nav [aria-current='page']")).toHaveCount(1);
  });

  test("a tapped list row keeps no selection", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/notifications");
    const filter = page.locator(".notification-filter-actions [role='tab']").first();
    await filter.waitFor();
    await filter.tap();
    // Tabs do hold a selection; rows and cards must not.
    await expect(page.locator("[data-ix-pressed]")).toHaveCount(0);
    await expect(page.locator(".notification-feed-item[data-ix-selected]")).toHaveCount(0);
  });

  test("the filter strip never shows two selections at once", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/notifications");
    const tabs = page.locator(".notification-filter-actions [role='tab']");
    await tabs.first().waitFor();
    await expect(page.locator(".notification-filter-actions [aria-selected='true']")).toHaveCount(1);
    await tabs.nth(1).tap();
    await expect(page.locator(".notification-filter-actions [aria-selected='true']")).toHaveCount(1);
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
  });

  test("the bottom bar reflects the route, and one destination at a time", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    await expect(page.locator(".bottom-nav a[aria-current='page']")).toHaveCount(1);
    await page.locator(".bottom-nav a", { hasText: "Review" }).tap();
    await expect(page.locator(".bottom-nav a[aria-current='page']")).toHaveCount(1);
    await expect(page.locator(".bottom-nav a[aria-current='page']")).toContainText("Review");
  });

  test("drawer destinations navigate on the first tap and Search stays in the top bar", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    await page.locator(".bottom-nav button", { hasText: "More" }).tap();

    const drawer = page.locator("#mobile-drawer");
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer.getByRole("link", { name: "Search" })).toHaveCount(0);
    await drawer.getByRole("link", { name: "Materials" }).tap();
    await expect(page).toHaveURL(/#\/materials$/);
    await expect(drawer).not.toHaveClass(/open/);

    await page.locator(".bottom-nav button", { hasText: "More" }).tap();
    await drawer.getByRole("link", { name: "Ranked" }).tap();
    await expect(page).toHaveURL(/#\/ranked$/);
    await expect(drawer).not.toHaveClass(/open/);
  });
});

test.describe("keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Space and Enter drive the press state and release it", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/");
    const bell = page.locator(".notifications-menu-wrap .icon-btn");
    await bell.waitFor();
    await bell.focus();

    await page.keyboard.down("Space");
    await expect(bell).toHaveAttribute("data-ix-pressed", "");
    await page.keyboard.up("Space");
    await expect(bell).not.toHaveAttribute("data-ix-pressed", "");
  });

  test("a tab strip is a single tab stop", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/notifications");
    await page.locator(".notification-filter-actions [role='tab']").first().waitFor();
    // Roving tabindex: only the selected tab is reachable with Tab.
    await expect(page.locator(".notification-filter-actions [role='tab'][tabindex='0']")).toHaveCount(1);
  });
});

test.describe("keyboard on a category strip", () => {
  // The store strip filters in place, so focus can be observed after an arrow
  // key. The notifications filter refetches and remounts its own tabs.
  test.skip(!STOREFRONT_SHIPPED, "The storefront is withheld until commerce launches, so the category strip does not render.");
  test.use({ viewport: { width: 1440, height: 900 } });

  test("arrows move both focus and the selection, and never select two", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/store");
    const tabs = page.locator(".store-tabs [role='tab']");
    await tabs.first().waitFor();

    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".store-tabs [aria-selected='true']")).toHaveCount(1);
    await expect(page.locator(".store-tabs [role='tab'][tabindex='0']")).toHaveCount(1);

    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(0)).toBeFocused();
    await expect(page.locator(".store-tabs [aria-selected='true']")).toHaveCount(1);
  });

  test("an unanswered question group is still reachable with Tab", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/questions/demo/microbiology/sheet-1");
    const group = page.locator(".demo-answer-list[role='radiogroup']");
    await group.waitFor();
    // Nothing is chosen yet, so the first option carries the tab stop rather
    // than the whole group dropping out of the tab order.
    await expect(page.locator(".demo-answer-list [role='radio'][tabindex='0']")).toHaveCount(1);
    await expect(page.locator(".demo-answer-list [role='radio'][aria-checked='true']")).toHaveCount(0);

    await page.locator(".demo-answer-list [role='radio']").nth(1).click();
    await expect(page.locator(".demo-answer-list [role='radio'][aria-checked='true']")).toHaveCount(1);
    await expect(page.locator(".demo-answer-list [role='radio'][tabindex='0']")).toHaveCount(1);
  });

  test("the selected category shows one indicator, and pressing another clears the first", async ({ page }) => {
    await mockStudent(page);
    await page.goto("/#/store");
    const tabs = page.locator(".store-tabs [role='tab']");
    await tabs.first().waitFor();

    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".store-tabs [data-ix-selected]")).toHaveCount(1);
    // The click must not leave the tab pressed or ringed.
    await expect(page.locator("[data-ix-pressed]")).toHaveCount(0);
    expect(await tabs.nth(2).evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
  });
});
