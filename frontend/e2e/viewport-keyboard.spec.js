import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";

/**
 * The application across a keyboard session.
 *
 * The report was that after typing anywhere - a search box, a note, a form -
 * the application stayed displaced upwards with a blank strip along the bottom,
 * and only a downward drag put it back. Two things had to be true for that:
 * the document had to be taller than the visible viewport (fixed separately,
 * and pinned by `viewport-shell.spec.js`), and nothing put the page back when
 * the keyboard went away.
 *
 * These tests drive the second half. Chromium raises no virtual keyboard, so
 * both shapes browsers give one are installed directly - the same simulation
 * the Focus Workspace specs use:
 *
 *   visual   an iOS Safari tab: only the visual viewport shrinks, the layout
 *            viewport and `dvh` are untouched.
 *   content  an installed iOS app, or a `resizes-content` Chrome: the layout
 *            viewport shortens and `dvh` with it.
 *
 * What must hold afterwards is the same under both, and it is deliberately
 * stronger than "the page is at the top": a reader who was half way down a page
 * has to still be half way down it.
 */

test.use({ hasTouch: true });

const PHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1024, height: 768 };
const IPAD_PORTRAIT = { width: 768, height: 1024 };

async function setKeyboard(page, viewport, inset, mode) {
  if (mode === "content") {
    await page.setViewportSize({ width: viewport.width, height: viewport.height - inset });
  } else {
    await page.evaluate((height) => {
      const visual = window.visualViewport;
      if (height > 0) {
        Object.defineProperty(visual, "height", { configurable: true, get: () => document.documentElement.clientHeight - height });
      } else {
        delete visual.height;
      }
      visual.dispatchEvent(new Event("resize"));
    }, inset);
  }
  // One frame for the sync layer's rAF, one for the style to land.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function shellGeometry(page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const shell = document.querySelector(".app-shell");
    const nav = document.querySelector(".bottom-nav");
    const navStyle = nav ? getComputedStyle(nav) : null;
    const shellBounds = shell?.getBoundingClientRect();
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;top:0;left:0;width:0;visibility:hidden;height:var(--app-viewport-height)";
    document.body.append(probe);
    const appViewport = Math.round(probe.getBoundingClientRect().height);
    probe.remove();

    return {
      appViewport,
      keyboardInset: getComputedStyle(documentElement).getPropertyValue("--keyboard-inset").trim(),
      keyboardFlag: documentElement.dataset.keyboard || "closed",
      documentHeight: Math.round(documentElement.getBoundingClientRect().height),
      shellTop: Math.round(shellBounds?.top ?? NaN),
      shellHeight: Math.round(shellBounds?.height ?? NaN),
      rootScrollRange: Math.round(documentElement.scrollHeight - documentElement.clientHeight),
      scrollY: Math.round(window.scrollY),
      navBottomDelta: nav && navStyle.display !== "none"
        ? Math.round(documentElement.clientHeight - nav.getBoundingClientRect().bottom)
        : null,
      horizontalOverflow: documentElement.scrollWidth - documentElement.clientWidth
    };
  });
}

/**
 * Wait until the shell has finished arriving. Skeletons are taller than the
 * content that replaces them, so a baseline taken too early is a measurement of
 * the loading state rather than of the page.
 */
async function waitForStableShell(page) {
  let previous = null;
  await expect.poll(async () => {
    const sample = JSON.stringify(await shellGeometry(page));
    const stable = sample === previous;
    previous = sample;
    return stable;
  }, { message: "the shell never stopped moving" }).toBe(true);
  return shellGeometry(page);
}

/** The subset of the geometry that has to be back exactly as it was. */
async function restingGeometry(page) {
  const {
    keyboardFlag, keyboardInset, appViewport, documentHeight, shellTop,
    shellHeight, scrollY, rootScrollRange, navBottomDelta, horizontalOverflow
  } = await shellGeometry(page);
  return {
    keyboardFlag, keyboardInset, appViewport, documentHeight, shellTop,
    shellHeight, scrollY, rootScrollRange, navBottomDelta, horizontalOverflow
  };
}

/**
 * Arrive as a student who has already answered the install prompt. A touch
 * context is offered it on load, and it holds the whole application inert
 * behind it - these tests are about the keyboard, not the prompt.
 */
async function openShell(page, route) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); } catch { /* private mode */ }
  });
  await page.goto(route);
}

/**
 * A plain text field inside the page, present at every width.
 *
 * The shell's own fields move between breakpoints - the top bar's search box
 * becomes a button that opens a full-screen layer on a phone, and a
 * `resizes-content` keyboard is deep enough to cross that breakpoint mid-test.
 * These cases are about the geometry of the shell around a keyboard session
 * rather than about any one field, so they use a field that cannot move.
 * The application's real fields are exercised separately, below.
 */
async function addProbeField(page) {
  await page.evaluate(() => {
    document.getElementById("viewport-keyboard-probe")?.remove();
    const field = document.createElement("input");
    field.id = "viewport-keyboard-probe";
    field.type = "text";
    document.querySelector(".page-shell").append(field);
  });
  return page.locator("#viewport-keyboard-probe");
}

async function focusField(page, field) {
  await field.click();
  await expect.poll(() => page.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName))).toBe(true);
}

/**
 * Put the caret in the search field, however this width presents it: the tablet
 * and desktop top bars carry the field inline, a phone top bar carries a button
 * that opens it as a full-screen layer.
 */
async function focusSearchField(page) {
  const inlineField = page.locator(".topbar .search-box input").first();
  if (await inlineField.isVisible()) {
    await focusField(page, inlineField);
    return inlineField;
  }
  await page.locator(".topbar-search-action").first().click();
  const layerField = page.locator(".global-search-mobile-layer input").first();
  await expect(layerField).toBeVisible();
  await focusField(page, layerField);
  return layerField;
}

for (const { viewport, name } of [
  { viewport: PHONE, name: "iPhone" },
  { viewport: IPAD_PORTRAIT, name: "iPad portrait" },
  { viewport: IPAD_LANDSCAPE, name: "iPad landscape" }
]) {
  for (const mode of ["visual", "content"]) {
    test(`five ${mode}-resize keyboard cycles leave the ${name} shell exactly where it started`, async ({ page }) => {
      test.setTimeout(90_000);
      await mockStudentApi(page);
      await page.setViewportSize(viewport);
      await openShell(page, "/#/bookmarks");
      await expect(page.getByText("Nothing saved yet")).toBeVisible();

      const field = await addProbeField(page);

      const before = await waitForStableShell(page);
      expect(before.keyboardFlag).toBe("closed");
      expect(before.keyboardInset).toBe("0px");
      expect(before.rootScrollRange, "the resting page carries no phantom scroll").toBe(0);

      for (const pass of [1, 2, 3, 4, 5]) {
        // A fresh session each time: the reader taps into the field, types,
        // and puts the keyboard away again, exactly as reported.
        await focusField(page, field);
        await setKeyboard(page, viewport, Math.round(viewport.height * 0.42), mode);
        const open = await shellGeometry(page);
        expect(open.keyboardFlag, `pass ${pass}: the keyboard went unnoticed`).toBe("open");
        expect(Number.parseInt(open.keyboardInset, 10), `pass ${pass}: no inset was published`).toBeGreaterThan(120);
        expect(open.shellTop, `pass ${pass}: the shell left the top of the viewport`).toBe(before.shellTop);
        // `dvh` ignores the keyboard by specification, and an installed app
        // shortens it - either way the shell must not be repositioned.
        expect(open.horizontalOverflow, `pass ${pass}: the page overflowed sideways`).toBe(0);

        await field.fill(`micro ${pass}`);

        await setKeyboard(page, viewport, 0, mode);
        await page.evaluate(() => document.activeElement?.blur());
        await setKeyboard(page, viewport, 0, mode);

        // The bottom bar stands down for the keyboard through React state, so
        // the shell needs its render before it is measured. Everything else
        // here has already settled.
        await expect.poll(() => restingGeometry(page), { message: `pass ${pass}: the shell did not return to the viewport` }).toEqual({
          keyboardFlag: "closed",
          keyboardInset: "0px",
          appViewport: before.appViewport,
          documentHeight: before.documentHeight,
          shellTop: before.shellTop,
          shellHeight: before.shellHeight,
          scrollY: 0,
          rootScrollRange: 0,
          navBottomDelta: before.navBottomDelta,
          horizontalOverflow: 0
        });
      }
    });
  }
}

/**
 * Below the desktop width, Settings shows one section at a time; the password
 * fields live behind the Account tab.
 */
async function focusAccountPassword(page) {
  const tab = page.getByRole("button", { name: "Account", exact: true });
  if (await tab.isVisible()) await tab.click();
  const field = page.locator(".page-shell input[type='password']").first();
  await expect(field).toBeVisible();
  await field.scrollIntoViewIfNeeded();
  await focusField(page, field);
  return field;
}

// The same behaviour has to hold for the application's own fields, wherever
// they live, because the fix is in the shell rather than in any one of them.
const REAL_FIELDS = [
  { name: "search", viewport: PHONE, route: "/#/bookmarks", focus: (page) => focusSearchField(page) },
  { name: "search", viewport: IPAD_LANDSCAPE, route: "/#/bookmarks", focus: (page) => focusSearchField(page) },
  { name: "settings account form", viewport: PHONE, route: "/#/settings", focus: focusAccountPassword },
  { name: "settings account form", viewport: IPAD_PORTRAIT, route: "/#/settings", focus: focusAccountPassword }
];

for (const { name, viewport, route } of REAL_FIELDS) {
  test(`the ${name} at ${viewport.width}x${viewport.height} returns the shell to the viewport`, async ({ page }) => {
    test.setTimeout(60_000);
    const entry = REAL_FIELDS.find((candidate) => candidate.name === name && candidate.viewport === viewport);
    await mockStudentApi(page);
    await page.setViewportSize(viewport);
    await openShell(page, route);
    await expect(page.locator(".app-shell")).toBeVisible();

    await waitForStableShell(page);
    await entry.focus(page);
    // The baseline is taken with the caret already in the field: reaching some
    // of these fields means opening a section or scrolling to them, and that
    // position is the reader's. What must survive the keyboard is the state the
    // application was in the instant before it appeared.
    const before = await waitForStableShell(page);

    await setKeyboard(page, viewport, Math.round(viewport.height * 0.42), "visual");
    expect((await shellGeometry(page)).keyboardFlag, "the keyboard went unnoticed").toBe("open");

    await setKeyboard(page, viewport, 0, "visual");
    await page.evaluate(() => document.activeElement?.blur());
    await setKeyboard(page, viewport, 0, "visual");

    await expect.poll(async () => {
      const after = await shellGeometry(page);
      return {
        keyboardFlag: after.keyboardFlag,
        keyboardInset: after.keyboardInset,
        appViewport: after.appViewport,
        shellTop: after.shellTop,
        shellHeight: after.shellHeight,
        scrollY: after.scrollY,
        navBottomDelta: after.navBottomDelta,
        horizontalOverflow: after.horizontalOverflow
      };
    }, { message: "the shell stayed displaced after the keyboard closed" }).toEqual({
      keyboardFlag: "closed",
      keyboardInset: "0px",
      appViewport: before.appViewport,
      shellTop: before.shellTop,
      shellHeight: before.shellHeight,
      scrollY: before.scrollY,
      navBottomDelta: before.navBottomDelta,
      horizontalOverflow: 0
    });
  });
}

// The correction has to be able to tell the browser's displacement from the
// reader's own position. A page left half way through must stay half way
// through - the fix must not become a disguised jump to the top.
test("a keyboard session preserves a real reading position", async ({ page }) => {
  await mockStudentApi(page);
  await page.setViewportSize(PHONE);
  await openShell(page, "/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.style.cssText = "height:2400px";
    document.querySelector(".page-shell").append(filler);
  });
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(900);

  const field = await focusSearchField(page);
  await setKeyboard(page, PHONE, 350, "visual");
  expect((await shellGeometry(page)).keyboardFlag).toBe("open");
  await field.fill("halfway");

  await setKeyboard(page, PHONE, 0, "visual");
  await page.evaluate(() => document.activeElement?.blur());
  await setKeyboard(page, PHONE, 0, "visual");

  const after = await shellGeometry(page);
  expect(after.keyboardFlag).toBe("closed");
  expect(after.scrollY, "the reader was thrown back to the top of the page").toBe(900);
});

// Rotating with a keyboard session just behind you is the iPad landscape case
// from the report. Nothing measured during the old rotation may survive it.
test("iPad landscape recovers after rotating with a keyboard session behind it", async ({ page }) => {
  test.setTimeout(90_000);
  await mockStudentApi(page);
  await page.setViewportSize(IPAD_LANDSCAPE);
  await openShell(page, "/#/bookmarks");
  await expect(page.getByText("Nothing saved yet")).toBeVisible();

  const field = await focusSearchField(page);
  await setKeyboard(page, IPAD_LANDSCAPE, 320, "visual");
  expect((await shellGeometry(page)).keyboardFlag).toBe("open");
  await field.fill("rotate");
  await setKeyboard(page, IPAD_LANDSCAPE, 0, "visual");
  await page.evaluate(() => document.activeElement?.blur());
  await setKeyboard(page, IPAD_LANDSCAPE, 0, "visual");

  for (const viewport of [IPAD_PORTRAIT, IPAD_LANDSCAPE, IPAD_PORTRAIT, IPAD_LANDSCAPE]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const measured = await shellGeometry(page);
      return {
        appViewport: measured.appViewport,
        documentHeight: measured.documentHeight,
        shellHeight: measured.shellHeight,
        shellTop: measured.shellTop,
        keyboardInset: measured.keyboardInset,
        rootScrollRange: measured.rootScrollRange,
        horizontalOverflow: measured.horizontalOverflow
      };
    }).toEqual({
      appViewport: viewport.height,
      documentHeight: viewport.height,
      shellHeight: viewport.height,
      shellTop: 0,
      keyboardInset: "0px",
      rootScrollRange: 0,
      horizontalOverflow: 0
    });
  }
});

// Mobile Safari magnifies the page when it focuses a control whose text is
// under 16px, and it does not magnify back out - which is a displacement of its
// own. The floor is asserted on the controls themselves.
for (const viewport of [{ width: 320, height: 568 }, PHONE, IPAD_PORTRAIT, IPAD_LANDSCAPE]) {
  test(`text fields never invite browser auto-zoom at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await mockStudentApi(page);
    await page.setViewportSize(viewport);

    for (const route of ["/#/settings", "/#/store", "/#/progress", "/#/login"]) {
      await openShell(page, route);
      await expect(page.locator("input, textarea, select").first()).toBeAttached();
      const tooSmall = await page.evaluate(() => [...document.querySelectorAll("input, textarea, select")]
        .filter((field) => !["color", "range", "file", "checkbox", "radio", "submit", "button", "reset", "hidden"].includes(field.type))
        .map((field) => ({ name: field.getAttribute("aria-label") || field.name || field.type, size: Number.parseFloat(getComputedStyle(field).fontSize) }))
        .filter((field) => field.size < 16));
      expect(tooSmall, `${route}: a text field under 16px makes mobile Safari magnify the page`).toEqual([]);
    }
  });
}
