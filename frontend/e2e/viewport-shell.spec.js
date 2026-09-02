import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";

/**
 * Who owns the height of the application.
 *
 * One token, `--app-viewport-height`, answers that for the document, the shell,
 * the content frame and every full-screen page. These tests pin the contract
 * that used to be broken: `html` carried `min-height: 100%`, which resolves
 * against the initial containing block, and iOS Safari sizes that block to the
 * viewport with its browser chrome retracted. The document was therefore always
 * as tall as the screen *without* toolbars while the shell was as tall as the
 * screen *with* them, and the difference was a strip of empty scroll under a
 * page that already fitted. The browser parks the page in that strip when it
 * reveals a focused field, which is what drew the application shifted upwards
 * with the fixed bottom bar still correctly placed.
 *
 * Chromium has no collapsible chrome, so the large and dynamic viewports are
 * always equal here and the defect cannot arise on its own. It is reproduced by
 * shortening the token, which is exactly the shape iOS gives it, and asserting
 * that the document follows the token rather than the viewport.
 */

const PHONES = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 430, height: 932 }
];

const TABLETS = [
  { width: 768, height: 1024 },
  { width: 834, height: 1194 },
  { width: 1024, height: 768 }
];

/** The height of the collapsible browser chrome this run is standing in for. */
const SIMULATED_BROWSER_CHROME = 118;

/** Stand in for iOS Safari publishing a shorter transient visual viewport. */
async function simulateBrowserChrome(page, height) {
  await page.evaluate((inset) => {
    const visual = window.visualViewport;
    Object.defineProperty(visual, "height", {
      configurable: true,
      get: () => window.innerHeight - inset
    });
    visual.dispatchEvent(new Event("resize"));
  }, height);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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

/**
 * Every surface that claims to be "the height of the application", measured
 * against the token that defines it. A probe element carries the token so the
 * expected value is read from CSS rather than recomputed in the test.
 */
async function heightAuthority(page) {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;top:0;left:0;width:0;visibility:hidden;height:var(--app-viewport-height)";
    document.body.append(probe);
    const appViewport = Math.round(probe.getBoundingClientRect().height);
    probe.remove();

    const documentElement = document.documentElement;
    const shell = document.querySelector(".app-shell");
    // Closed overlays - the mobile drawer, dismissed sheets - keep their own
    // scrollports off-screen. They are inert, so they are not part of the
    // reading surface and are excluded rather than counted as a second scroller.
    const scrollers = [...document.querySelectorAll(".content-frame *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (!["auto", "scroll"].includes(style.overflowY)) return false;
        if (element.closest("[inert], [aria-hidden='true']")) return false;
        return element.scrollHeight - element.clientHeight > 1;
      })
      .map((element) => String(element.className).split(" ")[0]);

    return {
      appViewport,
      visualViewportHeight: Math.round(window.visualViewport?.height || window.innerHeight),
      documentHeight: Math.round(documentElement.getBoundingClientRect().height),
      bodyHeight: Math.round(document.body.getBoundingClientRect().height),
      rootHeight: Math.round(document.getElementById("root").getBoundingClientRect().height),
      shellHeight: shell ? Math.round(shell.getBoundingClientRect().height) : null,
      rootScrollRange: Math.round(documentElement.scrollHeight - documentElement.clientHeight),
      horizontalOverflow: documentElement.scrollWidth - documentElement.clientWidth,
      scrollers
    };
  });
}

test("short pages own the initial phone and iPad viewport without a first swipe", async ({ page }) => {
  await mockStudentApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  const navigationEntry = page.url();
  for (const viewport of PHONES) {
    await page.setViewportSize(viewport);
    await expect.poll(() => shellMetrics(page)).toEqual({
      horizontalOverflow: 0,
      shellCoversViewport: true,
      rootCoversViewport: true,
      navVisible: true,
      navBottomDelta: 0,
      navTransform: "none",
      pageOverflowY: "visible",
      viewportToken: `${viewport.height}px`
    });
    expect(page.url()).toBe(navigationEntry);
  }

  for (const viewport of TABLETS) {
    await page.setViewportSize(viewport);
    await expect.poll(() => shellMetrics(page)).toEqual({
      horizontalOverflow: 0,
      shellCoversViewport: true,
      rootCoversViewport: true,
      navVisible: false,
      navBottomDelta: null,
      navTransform: null,
      pageOverflowY: "auto",
      viewportToken: `${viewport.height}px`
    });
    expect(page.url()).toBe(navigationEntry);
  }
});

// The regression itself. With browser chrome showing, the document has to be
// the height of what the reader can see - not the height of the screen the
// chrome is covering part of.
for (const viewport of [...PHONES, ...TABLETS]) {
  test(`browser chrome cannot resize the stable shell at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await mockStudentApi(page);
    await page.setViewportSize(viewport);
    await page.goto("/#/bookmarks");
    await expect(page.getByText("Nothing saved yet")).toBeVisible();

    const resting = await heightAuthority(page);
    expect(resting.appViewport).toBe(viewport.height);
    expect(resting.documentHeight, "the document follows the application viewport").toBe(resting.appViewport);
    expect(resting.bodyHeight).toBe(resting.appViewport);
    expect(resting.rootHeight).toBe(resting.appViewport);
    expect(resting.shellHeight).toBe(resting.appViewport);
    expect(resting.rootScrollRange, "a page that fits the screen carries no root scroll").toBe(0);
    expect(resting.horizontalOverflow).toBe(0);

    await simulateBrowserChrome(page, SIMULATED_BROWSER_CHROME);
    const withChrome = await heightAuthority(page);
    expect(withChrome.visualViewportHeight).toBe(viewport.height - SIMULATED_BROWSER_CHROME);
    expect(withChrome.appViewport).toBe(resting.appViewport);
    expect(withChrome.documentHeight, "browser chrome resized the document frame").toBe(resting.documentHeight);
    expect(withChrome.bodyHeight).toBe(resting.bodyHeight);
    expect(withChrome.rootHeight).toBe(resting.rootHeight);
    expect(withChrome.shellHeight).toBe(resting.shellHeight);
    expect(withChrome.horizontalOverflow).toBe(0);
  });
}

// Exactly one surface scrolls vertically, and which one it is is a property of
// the layout rather than an accident: the phone shell scrolls the document, the
// tablet and desktop shells scroll the page inside a fixed frame.
test("only the intended container owns vertical scrolling", async ({ page }) => {
  await mockStudentApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  // Content the screen cannot hold, so the question "which surface scrolls?"
  // has an answer to read. The block is removed again before the next case.
  const growPage = () => page.evaluate(() => {
    const filler = document.createElement("div");
    filler.id = "viewport-scroll-probe";
    filler.style.cssText = "height:2400px";
    document.querySelector(".page-shell").append(filler);
  });
  const shrinkPage = () => page.evaluate(() => document.getElementById("viewport-scroll-probe")?.remove());

  await growPage();
  const phone = await heightAuthority(page);
  expect(phone.scrollers, "the phone shell scrolls the document, not a nested box").toEqual([]);
  expect(phone.rootScrollRange, "a long page scrolls the document").toBeGreaterThan(0);
  await shrinkPage();

  await page.setViewportSize({ width: 1024, height: 768 });
  await growPage();
  await expect.poll(async () => (await heightAuthority(page)).scrollers).toEqual(["page-shell"]);
  const tablet = await heightAuthority(page);
  expect(tablet.rootScrollRange, "the tablet shell must not scroll the document as well").toBe(0);
  expect(tablet.documentHeight).toBe(tablet.appViewport);
  await shrinkPage();
});

// A rotation replaces every viewport measurement at once. Nothing may survive it.
test("rotation leaves no stale viewport values", async ({ page }) => {
  await mockStudentApi(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 834, height: 1194 },
    { width: 1194, height: 834 },
    { width: 1024, height: 768 }
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const measured = await heightAuthority(page);
      return {
        appViewport: measured.appViewport,
        documentHeight: measured.documentHeight,
        shellHeight: measured.shellHeight,
        rootScrollRange: measured.rootScrollRange,
        horizontalOverflow: measured.horizontalOverflow
      };
    }).toEqual({
      appViewport: viewport.height,
      documentHeight: viewport.height,
      shellHeight: viewport.height,
      rootScrollRange: 0,
      horizontalOverflow: 0
    });
  }
});

test("Recent Sheets stays dense and the cat stays proportionate on iPad portrait", async ({ page }) => {
  await mockStudentApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.materials.recent-opened-sheets", JSON.stringify([
      { materialSlug: "conservative", sheetSlug: "sheet-1" },
      { materialSlug: "microbiology", sheetSlug: "sheet-2" },
      { materialSlug: "pharmacy", sheetSlug: "sheet-3" },
      { materialSlug: "oral-histology", sheetSlug: "sheet-4" }
    ]));
  });

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 834, height: 1194 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/dashboard");
    await expect(page.getByRole("heading", { name: "Recent Sheets" })).toBeVisible();

    const layout = await page.evaluate(() => {
      const recent = document.querySelector(".dashboard-recent-sheets")?.getBoundingClientRect();
      const scene = document.querySelector(".dashboard-right .scene-card")?.getBoundingClientRect();
      return {
        recentHeight: Math.round(recent?.height || 0),
        recentRows: document.querySelectorAll(".dashboard-recent-sheets .dashboard-review-item").length,
        sceneWidth: Math.round(scene?.width || 0),
        sceneStartsAfterRecent: Boolean(recent && scene && scene.top >= recent.bottom + 12),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    expect(layout.recentHeight).toBeGreaterThanOrEqual(240);
    expect(layout.recentHeight).toBeLessThanOrEqual(290);
    expect(layout.recentRows).toBe(4);
    expect(layout.sceneWidth).toBe(420);
    expect(layout.sceneStartsAfterRecent).toBe(true);
    expect(layout.horizontalOverflow).toBe(0);
  }
});

test("dashboard sizing and last-opened navigation stay correct from phone to desktop", async ({ page }) => {
  await mockStudentApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.materials.recent-opened-sheets", JSON.stringify([
      { materialSlug: "microbiology", sheetSlug: "sheet-2" },
      { materialSlug: "pharmacy", sheetSlug: "sheet-3" },
      { materialSlug: "conservative", sheetSlug: "sheet-1" },
      { materialSlug: "oral-histology", sheetSlug: "sheet-4" }
    ]));
  });

  for (const expected of [
    { viewport: { width: 320, height: 568 }, continueHeight: 164, minSceneWidth: 261, maxSceneWidth: 263 },
    { viewport: { width: 375, height: 812 }, continueHeight: 164, minSceneWidth: 307, maxSceneWidth: 309 },
    { viewport: { width: 390, height: 844 }, continueHeight: 164, minSceneWidth: 309, maxSceneWidth: 311 },
    { viewport: { width: 430, height: 932 }, continueHeight: 164, minSceneWidth: 309, maxSceneWidth: 311 },
    { viewport: { width: 1024, height: 768 }, continueHeight: 184, minSceneWidth: 400, maxSceneWidth: 460 },
    { viewport: { width: 1440, height: 900 }, continueHeight: 184, minSceneWidth: 480, maxSceneWidth: 500 }
  ]) {
    await page.setViewportSize(expected.viewport);
    await page.goto("/#/dashboard");
    await expect(page.getByRole("heading", { name: "Microbiology sheet 2" })).toBeVisible();

    const continueLink = page.getByRole("link", { name: "Continue", exact: true });
    await expect(continueLink).toHaveAttribute("href", "#/materials/catalog/microbiology/sheets/sheet-2");
    await expect(page.locator(".dashboard-recent-sheets .dashboard-review-item")).toHaveCount(4);

    const layout = await page.evaluate(() => {
      const continueCard = document.querySelector(".continue-card")?.getBoundingClientRect();
      const scene = document.querySelector(".dashboard-right .scene-card")?.getBoundingClientRect();
      const image = document.querySelector(".dashboard-right .scene-theme");
      return {
        continueHeight: Math.round(continueCard?.height || 0),
        sceneWidth: Math.round(scene?.width || 0),
        imageFit: image ? getComputedStyle(image).objectFit : null,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    expect(layout.continueHeight).toBe(expected.continueHeight);
    expect(layout.sceneWidth).toBeGreaterThanOrEqual(expected.minSceneWidth);
    expect(layout.sceneWidth).toBeLessThanOrEqual(expected.maxSceneWidth);
    expect(layout.imageFit).toBe("contain");
    expect(layout.horizontalOverflow).toBe(0);
  }
});

test("bottom navigation items never collide at supported phone widths", async ({ page }) => {
  await mockStudentApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  for (const viewport of PHONES.filter(({ width }) => [320, 375, 390, 430].includes(width))) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".bottom-nav > a, .bottom-nav > button")];
      const boxes = items.map((item) => {
        const itemBox = item.getBoundingClientRect();
        const iconBox = item.querySelector("svg")?.getBoundingClientRect();
        const labelBox = item.querySelector("span")?.getBoundingClientRect();
        return {
          left: itemBox.left,
          right: itemBox.right,
          top: itemBox.top,
          bottom: itemBox.bottom,
          height: itemBox.height,
          childrenContained: Boolean(iconBox && labelBox
            && iconBox.left >= itemBox.left - 0.5 && iconBox.right <= itemBox.right + 0.5
            && labelBox.left >= itemBox.left - 0.5 && labelBox.right <= itemBox.right + 0.5
            && iconBox.bottom <= labelBox.top + 0.5)
        };
      });
      return {
        count: boxes.length,
        minHeight: Math.min(...boxes.map((box) => box.height)),
        independentTargets: boxes.every((box, index) => index === 0 || boxes[index - 1].right <= box.left + 0.5),
        childrenContained: boxes.every((box) => box.childrenContained),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    expect(layout).toEqual({
      count: 5,
      minHeight: 48,
      independentTargets: true,
      childrenContained: true,
      horizontalOverflow: 0
    });
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
