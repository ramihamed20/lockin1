import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * The note editor and the on-screen keyboard.
 *
 * Two failures are guarded here, and they have different causes.
 *
 * The first is browser magnification: mobile Safari zooms the whole page when
 * it focuses a control whose text is under 16px, and it never zooms back out.
 * The workspace is a fixed immersive surface, so the reader stayed magnified
 * for the rest of the session. That one is guarded by measuring the field.
 *
 * The second is frame collapse: some browsers - an installed iOS app, some
 * Android configurations - shorten the layout viewport for the keyboard, and
 * `dvh` with it. The reader's frame is the PDF's coordinate space, so a
 * shorter frame re-lays-out the document and moves the page under the reader.
 * Chromium has no virtual keyboard to drive, so the visual viewport it would
 * produce is simulated and the reader's geometry measured across the cycle.
 */

// Every viewport here is a device with a virtual keyboard, so the context
// carries touch: the sizing floors that keep mobile Safari from magnifying
// the page are gated on a coarse pointer and a mouse-only context never sees
// them.
test.use({ hasTouch: true });

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

const PHONES = [
  { width: 320, height: 568, name: "phone-320" },
  { width: 375, height: 667, name: "phone-375" },
  { width: 390, height: 844, name: "phone-390" },
  { width: 430, height: 932, name: "phone-430" },
  { width: 412, height: 915, name: "android-412" }
];

const TABLETS = [
  { width: 768, height: 1024, name: "ipad-portrait" },
  { width: 1024, height: 768, name: "ipad-landscape" }
];

async function mockStudent(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") {
      return json({ user: { id: "keyboard-student", email: "keyboard@example.test", full_name: "Keyboard Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    }
    if (pathname === "/api/v1/operations/session") {
      return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    }
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      return json({ active_session: null });
    }
    return json({ count: 0, results: [] });
  });
}

async function openWorkspace(page) {
  // A touch context is offered the install prompt, and it holds the whole app
  // inert behind it. These tests are about the keyboard, so they arrive as a
  // student who has already answered it.
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); } catch { /* private mode */ }
  });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 25_000 });
}

/**
 * Stand in for the on-screen keyboard, in both of the shapes browsers give it.
 *
 * `visual` is an iOS Safari tab or a default Chrome: the layout viewport and
 * `dvh` are untouched and only the visual viewport shrinks. `content` is an
 * installed iOS app or a `resizes-content` Chrome: the layout viewport itself
 * shortens, `dvh` with it, and the reader's frame would collapse unless the
 * component pins it. Chromium raises no keyboard of its own, so each shape is
 * installed directly.
 */
async function setKeyboardInset(page, viewport, inset, mode) {
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
  // One frame for the component's rAF, one for the style to land.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * The reader keeps moving for a while after it opens: the stored view is
 * restored once hydration lands, and a zoom commit settles over several
 * frames. The baseline is therefore taken once the transform and both scroll
 * offsets have held still for three consecutive samples, not after a fixed
 * wait - otherwise a late restore lands between the baseline and the
 * measurement and looks exactly like the bug under test.
 */
async function waitForStableReader(page) {
  await page.evaluate(() => { window.__readerSample = null; window.__readerStable = 0; });
  await page.waitForFunction(() => {
    const layer = document.querySelector(".workspace-v2-a4-document");
    const stage = document.querySelector(".workspace-v2-document-stage");
    if (!layer || !stage) return false;
    const busy = document.querySelector(".workspace-v2.is-zoom-settling, .workspace-v2.is-live-pinching");
    const sample = `${getComputedStyle(layer).transform}|${Math.round(stage.scrollTop)}|${Math.round(stage.scrollLeft)}`;
    window.__readerStable = !busy && window.__readerSample === sample ? window.__readerStable + 1 : 0;
    window.__readerSample = sample;
    return window.__readerStable >= 3;
  }, null, { timeout: 20_000, polling: 150 });
}

function readerState(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".workspace-v2");
    const stage = document.querySelector(".workspace-v2-document-stage");
    const toolbar = document.querySelector(".workspace-v2-toolbar");
    const drawer = document.querySelector(".workspace-v2-side");
    const zoomLayer = document.querySelector(".workspace-v2-a4-document");
    return {
      keyboard: root.dataset.keyboard || "closed",
      rootHeight: Math.round(root.getBoundingClientRect().height),
      stageWidth: Math.round(stage.getBoundingClientRect().width),
      stageHeight: Math.round(stage.getBoundingClientRect().height),
      scrollTop: Math.round(stage.scrollTop),
      scrollLeft: Math.round(stage.scrollLeft),
      // The PDF's live scale lives in the transform of the zoom layer.
      transform: zoomLayer ? getComputedStyle(zoomLayer).transform : null,
      toolbarTop: Math.round(toolbar.getBoundingClientRect().top),
      toolbarVisible: toolbar.getBoundingClientRect().bottom > 0,
      drawerBottom: drawer ? Math.round(window.innerHeight - drawer.getBoundingClientRect().bottom) : null,
      drawerHeight: drawer ? Math.round(drawer.getBoundingClientRect().height) : null,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      documentScrollTop: Math.round(document.scrollingElement?.scrollTop || 0)
    };
  });
}

// The root cause. A field under 16px is what makes mobile Safari magnify the
// page in the first place, so the floor is asserted directly on the control.
for (const viewport of [...PHONES, ...TABLETS]) {
  test(`the note field never invites browser auto-zoom at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(90_000);
    await mockStudent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openWorkspace(page);
    await page.locator('[data-workspace-tool="note"]').click();
    await expect(page.locator(".workspace-v2-note-editor textarea")).toBeVisible();

    const fields = await page.evaluate(() => [...document.querySelectorAll(".workspace-v2 textarea, .workspace-v2 input")]
      .filter((field) => !["color", "range", "file", "checkbox", "radio"].includes(field.type))
      .map((field) => ({
        label: field.getAttribute("aria-label") || field.tagName.toLowerCase(),
        size: Number.parseFloat(getComputedStyle(field).fontSize)
      })));

    expect(fields.length).toBeGreaterThan(0);
    const tooSmall = fields.filter((field) => field.size < 16);
    expect(tooSmall, "a text field under 16px makes mobile Safari magnify the workspace").toEqual([]);
  });
}

// The layout response. The reader's frame, zoom and scroll have to survive a
// full keyboard session, twice over, exactly as they were.
const KEYBOARD_SESSIONS = [
  ...[...PHONES, ...TABLETS].map((viewport) => ({ viewport, mode: "visual" })),
  // The frame-collapsing shape is the expensive one to run, so it covers one
  // phone of each platform and the tablet rather than every width.
  ...[PHONES[2], PHONES[4], TABLETS[0]].map((viewport) => ({ viewport, mode: "content" }))
];

for (const { viewport, mode } of KEYBOARD_SESSIONS) {
  test(`the reader survives a ${mode}-resize keyboard session at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await mockStudent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openWorkspace(page);

    // The stored view is restored asynchronously; the reader has to be still
    // before it is moved, or the restore lands mid-test.
    await waitForStableReader(page);

    // Step 2 of the report: leave the PDF somewhere that is not the default.
    await page.locator(".workspace-v2-page-number").click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.locator(".workspace-v2-page-number").click();
    await page.evaluate(() => {
      const stage = document.querySelector(".workspace-v2-document-stage");
      stage.scrollTo({ top: 220, left: 0, behavior: "instant" });
    });
    await waitForStableReader(page);

    await page.locator('[data-workspace-tool="note"]').click();
    const editor = page.locator(".workspace-v2-note-editor textarea");
    await expect(editor).toBeVisible();

    await waitForStableReader(page);
    const before = await readerState(page);
    expect(before.keyboard).toBe("closed");

    for (const pass of [1, 2]) {
      await editor.click();
      await setKeyboardInset(page, viewport, Math.round(viewport.height * 0.42), mode);
      const open = await readerState(page);

      expect(open.keyboard, `pass ${pass}: the workspace never noticed the keyboard`).toBe("open");
      // The frame is pinned, so the PDF's coordinate space cannot move.
      expect(open.rootHeight, `pass ${pass}: the reader frame collapsed`).toBe(before.rootHeight);
      expect(open.stageWidth, `pass ${pass}: the stage was re-laid-out`).toBe(before.stageWidth);
      expect(open.stageHeight, `pass ${pass}: the stage was re-laid-out`).toBe(before.stageHeight);
      expect(open.transform, `pass ${pass}: the PDF rescaled`).toBe(before.transform);
      expect(open.scrollTop, `pass ${pass}: the PDF panned`).toBe(before.scrollTop);
      expect(open.scrollLeft, `pass ${pass}: the PDF panned`).toBe(before.scrollLeft);
      expect(open.toolbarVisible, `pass ${pass}: the toolbar left the screen`).toBe(true);
      expect(open.toolbarTop, `pass ${pass}: the toolbar jumped`).toBe(before.toolbarTop);
      expect(open.documentScrollTop, `pass ${pass}: the page itself scrolled`).toBe(0);
      expect(open.pageScrollsSideways, `pass ${pass}: the page overflowed sideways`).toBe(false);

      await editor.fill(`Line one pass ${pass}\nLine two\nLine three\nLine four`);
      const typed = await readerState(page);
      expect(typed.scrollTop, `pass ${pass}: typing panned the PDF`).toBe(before.scrollTop);
      expect(typed.transform, `pass ${pass}: typing rescaled the PDF`).toBe(before.transform);

      await setKeyboardInset(page, viewport, 0, mode);
      await page.evaluate(() => document.activeElement?.blur());
      await setKeyboardInset(page, viewport, 0, mode);
      const closed = await readerState(page);

      expect(closed.keyboard, `pass ${pass}: the keyboard state stuck`).toBe("closed");
      expect(closed.rootHeight, `pass ${pass}: the frame did not come back`).toBe(before.rootHeight);
      expect(closed.stageHeight, `pass ${pass}: the stage did not come back`).toBe(before.stageHeight);
      expect(closed.transform, `pass ${pass}: the PDF zoom did not come back`).toBe(before.transform);
      expect(closed.scrollTop, `pass ${pass}: the PDF pan did not come back`).toBe(before.scrollTop);
      expect(closed.toolbarTop, `pass ${pass}: the toolbar did not come back`).toBe(before.toolbarTop);
      expect(closed.pageScrollsSideways).toBe(false);
    }

    // Drawing has to work again once the note is done with.
    await page.locator('[data-workspace-tool="pen"]').click();
    await expect(page.locator('[data-workspace-tool="pen"]')).toHaveClass(/is-active/);
    const after = await readerState(page);
    expect(after.transform).toBe(before.transform);
    expect(after.scrollTop).toBe(before.scrollTop);
  });
}

// A phone docks the drawer to the bottom edge, so it is the layout that has to
// climb over the keyboard rather than hide behind it.
test("the notes drawer rides above the keyboard on a phone", async ({ page }) => {
  test.setTimeout(120_000);
  await mockStudent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  await page.locator('[data-workspace-tool="note"]').click();
  const editor = page.locator(".workspace-v2-note-editor textarea");
  await expect(editor).toBeVisible();

  const resting = await readerState(page);
  expect(resting.drawerBottom).toBe(0);

  await editor.click();
  const inset = 354;
  await setKeyboardInset(page, { width: 390, height: 844 }, inset, "visual");
  const lifted = await readerState(page);

  expect(lifted.drawerBottom, "the drawer stayed under the keyboard").toBe(inset);
  expect(lifted.drawerHeight, "the drawer did not shorten for the keyboard").toBeLessThan(resting.drawerHeight);
  // The field the student is typing into has to be on screen above the keyboard.
  const fieldVisible = await editor.evaluate((node, keyboard) => {
    const bounds = node.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight - keyboard + 1;
  }, inset);
  expect(fieldVisible, "the note field is behind the keyboard").toBe(true);

  await setKeyboardInset(page, { width: 390, height: 844 }, 0, "visual");
  await page.evaluate(() => document.activeElement?.blur());
  await setKeyboardInset(page, { width: 390, height: 844 }, 0, "visual");
  expect((await readerState(page)).drawerBottom).toBe(0);
});

// Touch emulation is where the 16px floor actually matters, and where the
// coarse-pointer sizing rules are the ones in play.
