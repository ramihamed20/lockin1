import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * iPad Dashboard structural stability.
 *
 * Reported: scrolling the Dashboard down on iPad meets resistance and the page
 * pushes back against the finger, in both orientations, past the top of the
 * page. Measured cause: Safari retracts its chrome as a downward scroll starts,
 * `installViewportSync` accepted the larger reading into --app-viewport-height,
 * and every structural box sizes from that one token -- a +84px token measured
 * a +84px shell, grid row and sticky sidebar, mid-gesture.
 *
 * These tests drive the real JavaScript path: they change what the page reports
 * for innerHeight/visualViewport and dispatch the events the viewport layer
 * actually listens to. Nothing here writes the CSS variable, because writing it
 * would test the stylesheet rather than the fix.
 *
 * What is NOT covered: the gesture, and WebKit's response to it. Chromium has no
 * retractable chrome, so chrome retraction is simulated. Real iPad Safari
 * verification is still required.
 */

const IPADS = [
  { name: "portrait 834x1112", width: 834, height: 1112 },
  { name: "landscape 1112x834", width: 1112, height: 834 },
  { name: "pro portrait 1024x1366", width: 1024, height: 1366 },
  { name: "mini 768x1024", width: 768, height: 1024 }
];

/** Safari's chrome is worth roughly this much viewport when it retracts. */
const CHROME = 84;

async function mockDashboard(page, character = "white") {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "ipad-scroll", email: "ipad@example.test", full_name: "iPad Reader",
            preferred_language: "en", status: "active", is_email_verified: true,
            roles: ["student"], date_joined: "2026-01-01T00:00:00Z",
            theme_settings: { character, theme: "night", auto_theme: false }
          }
        })
      });
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used here" } }) });
  });
}

for (const device of [
  { name: "mobile", width: 390, height: 844 },
  { name: "iPad portrait", width: 834, height: 1112 },
  { name: "iPad landscape", width: 1112, height: 834 },
  { name: "desktop", width: 1440, height: 960 }
]) {
  test(`None mascot removes the Dashboard illustration slot (${device.name})`, async ({ page }) => {
    await mockDashboard(page, "none");
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto("/#/");
    await expect(page.locator(".dashboard-main")).toHaveClass(/dashboard-main--no-mascot/);
    await expect(page.locator(".dashboard-right")).toHaveCount(0);
    await expect(page.locator(".scene-card")).toHaveCount(0);
    await expect(page.locator(".dashboard-left")).toBeVisible();
    const layout = await page.locator(".dashboard-main").evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns,
      width: element.getBoundingClientRect().width,
      childWidth: element.querySelector(".dashboard-left")?.getBoundingClientRect().width || 0
    }));
    expect(layout.columns.split(" ")).toHaveLength(1);
    expect(Math.abs(layout.width - layout.childWidth)).toBeLessThanOrEqual(1);
  });
}

for (const device of [
  { name: "iPad landscape", width: 1112, height: 834 },
  { name: "desktop", width: 1440, height: 960 }
]) {
  test(`None mascot reallocates Dashboard card width beyond both mascot layouts (${device.name})`, async ({ browser }) => {
    const blackContext = await browser.newContext({ viewport: { width: device.width, height: device.height } });
    const whiteContext = await browser.newContext({ viewport: { width: device.width, height: device.height } });
    const noneContext = await browser.newContext({ viewport: { width: device.width, height: device.height } });
    const blackPage = await blackContext.newPage();
    const whitePage = await whiteContext.newPage();
    const nonePage = await noneContext.newPage();
    await mockDashboard(blackPage, "black");
    await mockDashboard(whitePage, "white");
    await mockDashboard(nonePage, "none");
    await Promise.all([blackPage.goto("/#/"), whitePage.goto("/#/"), nonePage.goto("/#/")]);
    await Promise.all([
      expect(blackPage.locator("html")).toHaveAttribute("data-character", "black"),
      expect(whitePage.locator("html")).toHaveAttribute("data-character", "white"),
      expect(nonePage.locator("html")).toHaveAttribute("data-character", "none"),
      expect(blackPage.locator(".scene-card")).toBeVisible(),
      expect(whitePage.locator(".scene-card")).toBeVisible(),
      expect(nonePage.locator(".scene-card")).toHaveCount(0)
    ]);
    const width = async (page, selector) => page.locator(selector).evaluate((element) => element.getBoundingClientRect().width);
    const [blackContinue, whiteContinue, noneContinue, blackRecent, whiteRecent, noneRecent] = await Promise.all([
      width(blackPage, ".continue-card"),
      width(whitePage, ".continue-card"),
      width(nonePage, ".continue-card"),
      width(blackPage, ".dashboard-recent-sheets"),
      width(whitePage, ".dashboard-recent-sheets"),
      width(nonePage, ".dashboard-recent-sheets")
    ]);
    expect(noneContinue).toBeGreaterThan(blackContinue);
    expect(noneContinue).toBeGreaterThan(whiteContinue);
    expect(noneRecent).toBeGreaterThan(blackRecent);
    expect(noneRecent).toBeGreaterThan(whiteRecent);
    expect(Math.abs(noneContinue - noneRecent)).toBeLessThanOrEqual(1);
    expect(Math.abs(blackContinue - whiteContinue)).toBeLessThanOrEqual(1);
    expect(Math.abs(blackRecent - whiteRecent)).toBeLessThanOrEqual(1);
    await Promise.all([blackContext.close(), whiteContext.close(), noneContext.close()]);
  });
}

test("None mascot keeps iPad portrait study cards full-width", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 834, height: 1112 } });
  const page = await context.newPage();
  await mockDashboard(page, "none");
  await page.goto("/#/");

  const [mainWidth, continueWidth, recentWidth] = await Promise.all([
    page.locator(".dashboard-main").evaluate((element) => element.getBoundingClientRect().width),
    page.locator(".continue-card").evaluate((element) => element.getBoundingClientRect().width),
    page.locator(".dashboard-recent-sheets").evaluate((element) => element.getBoundingClientRect().width)
  ]);
  expect(Math.abs(mainWidth - continueWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(mainWidth - recentWidth)).toBeLessThanOrEqual(1);
  await context.close();
});

/**
 * Report a taller viewport and fire the events Safari fires when its chrome
 * retracts. Width is untouched, because chrome retraction cannot change it.
 */
async function retractChrome(page, amount) {
  await page.evaluate((delta) => {
    const grown = window.innerHeight + delta;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: grown });
    if (window.visualViewport) {
      Object.defineProperty(window.visualViewport, "height", { configurable: true, value: grown });
      window.visualViewport.dispatchEvent(new Event("resize"));
      window.visualViewport.dispatchEvent(new Event("scroll"));
    }
    window.dispatchEvent(new Event("resize"));
  }, amount);
  // The viewport layer coalesces into an animation frame.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function structure() {
  const box = (selector) => {
    const element = document.querySelector(selector);
    return element ? +element.getBoundingClientRect().height.toFixed(0) : null;
  };
  return {
    token: getComputedStyle(document.documentElement).getPropertyValue("--app-viewport-height").trim(),
    shell: box(".app-shell"),
    sidebar: box(".sidebar"),
    contentFrame: box(".content-frame"),
    html: box("html"),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
}

for (const device of IPADS) {
  test(`chrome retraction does not resize the Dashboard (${device.name})`, async ({ page }) => {
    await mockDashboard(page);
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto("/#/");
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.waitForFunction(() => !document.querySelector(".sidebar .streak-card--loading"));

    const before = await page.evaluate(structure);
    await retractChrome(page, CHROME);
    const after = await page.evaluate(structure);

    // The token is the single point of control; everything else follows it.
    expect(after.token).toBe(before.token);
    expect(after.shell).toBe(before.shell);
    expect(after.sidebar).toBe(before.sidebar);
    expect(after.contentFrame).toBe(before.contentFrame);
    expect(after.html).toBe(before.html);
    // Nothing was traded for a horizontal scrollbar.
    expect(after.overflowX).toBe(0);
  });
}

test("repeated chrome events keep the Dashboard latched", async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto("/#/");
  await expect(page.locator(".sidebar")).toBeVisible();

  const before = await page.evaluate(structure);
  for (let pass = 0; pass < 4; pass += 1) await retractChrome(page, 24);
  const after = await page.evaluate(structure);

  expect(after.token).toBe(before.token);
  expect(after.shell).toBe(before.shell);
  expect(after.sidebar).toBe(before.sidebar);
});

test("the nav list is still the sidebar's scroll container", async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 1112, height: 834 });
  await page.goto("/#/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await retractChrome(page, CHROME);

  // The intended nested scrolling is untouched by a fix made in the viewport
  // layer -- no overflow, touch-action or sticky change was involved.
  const list = await page.evaluate(() => {
    const element = document.querySelector(".sidebar .nav-list");
    const style = window.getComputedStyle(element);
    return { overflowY: style.overflowY, overscroll: style.overscrollBehaviorY };
  });
  expect(["auto", "scroll"]).toContain(list.overflowY);
  expect(list.overscroll).toBe("contain");
});

test("a real orientation change still re-measures the shell", async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto("/#/");
  await expect(page.locator(".sidebar")).toBeVisible();
  const portrait = await page.evaluate(structure);

  // Rotating changes the width, which is what tells the layer this is a new
  // layout rather than chrome moving.
  await page.setViewportSize({ width: 1112, height: 834 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const landscape = await page.evaluate(structure);

  expect(landscape.token).not.toBe(portrait.token);
  expect(landscape.shell).toBeLessThan(portrait.shell);
  expect(landscape.overflowX).toBe(0);
});
