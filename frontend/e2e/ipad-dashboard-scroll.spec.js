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
  { name: "pro landscape 1366x1024", width: 1366, height: 1024 },
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
  { name: "desktop", width: 1440, height: 960 },
  { name: "wide desktop", width: 2560, height: 1440 }
]) {
  test(`None mascot removes the Dashboard illustration slot (${device.name})`, async ({ page }) => {
    await mockDashboard(page, "none");
    await page.setViewportSize({ width: device.width, height: device.height });
    await page.goto("/#/");
    await expect(page.locator(".continue-card")).toBeVisible();
    await expect(page.locator(".dashboard-art")).toHaveCount(0);
    await expect(page.locator(".scene-card")).toHaveCount(0);
    const layout = await page.locator(".dashboard").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      continueWidth: element.querySelector(".continue-card").getBoundingClientRect().width
    }));
    expect(Math.abs(layout.width - layout.continueWidth)).toBeLessThanOrEqual(1);
  });
}

// The cat sits inside Continue and is the same small size for both cats, so
// the study cards never change width with the mascot choice.
for (const device of [
  { name: "iPad landscape", width: 1112, height: 834 },
  { name: "desktop", width: 1440, height: 960 }
]) {
  test(`mascot choice never changes Dashboard card widths (${device.name})`, async ({ browser }) => {
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
    const [blackContinue, whiteContinue, noneContinue, blackQueue, whiteQueue, noneQueue] = await Promise.all([
      width(blackPage, ".continue-card"),
      width(whitePage, ".continue-card"),
      width(nonePage, ".continue-card"),
      width(blackPage, ".dashboard-review-queue"),
      width(whitePage, ".dashboard-review-queue"),
      width(nonePage, ".dashboard-review-queue")
    ]);
    expect(Math.abs(noneContinue - blackContinue)).toBeLessThanOrEqual(1);
    expect(Math.abs(noneContinue - whiteContinue)).toBeLessThanOrEqual(1);
    expect(Math.abs(noneQueue - blackQueue)).toBeLessThanOrEqual(1);
    expect(Math.abs(noneQueue - whiteQueue)).toBeLessThanOrEqual(1);
    const [blackArt, whiteArt] = await Promise.all([width(blackPage, ".dashboard-art"), width(whitePage, ".dashboard-art")]);
    expect(blackArt).toBeLessThanOrEqual(144);
    expect(Math.abs(blackArt - whiteArt)).toBeLessThanOrEqual(1);
    await Promise.all([blackContext.close(), whiteContext.close(), noneContext.close()]);
  });
}

test("None mascot keeps iPad portrait study cards full-width", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 834, height: 1112 } });
  const page = await context.newPage();
  await mockDashboard(page, "none");
  await page.goto("/#/");

  const [mainWidth, continueWidth, queueWidth] = await Promise.all([
    page.locator(".dashboard").evaluate((element) => element.getBoundingClientRect().width),
    page.locator(".continue-card").evaluate((element) => element.getBoundingClientRect().width),
    page.locator(".dashboard-review-queue").evaluate((element) => element.getBoundingClientRect().width)
  ]);
  expect(Math.abs(mainWidth - continueWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(mainWidth - queueWidth)).toBeLessThanOrEqual(1);
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
    await page.waitForFunction(() => !document.querySelector(".sidebar .streak-mini[aria-busy]"));

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

// Reported from an iPad in portrait: the sidebar could not be scrolled to its
// last entries, and the four dashboard cards split across two rows that pushed
// the study surfaces below the fold. A rail this short leaves out the streak
// reading by design (it returns on tall rails), so only its placement is held.
test("the rail scrolls to its last entry in portrait, streak reading and all", async ({ page }) => {
  await mockDashboard(page);
  // 744 is an iPad mini in portrait, and any iPad in Split View. Below 768 the
  // rail is a flex column, which is where the list used to be cut off.
  await page.setViewportSize({ width: 744, height: 700 });
  await page.goto("/#/");
  await expect(page.locator(".sidebar")).toBeVisible();

  // An account whose roles add Workspace entries: more than the rail can show.
  await page.evaluate(() => {
    const list = document.querySelector(".sidebar .nav-list");
    const entry = list.lastElementChild;
    for (let index = 0; index < 4; index += 1) list.appendChild(entry.cloneNode(true));
  });

  const measured = await page.evaluate(async () => {
    const list = document.querySelector(".sidebar .nav-list");
    list.scrollTop = list.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const rail = document.querySelector(".sidebar").getBoundingClientRect();
    const last = list.lastElementChild.getBoundingClientRect();
    const streak = document.querySelector(".sidebar .streak-mini")?.getBoundingClientRect();
    return {
      scrolls: list.scrollHeight > list.clientHeight + 1,
      scrolled: list.scrollTop > 0,
      lastEntryInside: last.bottom <= rail.bottom + 1 && last.top >= rail.top - 1,
      streakInside: Boolean(streak) && (streak.height === 0 || streak.bottom <= rail.bottom + 1)
    };
  });

  expect(measured).toEqual({ scrolls: true, scrolled: true, lastEntryInside: true, streakInside: true });
});

// The state cards take a grid that fills every row (2, 3 or 6 columns,
// chosen by the width they get), so on no iPad is a card squeezed, left alone
// on a row, or pushed into a sideways scroll.
for (const ipad of IPADS) {
  test(`dashboard state cards fill whole rows without scrolling sideways on ${ipad.name}`, async ({ page }) => {
    await mockDashboard(page);
    await page.setViewportSize({ width: ipad.width, height: ipad.height });
    await page.goto("/#/");
    const grid = page.locator(".dash-states-grid");
    await expect(grid).toBeVisible();

    const measured = await grid.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const cards = [...element.children].map((card) => card.getBoundingClientRect());
      const rows = new Map();
      for (const card of cards) {
        const key = Math.round(card.top);
        rows.set(key, [...(rows.get(key) || []), card]);
      }
      return {
        count: cards.length,
        rowsFilled: [...rows.values()].every((row) => Math.min(...row.map((card) => card.left)) <= box.left + 1 && Math.max(...row.map((card) => card.right)) >= box.right - 1),
        narrowest: Math.round(Math.min(...cards.map((card) => card.width))),
        scrolls: element.scrollWidth > element.clientWidth + 1,
        pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    });

    expect(measured.count).toBe(5);
    expect(measured.rowsFilled).toBe(true);
    expect(measured.narrowest).toBeGreaterThanOrEqual(128);
    expect(measured.scrolls).toBe(false);
    expect(measured.pageScrollsSideways).toBe(false);
  });
}
