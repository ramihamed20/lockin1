import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * Guards for the blocking findings of the phone/iPad responsive audit. Each
 * test names the condition that made a core task impossible, so a regression
 * fails here rather than on a student's device.
 */

const WORKSPACE_ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";
const A4_PAGE_WIDTH = 595;

const LANDSCAPE_PHONES = [
  { width: 667, height: 375, name: "iPhone SE landscape" },
  { width: 844, height: 390, name: "iPhone 14 landscape" },
  { width: 932, height: 430, name: "iPhone 15 Pro Max landscape" }
];

const LANDSCAPE_TABLETS = [
  { width: 1024, height: 768, name: "iPad 9.7in landscape" },
  { width: 1080, height: 810, name: "Galaxy Tab landscape" },
  { width: 1180, height: 820, name: "iPad Air landscape" },
  { width: 1194, height: 834, name: "iPad Pro 11in landscape" }
];

async function mockStudent(page, { language = "en" } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "p0-student", email: "p0@example.test", full_name: "P0 Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    // The workspace sits behind the subscription gate, so the access contract
    // has to answer before the reader renders.
    if (await fulfillAccessContract(route, pathname)) return;
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by the P0 tests" } }) });
  });
}

/** Which shell is on screen, and whether any destination is out of reach. */
function readShell() {
  return {
    sidebarVisible: (() => {
      const sidebar = document.querySelector(".sidebar");
      return Boolean(sidebar && getComputedStyle(sidebar).display !== "none");
    })(),
    bottomNavVisible: (() => {
      const nav = document.querySelector(".bottom-nav");
      return Boolean(nav && getComputedStyle(nav).display !== "none");
    })(),
    hamburgerVisible: (() => {
      const button = document.querySelector(".mobile-menu");
      return Boolean(button && getComputedStyle(button).display !== "none");
    })(),
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
}

// P0: the shell was chosen on width alone, so a phone in landscape received the
// tablet sidebar. The bottom bar and the drawer button were both hidden and the
// sidebar itself was clipped, leaving most destinations unreachable.
for (const viewport of LANDSCAPE_PHONES) {
  test(`a phone in landscape keeps its navigation at ${viewport.name}`, async ({ page }) => {
    await mockStudent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/#/");
    await expect(page.locator(".bottom-nav")).toBeVisible();

    expect(await page.evaluate(readShell)).toEqual({
      sidebarVisible: false,
      bottomNavVisible: true,
      hamburgerVisible: true,
      horizontalOverflow: 0
    });

    // The drawer is the route to everything the bottom bar does not carry.
    await page.locator(".mobile-menu").click();
    const drawer = page.locator(".mobile-drawer");
    await expect(drawer).toHaveClass(/open/);
    await expect(drawer.getByRole("link", { name: "Progress" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Store" })).toBeVisible();
  });
}

// P0: on a tablet in landscape the sidebar list was taller than its box, and
// the scrollbar iPadOS draws only while a finger is moving was the sole hint
// that anything continued below the fold.
for (const viewport of LANDSCAPE_TABLETS) {
  test(`the sidebar admits what it hides at ${viewport.name}`, async ({ page }) => {
    await mockStudent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/#/");
    await expect(page.locator(".sidebar")).toBeVisible();

    const navigation = await page.evaluate(() => {
      const list = document.querySelector(".sidebar .nav-list");
      const hidden = list.scrollHeight - list.clientHeight;
      return {
        hidden,
        cue: list.dataset.overflow,
        masked: getComputedStyle(list).maskImage !== "none",
        // Every destination has to be reachable by scrolling that list.
        destinations: [...list.querySelectorAll("a[href^='#/']")].length
      };
    });

    expect(navigation.destinations).toBeGreaterThan(0);
    if (navigation.hidden > 1) {
      // Anything below the fold has to be announced, not merely scrollable.
      expect(navigation.cue, "the nav list hides destinations without a cue").not.toBe("none");
      expect(navigation.masked, "the hidden edge is not faded").toBe(true);
    } else {
      expect(navigation.cue).toBe("none");
    }

    // The last destination is reachable once the list is scrolled to its end.
    const lastReachable = await page.evaluate(() => {
      const list = document.querySelector(".sidebar .nav-list");
      list.scrollTop = list.scrollHeight;
      const links = [...list.querySelectorAll("a[href^='#/']")];
      const last = links[links.length - 1].getBoundingClientRect();
      return last.top >= 0 && last.bottom <= window.innerHeight + 1;
    });
    expect(lastReachable).toBe(true);
  });
}

// P0: fifteen 44px controls were laid out in a single scrolling strip about
// 240px wide, so seven of them - undo and redo among them - sat off screen
// behind a scroller with no scrollbar and no fade. The toolbar still holds one
// line, but the tools now live in a rail that scrolls sideways and fades the
// edge that hides more: exit and the workspace actions stay pinned outside it,
// and anything the rail hides has to be reachable by scrolling it.
for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`every workspace control is reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(60_000);
    await mockStudent(page);
    await page.setViewportSize(viewport);
    await page.goto(WORKSPACE_ROUTE);
    await page.getByRole("button", { name: /Normal Study/ }).click();
    await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });

    const toolbar = await page.evaluate((size) => {
      const nav = document.querySelector(".workspace-v2-toolbar");
      const rail = nav.querySelector(".workspace-v2-toolbar-scroll");
      const controls = [...nav.querySelectorAll("button")];
      const escaped = (bounds) => bounds.bottom > size.height + 1 || bounds.top < -1;
      return {
        total: controls.length,
        rows: new Set(controls.map((control) => Math.round(control.getBoundingClientRect().top))).size,
        // A pinned control has nowhere to scroll to, so it must be on screen.
        pinnedOffScreen: controls
          .filter((control) => !rail.contains(control))
          .filter((control) => {
            const bounds = control.getBoundingClientRect();
            return escaped(bounds) || bounds.right > size.width + 1 || bounds.left < -1;
          })
          .map((control) => control.getAttribute("aria-label")),
        // A railed control may sit outside the viewport horizontally, never
        // vertically, and never outside the rail's own scrollable track.
        railedOutOfTrack: controls
          .filter((control) => rail.contains(control))
          .filter((control) => {
            const bounds = control.getBoundingClientRect();
            const track = rail.getBoundingClientRect();
            const start = bounds.left - track.left + rail.scrollLeft;
            return escaped(bounds) || start < -1 || start + bounds.width > rail.scrollWidth + 1;
          })
          .map((control) => control.getAttribute("aria-label")),
        underTouchSize: controls
          .filter((control) => {
            const bounds = control.getBoundingClientRect();
            return bounds.width < 44 || bounds.height < 44;
          })
          .map((control) => control.getAttribute("aria-label")),
        railFades: rail.style.getPropertyValue("--workspace-fade-right").trim(),
        railScrollsSideways: rail.scrollWidth > rail.clientWidth + 1,
        // The surfaces that hang below the toolbar follow its measured height.
        publishedHeight: getComputedStyle(document.querySelector(".workspace-v2")).getPropertyValue("--workspace-toolbar-height").trim(),
        actualHeight: `${Math.round(nav.getBoundingClientRect().height)}px`
      };
    }, viewport);

    expect(toolbar.pinnedOffScreen, "pinned workspace controls are off screen").toEqual([]);
    expect(toolbar.railedOutOfTrack, "railed controls are unreachable").toEqual([]);
    expect(toolbar.underTouchSize, "workspace controls are under the touch minimum").toEqual([]);
    expect(toolbar.total).toBeGreaterThanOrEqual(15);
    expect(toolbar.rows, "the toolbar wrapped to a second row").toBe(1);
    expect(toolbar.railScrollsSideways, "a phone cannot hold the whole rail").toBe(true);
    expect(toolbar.railFades, "the hidden edge of the rail is not faded").not.toBe("0px");
    expect(toolbar.publishedHeight).toBe(toolbar.actualHeight);

    // Undo and redo are attached and reach the viewport once the rail is scrolled.
    const historyReachable = await page.evaluate(() => {
      const rail = document.querySelector(".workspace-v2-toolbar-scroll");
      // The rail scrolls smoothly by default, so the jump has to be instant to
      // be measurable in the same frame.
      rail.scrollTo({ left: rail.scrollWidth, behavior: "instant" });
      return ["Undo", "Redo"].map((name) => {
        const button = [...rail.querySelectorAll("button")].find((node) => node.getAttribute("aria-label")?.startsWith(name));
        const bounds = button.getBoundingClientRect();
        const track = rail.getBoundingClientRect();
        return bounds.left >= track.left - 1 && bounds.right <= track.right + 1;
      });
    });
    expect(historyReachable, "undo and redo cannot be scrolled into the rail").toEqual([true, true]);
  });
}

// P0: the remembered zoom was an absolute page scale. A sheet last read on a
// wide screen reopened at that same page width on a phone, leaving most of the
// page outside the viewport - and in Arabic, entirely outside it.
test("a remembered zoom follows the viewport instead of the old page width", async ({ page }) => {
  test.setTimeout(90_000);
  await mockStudent(page);

  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(WORKSPACE_ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });

  // Magnify beyond fit-to-width so there is a preference worth restoring.
  const wide = await page.evaluate((pageWidth) => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    return { fit: stage.clientWidth / pageWidth, stageWidth: stage.clientWidth };
  }, A4_PAGE_WIDTH);
  expect(wide.fit).toBeGreaterThan(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });

  // Re-fitting the page is asynchronous, so read it until it settles.
  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const bounds = document.querySelector(".workspace-v2-a4-canvas").getBoundingClientRect();
    return {
      stageScrollsSideways: stage.scrollWidth > stage.clientWidth + 1,
      canvasFitsStage: Math.round(bounds.width) <= stage.clientWidth + 1,
      canvasOnScreen: bounds.right > 0 && bounds.left < window.innerWidth
    };
  }), "the sheet did not re-fit the phone viewport").toEqual({
    stageScrollsSideways: false,
    canvasFitsStage: true,
    canvasOnScreen: true
  });
});

// P0: a right-to-left reader starts scrolled to its right edge, so a page wider
// than the viewport opened with the document off canvas and the reader blank.
test("the Arabic reader opens on the page, not beside it", async ({ page }) => {
  test.setTimeout(60_000);
  // The signed-in account owns the locale: App.jsx applies preferredLanguage
  // over anything the browser remembered.
  await mockStudent(page, { language: "ar" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(WORKSPACE_ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });

  await expect.poll(async () => page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const bounds = document.querySelector(".workspace-v2-a4-canvas").getBoundingClientRect();
    const visibleWidth = Math.min(bounds.right, window.innerWidth) - Math.max(bounds.left, 0);
    return {
      direction: document.documentElement.dir,
      canvasOnScreen: bounds.right > 0 && bounds.left < window.innerWidth,
      // Practically all of the page is on screen, not a sliver of its margin.
      wholePageVisible: visibleWidth > bounds.width - 2,
      stageScrollsSideways: stage.scrollWidth > stage.clientWidth + 1
    };
  }), "the Arabic reader did not open on the page").toEqual({
    direction: "rtl",
    canvasOnScreen: true,
    wholePageVisible: true,
    stageScrollsSideways: false
  });
});
