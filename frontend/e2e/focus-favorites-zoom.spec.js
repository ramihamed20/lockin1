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

test("a phone shows its favorite pens directly beneath the toolbar as well as in the pen panel", async ({ page }) => {
  await mockWorkspace(page);
  await openWorkspace(page, { width: 390, height: 844 });
  await openPenPanel(page);
  const strip = page.locator("#workspace-pen-options .workspace-favorite-pens");
  await strip.getByRole("button", { name: "Save this pen as a favorite" }).click();
  await expect(strip.getByRole("button", { name: /· 4 pt/ })).toBeVisible();
  await expect(page.locator(".workspace-toolbar-accessories .workspace-favorite-pens.is-toolbar")).toBeVisible();
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


test("all five favorite pens are visible at once in the iPad toolbar", async ({ page }) => {
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
  for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 834, height: 1194 }, { width: 1024, height: 768 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    const group = page.locator(".workspace-v2-toolbar > .workspace-toolbar-accessories > .workspace-favorite-pens.is-toolbar");
    await expect(group).toBeVisible();
    // The favorites never occupy a third row below the drawing tools.
    // On portrait iPad/mobile they are ABOVE those tools, on desktop beside.
    await expect.poll(async () => page.locator(".workspace-v2-toolbar").evaluate((bar) => {
      const accessory = bar.querySelector(".workspace-toolbar-accessories")?.getBoundingClientRect();
      const tools = bar.querySelector(".workspace-tool-dock")?.getBoundingClientRect();
      return Boolean(accessory && tools && accessory.top <= tools.top + 2);
    })).toBe(true);
    const buttons = group.locator(".workspace-favorite-pen-slot > .workspace-favorite-pen");
    await expect(buttons).toHaveCount(5);
    for (const button of await buttons.all()) await expect(button).toBeInViewport();
    if (viewport.width >= 700) {
      const palette = page.locator(".workspace-toolbar-accessories .workspace-v3-quick-colors");
      await expect(palette).toBeVisible();
      const visibleSwatches = await palette.locator(".workspace-v3-color-scroll").evaluate((strip) => {
        const view = strip.getBoundingClientRect();
        return [...strip.querySelectorAll(".workspace-v3-quick-color")].filter((item) => {
          const box = item.getBoundingClientRect();
          return box.left >= view.left - 1 && box.right <= view.right + 1;
        }).length;
      });
      expect(visibleSwatches).toBeGreaterThanOrEqual(5);
    }
    const layout = await group.evaluate((element) => {
      const toolbar = element.closest(".workspace-v2-toolbar").getBoundingClientRect();
      const boxes = [...element.querySelectorAll(".workspace-favorite-pen-slot > button")].map((button) => button.getBoundingClientRect());
      const group = element.getBoundingClientRect();
      return {
        allInsideToolbar: boxes.every((box) => box.left >= toolbar.left - 1 && box.right <= toolbar.right + 1
          && box.top >= toolbar.top - 1 && box.bottom <= toolbar.bottom + 1),
        noOverlaps: boxes.every((box, index) => index === 0 || box.left >= boxes[index - 1].right - 1),
        noStripClipping: element.scrollWidth <= element.clientWidth + 1 && group.width >= boxes.reduce((sum, box) => sum + box.width, 0),
        touchSize: boxes.every((box) => box.width >= 34 && box.height >= 36)
      };
    });
    expect(layout, `all five favorites at ${viewport.width}px`).toEqual({
      allInsideToolbar: true, noOverlaps: true, noStripClipping: true, touchSize: true
    });
  }
});
