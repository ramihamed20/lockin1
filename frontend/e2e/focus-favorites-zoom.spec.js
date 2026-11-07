import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { catalogWorkspaceStorageKey, parseCatalogWorkspace } from "../src/workspace/catalog/catalogWorkspaceState.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const IPAD = { width: 834, height: 1194 };

async function mockWorkspace(page, language = "en") {
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  });
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "fav-student", email: "fav@example.test", full_name: "Favorite Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used here" } }) });
  });
}

async function openWorkspace(page, viewport = IPAD) {
  await page.setViewportSize(viewport);
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية|دراسة عادية/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
}

async function openPenPanel(page) {
  const pen = page.locator(".workspace-v3-primary [data-workspace-tool='pen']");
  await pen.click();
  if (!(await page.locator("#workspace-pen-options").isVisible())) await pen.click();
  await expect(page.locator("#workspace-pen-options")).toBeVisible();
}

async function savedAnnotations(page) {
  const key = catalogWorkspaceStorageKey("user:fav-student", "biochemistry-1", "vitamin-1");
  return parseCatalogWorkspace(await page.evaluate((key) => localStorage.getItem(key), key))?.annotations ?? [];
}

// Exercise the touch pointer path directly: a regular range.fill() or a
// programmatic input event never reproduces the fast-swipe bug on Safari.
async function swipeRangeRapidly(range, start, end) {
  await range.evaluate((input, { start, end }) => {
    const box = input.getBoundingClientRect();
    const pointerId = 806;
    const fire = (type, progress, verticalOffset = 0) => input.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: "touch", isPrimary: true,
      button: 0, buttons: type === "pointerup" ? 0 : 1,
      clientX: box.left + box.width * progress,
      clientY: box.top + box.height / 2 + verticalOffset
    }));
    fire("pointerdown", start);
    // One large movement with no intermediate positions, slightly outside the
    // track's vertical bounds, must still update the controlled range.
    fire("pointermove", end, 24);
    fire("pointerup", end, 40);
  }, { start, end });
}

test("fast touch swipes adjust thickness and opacity without the inspector stealing them", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page, { width: 390, height: 844 });
  await openPenPanel(page);
  const panel = page.locator("#workspace-pen-options");
  const thickness = panel.locator(".workspace-v2-tool-range.is-stroke input[type='range']");
  const opacity = panel.locator(".workspace-v2-tool-range.is-opacity input[type='range']");

  for (const slider of [thickness, opacity]) {
    await expect(slider).toBeVisible();
    await expect(slider).toHaveCSS("touch-action", "none");
    expect((await slider.boundingBox()).height).toBeGreaterThanOrEqual(38);
  }
  await swipeRangeRapidly(thickness, .18, 1.15);
  await expect.poll(async () => Number(await thickness.inputValue())).toBe(12);
  await swipeRangeRapidly(thickness, .8, -.15);
  await expect.poll(async () => Number(await thickness.inputValue())).toBe(1);

  await swipeRangeRapidly(opacity, .2, 1.12);
  await expect.poll(async () => Number(await opacity.inputValue())).toBe(1);
  await swipeRangeRapidly(opacity, .9, -.16);
  await expect.poll(async () => Number(await opacity.inputValue())).toBe(.2);

  // RTL sliders must move toward their minimum on the right and maximum on
  // the left, unlike their LTR counterparts.
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  await swipeRangeRapidly(opacity, .7, -.14);
  await expect.poll(async () => Number(await opacity.inputValue())).toBe(1);
  await swipeRangeRapidly(opacity, .2, 1.15);
  await expect.poll(async () => Number(await opacity.inputValue())).toBe(.2);
});

test("choosing an ink colour replays a brief pen animation in the toolbar", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  await openPenPanel(page);
  const panel = page.locator("#workspace-pen-options");
  const pen = page.locator(".workspace-v2-toolbar [data-workspace-tool='pen']");
  const red = panel.getByRole("button", { name: "Use #e5383b" });

  await red.click();
  await expect(pen).toHaveAttribute("data-color-motion", "1");
  await expect(pen.locator(".workspace-v3-tool-color-trace")).toHaveCount(1);
  await expect.poll(() => pen.locator("svg").evaluate((node) => getComputedStyle(node).color)).toBe("rgb(229, 56, 59)");
  await expect(pen.locator(".workspace-v3-tool-swatch")).toHaveCSS("background-color", "rgb(229, 56, 59)");

  // Same-colour taps replay the motion rather than relying on a changed CSS
  // variable (which would leave the animation stuck after the first tap).
  await red.click();
  await expect(pen).toHaveAttribute("data-color-motion", "2");
  // WebKit previously left two painted pen glyphs after a colour choice.
  // The glyph must stay as one stable SVG, not a keyed/remounted animation.
  const highlighter = page.locator(".workspace-v2-toolbar [data-workspace-tool='highlighter']");
  for (const button of [pen, highlighter]) {
    await expect(button.locator(":scope > svg")).toHaveCount(1);
    const glyphBounds = await button.locator(":scope > svg").boundingBox();
    const buttonBounds = await button.boundingBox();
    expect(glyphBounds.y).toBeGreaterThanOrEqual(buttonBounds.y - 1);
    expect(glyphBounds.y + glyphBounds.height).toBeLessThanOrEqual(buttonBounds.y + buttonBounds.height + 1);
    await expect(button.locator(":scope > svg")).toHaveCSS("animation-name", "none");
    await expect(button.locator(":scope > svg")).toHaveCSS("transform", "none");
  }

  // Motion-sensitive users retain the new colour without the animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await panel.getByRole("button", { name: "Use #2563eb" }).click();
  await expect(pen).toHaveAttribute("data-color-motion", "3");
  await expect(pen.locator("svg")).toHaveCSS("animation-name", "none");
  await expect(pen.locator(".workspace-v3-tool-swatch")).toHaveCSS("background-color", "rgb(37, 99, 235)");
});

test("a favorite pen is saved from the pen panel, taken up from the toolbar in one tap, and removed", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  await openPenPanel(page);
  const panel = page.locator("#workspace-pen-options");
  await panel.getByRole("button", { name: "Fountain Pen" }).click();
  await panel.getByRole("button", { name: "Use #e5383b" }).click();
  await panel.getByRole("button", { name: "Save this pen as a favorite" }).click();
  const toolbarFavorites = page.locator(".workspace-favorite-pens.is-toolbar");
  await expect(toolbarFavorites.getByRole("button")).toHaveCount(1);
  const favorite = toolbarFavorites.getByRole("button", { name: /Fountain · #e5383b · 4 pt/ });
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  // Another pen, then the favorite in one tap.
  await panel.getByRole("button", { name: "Ball Pen" }).click();
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await openPenPanel(page);
  await expect(panel.getByRole("button", { name: "Fountain Pen" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("button", { name: "Use #e5383b" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  // It is still there after a reload.
  await page.reload();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-favorite-pens.is-toolbar").getByRole("button")).toHaveCount(1);
  // The favorite in use opens Update and Remove.
  const reloaded = page.locator(".workspace-favorite-pens.is-toolbar").getByRole("button").first();
  await reloaded.click();
  if ((await reloaded.getAttribute("aria-expanded")) !== "true") await reloaded.click();
  await page.getByRole("menuitem", { name: "Remove favorite" }).click();
  await expect(page.locator(".workspace-favorite-pens.is-toolbar")).toHaveCount(0);
});

test("a phone keeps starred pens inside the scrollable tool row and in the pen panel", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page, { width: 390, height: 844 });
  await openPenPanel(page);
  const strip = page.locator("#workspace-pen-options .workspace-favorite-pens");
  await strip.getByRole("button", { name: "Save this pen as a favorite" }).click();
  await expect(strip.getByRole("button", { name: /· 4 pt/ })).toBeVisible();
  const toolbar = page.locator(".workspace-v2-toolbar");
  await expect(toolbar.locator(".workspace-toolbar-accessories")).toHaveCount(0);
  await expect(toolbar.locator(".workspace-tool-dock .workspace-favorite-pens.is-toolbar")).toBeVisible();
  for (const button of await strip.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
});

test("the star saves five full pens, shows them in the toolbar, and stays saved across reloads", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  await openPenPanel(page);
  const panel = page.locator("#workspace-pen-options");
  const star = panel.locator(".workspace-v4-favorite-color.is-favorite-pen");
  const inks = ["#2563eb", "#e5383b", "#f5b700", "#16a34a", "#7c3aed", "#f97316"];
  for (const [index, color] of inks.slice(0, 5).entries()) {
    await panel.getByRole("button", { name: `Use ${color}` }).click();
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".workspace-favorite-pens.is-toolbar .workspace-favorite-pen-slot")).toHaveCount(index + 1);
  }
  await panel.getByRole("button", { name: `Use ${inks[5]}` }).click();
  await expect(star).toBeDisabled();
  await expect(page.locator(".workspace-favorite-pens.is-toolbar .workspace-favorite-pen-slot")).toHaveCount(5);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.favorite-pens.v1") || "[]").length)).toBe(5);

  // Re-select a starred pen, unstar it, and prove its slot is free again.
  await panel.getByRole("button", { name: `Use ${inks[0]}` }).click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.click();
  await expect(page.locator(".workspace-favorite-pens.is-toolbar .workspace-favorite-pen-slot")).toHaveCount(4);
  await expect(star).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-favorite-pens.is-toolbar .workspace-favorite-pen-slot")).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("lock-in.catalog-workspace.favorite-pens.v1") || "[]").length)).toBe(4);
});

async function writeInZoomWindow(page, fromRatio, toRatio, pointerId) {
  const surface = page.locator(".workspace-zoom-window-surface");
  const box = await surface.boundingBox();
  await page.evaluate(({ box, fromRatio, toRatio, pointerId }) => {
    const target = document.querySelector(".workspace-zoom-window-surface");
    const fire = (type, ratio, wave) => target.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: "pen", isPrimary: true, clientX: box.x + box.width * ratio, clientY: box.y + box.height * (.5 + wave), button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5, bubbles: true, cancelable: true }));
    fire("pointerdown", fromRatio, 0);
    for (let i = 1; i <= 20; i += 1) fire("pointermove", fromRatio + (toRatio - fromRatio) * i / 20, Math.sin(i / 3) * .12);
    fire("pointerup", toRatio, 0);
  }, { box, fromRatio, toRatio, pointerId });
}

test("the zoom window writes small on the page, moves along the line, and undoes like any stroke", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page);
  await page.getByRole("button", { name: "More workspace actions" }).click();
  await page.locator("#workspace-more-popover").getByRole("button", { name: /Zoom window/ }).click();
  const zoomWindow = page.getByRole("region", { name: "Zoom window" });
  await expect(zoomWindow).toBeVisible();
  const pageBox = page.locator(".workspace-zoom-window-box");
  await expect(pageBox).toHaveCount(1);
  const before = Number(await pageBox.getAttribute("x"));
  const width = Number(await pageBox.getAttribute("width"));
  // Written in the middle of the window: it lands inside the box on the page.
  await writeInZoomWindow(page, .2, .5, 61);
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(1);
  const [stroke] = await savedAnnotations(page);
  const xs = stroke.points.map((point) => point.x);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(before + width * .15);
  expect(Math.max(...xs)).toBeLessThanOrEqual(before + width * .55);
  await expect(page.locator(".workspace-zoom-window-ink [data-annotation-type='pen']")).toHaveCount(1);
  expect(Number(await pageBox.getAttribute("x"))).toBe(before);
  // Written into the trailing zone: the box moves along the line.
  await writeInZoomWindow(page, .7, .95, 62);
  await expect.poll(async () => Number(await pageBox.getAttribute("x"))).toBeGreaterThan(before);
  // Next line returns to the margin, lower down.
  const y = Number(await pageBox.getAttribute("y"));
  await zoomWindow.getByRole("button", { name: "Next line" }).click();
  await expect.poll(async () => Number(await pageBox.getAttribute("y"))).toBeGreaterThan(y);
  expect(Number(await pageBox.getAttribute("x"))).toBe(before);
  // Undo removes the last stroke written in the window.
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(1);
  await zoomWindow.getByRole("button", { name: "Close zoom window" }).click();
  await expect(zoomWindow).toHaveCount(0);
  await expect(pageBox).toHaveCount(0);
});

test("in Arabic the zoom box starts at the right margin", async ({ page }) => {
  await mockWorkspace(page, "ar");
  await openWorkspace(page);
  await page.getByRole("button", { name: "مزيد من إجراءات مساحة العمل" }).click();
  await page.locator("#workspace-more-popover [data-workspace-action='zoom-window']").click();
  const pageBox = page.locator(".workspace-zoom-window-box");
  await expect(pageBox).toHaveCount(1);
  expect(Number(await pageBox.getAttribute("x")) + Number(await pageBox.getAttribute("width"))).toBe(960);
});


test("five favorite pens and colors stay in the writing tool row on phones and tablets", async ({ page }) => {
  await mockWorkspace(page);
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.catalog-workspace.favorite-pens.v1", JSON.stringify(
      ["#2563eb", "#e5383b", "#f5b700", "#16a34a", "#7c3aed"].map((color, index) => ({
        tool: index === 4 ? "highlighter" : "pen",
        profile: index === 4 ? "highlighter" : "ball",
        color,
        width: index + 2,
        opacity: index === 4 ? .34 : 1
      }))
    ));
  });
  await openWorkspace(page, { width: 834, height: 1194 });
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 834, height: 1194 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const toolbar = page.locator(".workspace-v2-toolbar");
    const rail = toolbar.locator(".workspace-tool-dock[data-dock-edge='top']");
    const favorites = rail.locator(".workspace-favorite-pens.is-toolbar");
    const colors = rail.locator(".workspace-v3-quick-colors");
    await expect(toolbar.locator(".workspace-toolbar-accessories")).toHaveCount(0);
    await expect(rail.locator("[data-workspace-tool='pen']")).toBeVisible();
    await expect(favorites).toBeVisible();
    await expect(colors).toBeVisible();
    const buttons = favorites.locator(".workspace-favorite-pen-slot > .workspace-favorite-pen");
    await expect(buttons).toHaveCount(5);
    const layout = await rail.evaluate((element) => {
      const pen = element.querySelector("[data-workspace-tool='pen']");
      const colors = element.querySelector(".workspace-v3-quick-colors");
      const favorite = element.querySelector(".workspace-favorite-pens.is-toolbar");
      const buttons = [...favorite.querySelectorAll(".workspace-favorite-pen-slot > button")];
      const centerY = (node) => { const rect = node.getBoundingClientRect(); return rect.top + rect.height / 2; };
      return {
        oneRow: Math.abs(centerY(pen) - centerY(colors)) < 8
          && Math.abs(centerY(pen) - centerY(favorite)) < 8,
        noShrink: buttons.every((button) => button.getBoundingClientRect().width >= 34),
        noClippingWithinStrip: favorite.scrollWidth <= favorite.clientWidth + 1,
        insideRail: element.contains(colors) && element.contains(favorite),
        horizontalOverflowOnly: element.scrollHeight <= element.clientHeight + 1
      };
    });
    expect(layout, `toolbar layout at ${viewport.width}x${viewport.height}`).toEqual({
      oneRow: true, noShrink: true, noClippingWithinStrip: true,
      insideRail: true, horizontalOverflowOnly: true
    });
    // On narrow screens every favorite remains reachable by scrolling the
    // same tool rail sideways, rather than forcing a second toolbar row.
    await buttons.last().scrollIntoViewIfNeeded();
    const isReachable = await rail.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      const last = element.querySelector(".workspace-favorite-pen-slot:last-child > button").getBoundingClientRect();
      return last.left >= viewport.left - 1 && last.right <= viewport.right + 1;
    });
    expect(isReachable, `fifth pen unreachable at ${viewport.width}px`).toBe(true);
  }
  // A scrolled-to preset must still be usable, not just visually present.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workspace-v2-toolbar .workspace-favorite-pens.is-toolbar .workspace-favorite-pen-slot").last().locator("button").click();
  await expect(page.locator(".workspace-v2-toolbar [data-workspace-tool='highlighter']")).toHaveAttribute("aria-pressed", "true");
});
