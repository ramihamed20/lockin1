import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * The Focus Workspace's object layer and export path: selecting, moving and
 * editing marks with mouse, finger and stylus; the context toolbar's
 * commands and their undo; exporting a real PDF that carries the marks; and
 * the settings panel and its switches.
 */

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const STORAGE_PREFIX = "lock-in.catalog-workspace.v1.";
// The header production serves (frontend/nginx/default.conf). Local servers
// send none, which is how a data: fetch in the exporter shipped unnoticed.
const PRODUCTION_CSP = "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'self' https://www.youtube-nocookie.com; img-src 'self' blob: https://i.ytimg.com; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; style-src-elem 'self'; worker-src 'self' blob:";

async function mockWorkspace(page, { language = "en" } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (pathname === "/api/v1/auth/session") return json({ user: { id: "selection-student", email: "selection@example.test", full_name: "Selection Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") return json({ active_session: null });
    return json({ error: { code: "not_found", message: "Not used by selection tests" } }, 404);
  });
}

async function openWorkspace(page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study|الدراسة العادية/ }).first().click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width > 0)).toBe(true);
}

async function pageBox(page) {
  return page.locator(".workspace-v2-a4-page").first().boundingBox();
}

/** Dispatches a pointer event at the element under the point, as a real contact would hit it. */
async function pointerAt(page, type, pointerId, x, y, pointerType) {
  await page.evaluate(({ type, pointerId, x, y, pointerType }) => {
    const target = type === "pointerdown" ? document.elementFromPoint(x, y) : document.querySelector(".workspace-v2-document-stage");
    target.dispatchEvent(new PointerEvent(type, {
      pointerId, pointerType, isPrimary: true, clientX: x, clientY: y, button: 0,
      buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5,
      width: pointerType === "touch" ? 9 : 2, height: pointerType === "touch" ? 9 : 2,
      bubbles: true, cancelable: true, composed: true
    }));
  }, { type, pointerId, x, y, pointerType });
}

async function drag(page, pointerId, from, to, pointerType, steps = 8) {
  await pointerAt(page, "pointerdown", pointerId, from.x, from.y, pointerType);
  for (let step = 1; step <= steps; step += 1) {
    await pointerAt(page, "pointermove", pointerId, from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps, pointerType);
  }
  await pointerAt(page, "pointerup", pointerId, to.x, to.y, pointerType);
}

async function tap(page, pointerId, point, pointerType) {
  await pointerAt(page, "pointerdown", pointerId, point.x, point.y, pointerType);
  await pointerAt(page, "pointerup", pointerId, point.x, point.y, pointerType);
}

/** Marks as the workspace stored them: IndexedDB first, localStorage when that is unavailable. */
async function saved(page) {
  return page.evaluate(async (prefix) => {
    const fromDatabase = await new Promise((resolve) => {
      if (!globalThis.indexedDB) { resolve(null); return; }
      const request = indexedDB.open("lock-in-workspace");
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("pages")) { database.close(); resolve(null); return; }
        const read = database.transaction(["pages"], "readonly").objectStore("pages").getAll();
        read.onsuccess = () => { database.close(); resolve(read.result.flatMap((record) => record.annotations || [])); };
        read.onerror = () => { database.close(); resolve(null); };
      };
    });
    if (fromDatabase?.length) return fromDatabase;
    const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix) && entry.includes("biochemistry-1"));
    return key ? JSON.parse(localStorage.getItem(key)).annotations || [] : fromDatabase || [];
  }, STORAGE_PREFIX);
}

function layer(page) {
  return page.locator(".workspace-v2-annotation-layer");
}

function toolbar(page) {
  return page.locator("[data-selection-toolbar]");
}

/** Chooses a tool without toggling its options open when it is already active. */
async function useTool(page, name) {
  const button = page.locator(".workspace-v2-toolbar").getByRole("button", { name, exact: true }).first();
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace-v2-tool-options")).toHaveCount(0);
}

async function addText(page, value = "Movable note") {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("dialog", { name: "Add text annotation" }).getByLabel("Annotation text").fill(value);
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  const text = layer(page).locator('[data-annotation-type="text"]').last();
  await expect(text).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add text annotation" })).toHaveCount(0);
  return text;
}

async function drawPen(page, pointerId, points) {
  await useTool(page, "Pen");
  await pointerAt(page, "pointerdown", pointerId, points[0].x, points[0].y, "pen");
  for (const point of points.slice(1)) await pointerAt(page, "pointermove", pointerId, point.x, point.y, "pen");
  await pointerAt(page, "pointerup", pointerId, points.at(-1).x, points.at(-1).y, "pen");
}

function ink(page) {
  return layer(page).locator("[data-annotation-type='pen']:not(.workspace-v2-annotation-hit)");
}

/**
 * The element's box as the page's own layout reports it. Playwright's
 * locator.boundingBox() on WebKit mis-projects an SVG <text> whose ancestor
 * has a CSS transform (the reader's zoom): measured 2026-09-30 it reported
 * (0, 102) for text that getBoundingClientRect, hit-testing and the painted
 * pixels all put at (128, 708). Paths are unaffected. Measuring through the
 * DOM keeps these specs about the workspace rather than about that quirk.
 */
async function domBox(locator) {
  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width || rect.height ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  }).catch(() => null);
}

async function centre(locator) {
  const box = await domBox(locator);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function textPosition(text) {
  return { x: Number(await text.getAttribute("x")), y: Number(await text.getAttribute("y")) };
}

test.describe("text objects", () => {
  test("added text arrives selected, drags to a new place, and keeps it after a reload", async ({ page }) => {
    test.setTimeout(90_000);
    await mockWorkspace(page);
    await openWorkspace(page);
    const text = await addText(page);
    await expect(toolbar(page)).toBeVisible();
    await expect(page.locator('[data-workspace-tool="select"]').first()).toHaveAttribute("aria-pressed", "true");
    const before = await textPosition(text);
    const start = await centre(text);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 40, { steps: 4 });
    await page.mouse.move(start.x + 150, start.y + 110, { steps: 6 });
    await page.mouse.up();
    // The drag moved it, and did not open the editor.
    await expect(page.getByRole("dialog", { name: /text annotation/ })).toHaveCount(0);
    const moved = await textPosition(text);
    expect(moved.x).toBeGreaterThan(before.x + 40);
    expect(moved.y).toBeGreaterThan(before.y + 40);
    await expect.poll(async () => (await saved(page)).find((item) => item.type === "text")?.x).toBeCloseTo(moved.x, 1);

    await page.reload();
    await page.getByRole("button", { name: /Normal Study/ }).click();
    const restored = layer(page).locator('[data-annotation-type="text"]').first();
    await expect(restored).toBeVisible();
    const after = await textPosition(restored);
    expect(after.x).toBeCloseTo(moved.x, 1);
    expect(after.y).toBeCloseTo(moved.y, 1);
  });

  test("a text move undoes to exactly where it was and redoes to where it went", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const text = await addText(page);
    const before = await textPosition(text);
    const start = await centre(text);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 90, { steps: 8 });
    await page.mouse.up();
    const moved = await textPosition(text);
    expect(moved.x).not.toBeCloseTo(before.x, 0);
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    expect(await textPosition(text)).toEqual(before);
    await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
    expect(await textPosition(text)).toEqual(moved);
  });

  test("a single click selects text, a double click edits it, and a tap never nudges it", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const text = await addText(page);
    const before = await textPosition(text);
    const point = await centre(text);
    // Deselect, then a single click only selects.
    await page.keyboard.press("Escape");
    await expect(toolbar(page)).toHaveCount(0);
    await page.mouse.click(point.x, point.y);
    await expect(toolbar(page)).toBeVisible();
    await expect(page.getByRole("dialog", { name: /text annotation/ })).toHaveCount(0);
    expect(await textPosition(text)).toEqual(before);
    // Past the double-tap window, so the next two clicks are their own pair.
    await page.waitForTimeout(450);
    await page.mouse.dblclick(point.x, point.y);
    const editor = page.getByRole("dialog", { name: "Edit text annotation" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("Annotation text").fill("Edited note");
    await page.getByRole("button", { name: "Save text" }).click();
    await expect(text).toContainText("Edited note");
    expect(await textPosition(text)).toEqual(before);
  });
});

test.describe("selection", () => {
  test("a tap on a stroke selects it and a drag moves it without drawing", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const box = await pageBox(page);
    const y = box.y + box.height * .3;
    await drawPen(page, 11, Array.from({ length: 8 }, (_, index) => ({ x: box.x + box.width * .3 + index * 18, y })));
    await expect(ink(page)).toHaveCount(1);
    await expect.poll(async () => (await saved(page)).filter((item) => item.type === "pen").length).toBe(1);
    const before = (await saved(page)).find((item) => item.type === "pen");
    await useTool(page, "Lasso");
    await page.mouse.click(box.x + box.width * .3 + 60, y);
    await expect(toolbar(page)).toBeVisible();
    await page.mouse.move(box.x + box.width * .3 + 60, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .3 + 140, y + 120, { steps: 8 });
    await page.mouse.up();
    await expect(ink(page)).toHaveCount(1);
    await expect.poll(async () => (await saved(page)).find((item) => item.type === "pen")?.points[0].y).toBeGreaterThan(before.points[0].y + 40);
  });

  test("a lasso selects several marks and they move together", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const box = await pageBox(page);
    const first = { x: box.x + box.width * .3, y: box.y + box.height * .25 };
    await drawPen(page, 21, Array.from({ length: 6 }, (_, index) => ({ x: first.x + index * 15, y: first.y })));
    await drawPen(page, 22, Array.from({ length: 6 }, (_, index) => ({ x: first.x + index * 15, y: first.y + 60 })));
    await expect(ink(page)).toHaveCount(2);
    await expect.poll(async () => (await saved(page)).filter((item) => item.type === "pen").length).toBe(2);
    const before = (await saved(page)).filter((item) => item.type === "pen").map((item) => item.points[0]);
    await useTool(page, "Lasso");
    const corners = [[-30, -30], [130, -30], [130, 90], [-30, 90], [-30, -28]].map(([dx, dy]) => ({ x: first.x + dx, y: first.y + dy }));
    await page.mouse.move(corners[0].x, corners[0].y);
    await page.mouse.down();
    for (const corner of corners.slice(1)) await page.mouse.move(corner.x, corner.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator(".workspace-v2-selection-box")).toHaveAttribute("data-selection-count", "2");
    await page.mouse.move(first.x + 30, first.y + 30);
    await page.mouse.down();
    await page.mouse.move(first.x + 130, first.y + 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await saved(page)).filter((item) => item.type === "pen").map((item) => item.points[0].x - before[0].x)[0]).toBeGreaterThan(40);
    const after = (await saved(page)).filter((item) => item.type === "pen").map((item) => item.points[0]);
    const shifts = after.map((point, index) => point.x - before[index].x);
    expect(shifts[0]).toBeGreaterThan(40);
    expect(shifts[1]).toBeCloseTo(shifts[0], 3);
  });

  test("copy then paste adds an offset copy that undo removes", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const text = await addText(page, "Copy me");
    const source = await textPosition(text);
    await toolbar(page).getByRole("button", { name: "Copy" }).click();
    await toolbar(page).getByRole("button", { name: "Paste" }).click();
    const texts = layer(page).locator('[data-annotation-type="text"]');
    await expect(texts).toHaveCount(2);
    const copy = await textPosition(texts.nth(1));
    expect(Math.abs(copy.x - source.x) + Math.abs(copy.y - source.y)).toBeGreaterThan(10);
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    await expect(texts).toHaveCount(1);
  });

  test("cut removes the item and undo puts it back in place", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const text = await addText(page, "Cut me");
    const source = await textPosition(text);
    await toolbar(page).getByRole("button", { name: "Cut" }).click();
    await expect(layer(page).locator('[data-annotation-type="text"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    const restored = layer(page).locator('[data-annotation-type="text"]');
    await expect(restored).toHaveCount(1);
    expect(await textPosition(restored)).toEqual(source);
    // A cut item can still be pasted.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+v");
    await expect(layer(page).locator('[data-annotation-type="text"]')).toHaveCount(2);
  });

  test("duplicate places a selected copy beside the original", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const text = await addText(page, "Twice");
    const source = await textPosition(text);
    await toolbar(page).getByRole("button", { name: "Duplicate" }).click();
    const texts = layer(page).locator('[data-annotation-type="text"]');
    await expect(texts).toHaveCount(2);
    const copy = await textPosition(texts.nth(1));
    expect(copy.x).not.toBe(source.x);
    await expect(page.locator(".workspace-v2-selection-box")).toHaveAttribute("data-selection-count", "1");
  });

  test("delete removes the selection and undo restores it", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    await addText(page, "Delete me");
    await toolbar(page).getByRole("button", { name: "Delete" }).click();
    await expect(layer(page).locator('[data-annotation-type="text"]')).toHaveCount(0);
    await expect(toolbar(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    await expect(layer(page).locator('[data-annotation-type="text"]')).toHaveCount(1);
  });

  test("bring forward and send backward change the painting order as one undo", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    await addText(page, "Under");
    await addText(page, "Over");
    const order = async () => layer(page).first().locator('[data-annotation-type="text"]').evaluateAll((nodes) => nodes.map((node) => node.textContent));
    expect(await order()).toEqual(["Under", "Over"]);
    // V2: layer order is secondary, so it sits one tap away under More.
    await toolbar(page).getByRole("button", { name: "More selection actions" }).click();
    await toolbar(page).getByRole("button", { name: "Send backward" }).click();
    await expect.poll(order).toEqual(["Over", "Under"]);
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    await expect.poll(order).toEqual(["Under", "Over"]);
  });

  test("a selection survives zooming and its toolbar stays beside it", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    const text = await addText(page);
    const stage = page.locator(".workspace-v2-document-stage");
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.keyboard.down("Control");
    for (let step = 0; step < 3; step += 1) await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await expect(page.locator(".workspace-v2-selection-box")).toHaveAttribute("data-selection-count", "1");
    await expectToolbarBesideSelection(page, text);
  });

  test("a selection survives an iPad rotation and its toolbar follows it", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page, { width: 820, height: 1180 });
    const text = await addText(page);
    await expectToolbarBesideSelection(page, text);
    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.locator(".workspace-v2-selection-box")).toHaveAttribute("data-selection-count", "1");
    await expectToolbarBesideSelection(page, text);
    await page.setViewportSize({ width: 820, height: 1180 });
    await expectToolbarBesideSelection(page, text);
  });
});

async function expectToolbarBesideSelection(page, item) {
  await expect.poll(async () => {
    const target = await domBox(item);
    const bar = await domBox(toolbar(page));
    if (!target || !bar) return "missing";
    const aboveGap = target.y - (bar.y + bar.height);
    const belowGap = bar.y - (target.y + target.height);
    const vertical = (aboveGap >= 0 && aboveGap < 40) || (belowGap >= 0 && belowGap < 40);
    const overlapsHorizontally = bar.x < target.x + target.width + 4 && bar.x + bar.width > target.x - 4;
    return vertical && overlapsHorizontally ? "beside" : JSON.stringify({ target, bar });
  }).toBe("beside");
}

test.describe("touch and stylus", () => {
  test("on a phone, a finger taps to select, drags the item, and pans elsewhere", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page, { width: 390, height: 844 });
    const text = await addText(page, "Finger");
    await page.keyboard.press("Escape");
    await expect(toolbar(page)).toHaveCount(0);
    const point = await centre(text);
    await tap(page, 31, point, "touch");
    await expect(toolbar(page)).toBeVisible();
    const before = await textPosition(text);
    await drag(page, 32, point, { x: point.x + 40, y: point.y + 120 }, "touch");
    const after = await textPosition(text);
    expect(after.y).toBeGreaterThan(before.y + 30);
    // In Pencil mode a finger on empty page navigates: the selection stays and nothing is lassoed.
    const stage = page.locator(".workspace-v2-document-stage");
    const scrollBefore = await stage.evaluate((node) => node.scrollTop);
    const box = await pageBox(page);
    const empty = { x: box.x + box.width * .5, y: Math.min(box.y + box.height * .85, 760) };
    await drag(page, 33, empty, { x: empty.x, y: empty.y - 200 }, "touch");
    await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBeGreaterThan(scrollBefore + 50);
    await expect(page.locator(".workspace-v2-selection-box")).toHaveAttribute("data-selection-count", "1");
    // A tap on empty page clears it.
    await tap(page, 34, { x: box.x + box.width * .5, y: 740 }, "touch");
    await expect(toolbar(page)).toHaveCount(0);
  });

  test("the Pencil never draws with the Select tool, and draws with the Pen", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page, { width: 820, height: 1180 });
    const text = await addText(page, "Stylus");
    const box = await pageBox(page);
    // Selecting, a stylus stroke across empty page is a lasso, not ink.
    await drag(page, 41, { x: box.x + box.width * .2, y: box.y + box.height * .6 }, { x: box.x + box.width * .6, y: box.y + box.height * .65 }, "pen");
    await expect(ink(page)).toHaveCount(0);
    // And a stylus drag on the selected text moves it without leaving ink.
    const point = await centre(text);
    await tap(page, 42, point, "pen");
    const before = await textPosition(text);
    await drag(page, 43, point, { x: point.x + 80, y: point.y + 60 }, "pen");
    expect((await textPosition(text)).x).toBeGreaterThan(before.x + 20);
    await expect(ink(page)).toHaveCount(0);
    expect((await saved(page)).filter((item) => ["pen", "pencil", "highlighter"].includes(item.type))).toHaveLength(0);
    // With the Pen, the same stylus draws.
    await drawPen(page, 44, [{ x: box.x + box.width * .2, y: box.y + box.height * .7 }, { x: box.x + box.width * .4, y: box.y + box.height * .72 }, { x: box.x + box.width * .6, y: box.y + box.height * .7 }]);
    await expect(ink(page)).toHaveCount(1);
  });
});

/** Every image painted on the first page of a PDF, decoded by pdf.js. */
async function firstPageImage(data) {
  const task = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const pdfPage = await pdf.getPage(1);
    const operators = await pdfPage.getOperatorList();
    const index = operators.fnArray.indexOf(OPS.paintImageXObject);
    const name = operators.argsArray[index][0];
    const image = await new Promise((resolve) => pdfPage.objs.get(name, resolve));
    return { pages: pdf.numPages, image };
  } finally {
    await task.destroy();
  }
}

function countNear(image, [red, green, blue], tolerance = 60) {
  const channels = image.data.length / (image.width * image.height);
  let matches = 0;
  for (let offset = 0; offset < image.data.length; offset += channels) {
    if (Math.abs(image.data[offset] - red) < tolerance && Math.abs(image.data[offset + 1] - green) < tolerance && Math.abs(image.data[offset + 2] - blue) < tolerance) matches += 1;
  }
  return matches;
}

test.describe("export", () => {
  test.use({ serviceWorkers: "block" });

  test("under the production content policy, a PDF export downloads a real file carrying the marks", async ({ page }) => {
    test.setTimeout(90_000);
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": PRODUCTION_CSP } });
    });
    await mockWorkspace(page);
    const violations = [];
    page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text()); });
    await openWorkspace(page);
    // A heavy red stroke, plus text, on page 1.
    const box = await pageBox(page);
    await drawPen(page, 51, Array.from({ length: 16 }, (_, index) => ({ x: box.x + box.width * .2 + index * 20, y: box.y + 320 + Math.sin(index) * 8 })));
    await expect.poll(async () => (await saved(page)).filter((item) => item.type === "pen").length).toBe(1);
    await addText(page, "Exported note");

    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Export", exact: false }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("dialog", { name: "Export workspace" }).getByRole("button", { name: /^Current page/i }).click();
    const sheet = page.locator(".workspace-v8-export-sheet");
    const download = await downloadPromise;
    await expect(sheet).toHaveAttribute("data-export-status", "ready");
    await expect(sheet).toContainText("Export complete");
    expect(download.suggestedFilename()).toMatch(/-page-1-lockin\.pdf$/);
    const data = new Uint8Array(await readFile(await download.path()));
    expect(data.length).toBeGreaterThan(10_000);
    expect(new TextDecoder().decode(data.slice(0, 5))).toBe("%PDF-");
    const { pages, image } = await firstPageImage(data);
    expect(pages).toBe(1);
    // The raster is the fixed export size, not the screen's.
    expect(image.width).toBe(1190);
    const stroke = (await saved(page)).find((item) => item.type === "pen");
    const colour = stroke.color.match(/[0-9a-f]{2}/gi).map((part) => Number.parseInt(part, 16));
    expect(countNear(image, colour)).toBeGreaterThan(200);
    expect(violations).toEqual([]);

    // Closing the sheet frees the file's object URL.
    const href = await sheet.getByRole("link", { name: /Download again/ }).getAttribute("href");
    expect(href).toMatch(/^blob:/);
    await sheet.getByRole("button", { name: "Close export" }).click();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(async (url) => { try { await fetch(url); return "alive"; } catch { return "revoked"; } }, href)).toBe("revoked");
  });

  test("a whole-sheet export includes added pages and names the file after the sheet", async ({ page }) => {
    test.setTimeout(120_000);
    await mockWorkspace(page);
    await openWorkspace(page);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Add Page" }).click();
    await page.getByRole("dialog", { name: "Choose workspace page background" }).getByRole("button", { name: /Grid/ }).click();
    await expect(page.locator(".workspace-v2-a4-page.is-virtual")).toHaveCount(1);
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Export", exact: false }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("dialog", { name: "Export workspace" }).getByRole("button", { name: /PDF with annotations/ }).click();
    await expect(page.locator(".workspace-v8-export-sheet")).toContainText(/Preparing PDF|Export complete/);
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/-lockin\.pdf$/);
    expect(download.suggestedFilename()).not.toMatch(/page-/);
    const data = new Uint8Array(await readFile(await download.path()));
    const task = getDocument({ data, useSystemFonts: true });
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(42);
    await task.destroy();
  });

  for (const viewport of [{ width: 390, height: 844, name: "iPhone" }, { width: 820, height: 1180, name: "iPad portrait" }, { width: 1180, height: 820, name: "iPad landscape" }]) {
    test(`${viewport.name} gets a ready sheet whose actions deliver the file`, async ({ page }) => {
      test.setTimeout(90_000);
      await mockWorkspace(page);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
        Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
        // Stand in for the iOS share sheet: record what would be shared.
        window.__shared = [];
        Object.defineProperty(navigator, "canShare", { configurable: true, value: (data) => Boolean(data?.files?.length) });
        Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => { window.__shared.push(data.files.map((file) => ({ name: file.name, type: file.type, size: file.size }))); } });
      });
      await openWorkspace(page, viewport);
      const originalUrl = page.url();
      let downloads = 0;
      page.on("download", () => { downloads += 1; });
      await page.getByRole("button", { name: "More workspace actions" }).click();
      await page.getByRole("dialog", { name: "More workspace actions" }).getByRole("button", { name: /^Share/ }).click();
      const sheet = page.locator(".workspace-v8-export-sheet");
      await expect(sheet).toHaveAttribute("data-export-status", "ready", { timeout: 60_000 });
      // iOS waits for a tap instead of firing a download nobody asked for.
      expect(downloads).toBe(0);
      await expect(sheet.getByRole("button", { name: /Share \/ Save/ })).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Open" })).toHaveAttribute("href", /^blob:/);
      await sheet.getByRole("button", { name: /Share \/ Save/ }).click();
      await expect.poll(async () => page.evaluate(() => window.__shared)).toEqual([[expect.objectContaining({ type: "application/pdf", name: expect.stringMatching(/-lockin\.pdf$/) })]]);
      const downloadPromise = page.waitForEvent("download");
      await sheet.getByRole("link", { name: "Download" }).click();
      await downloadPromise;
      await expect(page.locator(".workspace-v2-document-stage")).toBeVisible();
      expect(page.url()).toBe(originalUrl);
    });
  }
});

test.describe("settings", () => {
  test("a switch changes its setting, and the choice is there after a reload", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page);
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Workspace settings" }).click();
    await page.getByRole("tab", { name: "View" }).click();
    const pageNumber = page.getByRole("switch", { name: /Show page number/ });
    await expect(pageNumber).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".workspace-v2-page-number")).toBeVisible();
    await pageNumber.click();
    await expect(pageNumber).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".workspace-v2-page-number")).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /Normal Study/ }).click();
    await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".workspace-v2-page-number")).toHaveCount(0);
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Workspace settings" }).click();
    await page.getByRole("tab", { name: "View" }).click();
    await expect(page.getByRole("switch", { name: /Show page number/ })).toHaveAttribute("aria-checked", "false");
  });

  test("the settings panel is compact and leaves the page in view", async ({ page }) => {
    await mockWorkspace(page);
    await openWorkspace(page, { width: 1180, height: 820 });
    await page.getByRole("button", { name: "More workspace actions" }).click();
    await page.getByRole("button", { name: "Workspace settings" }).click();
    const panel = page.getByRole("dialog", { name: "Workspace settings" });
    const workspace = await page.locator(".workspace-v2").boundingBox();
    const bounds = await panel.boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(400);
    expect(bounds.width * bounds.height).toBeLessThan(workspace.width * workspace.height * .4);
  });

  // Focus is translated (focus.* keys), so an Arabic workspace names its
  // controls in Arabic.
  const FOCUS_NAMES = {
    en: { more: "More workspace actions", settings: "Workspace settings", sections: ["Drawing", "Canvas", "View", "Other"] },
    ar: { more: "مزيد من إجراءات مساحة العمل", settings: "إعدادات مساحة العمل", sections: ["الرسم", "اللوحة", "العرض", "أخرى"] }
  };

  for (const [language, viewports] of [["en", [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]], ["ar", [{ width: 390, height: 844 }, { width: 1180, height: 820 }]]]) {
    test(`switch thumbs stay inside their tracks (${language})`, async ({ page }) => {
      test.setTimeout(90_000);
      const names = FOCUS_NAMES[language];
      await mockWorkspace(page, { language });
      await openWorkspace(page, viewports[0]);
      await page.getByRole("button", { name: names.more }).click();
      await page.getByRole("button", { name: names.settings }).click();
      const panel = page.getByRole("dialog", { name: names.settings });
      if (language === "ar") await expect(panel).toHaveCSS("direction", "rtl");
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        for (const section of names.sections) {
          await panel.getByRole("tab", { name: section }).click();
          await page.waitForTimeout(350);
          const insets = await panel.locator(".workspace-v2-switch-track").evaluateAll((tracks) => tracks.map((track) => {
            const outer = track.getBoundingClientRect();
            const thumb = track.firstElementChild.getBoundingClientRect();
            const checked = track.closest("[role='switch']").getAttribute("aria-checked") === "true";
            const rtl = getComputedStyle(track).direction === "rtl";
            return { start: Math.round((rtl ? outer.right - thumb.right : thumb.left - outer.left) * 10) / 10, end: Math.round((rtl ? thumb.left - outer.left : outer.right - thumb.right) * 10) / 10, top: Math.round((thumb.top - outer.top) * 10) / 10, bottom: Math.round((outer.bottom - thumb.bottom) * 10) / 10, checked };
          }));
          for (const inset of insets) {
            for (const side of ["start", "end", "top", "bottom"]) expect(inset[side], `${language} ${viewport.width} ${section} ${side}`).toBeGreaterThanOrEqual(0);
            // The same gap on the resting side as on the top.
            expect(Math.abs((inset.checked ? inset.end : inset.start) - inset.top)).toBeLessThan(.6);
          }
        }
      }
    });
  }

  test("RTL settings mirror the tabs and keep every row inside the panel", async ({ page }) => {
    await mockWorkspace(page, { language: "ar" });
    await openWorkspace(page, { width: 390, height: 844 });
    await page.getByRole("button", { name: FOCUS_NAMES.ar.more }).click();
    await page.getByRole("button", { name: FOCUS_NAMES.ar.settings }).click();
    const panel = page.getByRole("dialog", { name: FOCUS_NAMES.ar.settings });
    const tabs = await panel.getByRole("tab").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));
    // Drawing, the first section, sits on the right in Arabic.
    expect(tabs[0]).toBeGreaterThan(tabs[3]);
    const switchControl = panel.getByRole("switch").first();
    const before = await switchControl.getAttribute("aria-checked");
    await switchControl.click();
    await expect(switchControl).not.toHaveAttribute("aria-checked", before);
    const outside = await panel.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return [...node.querySelectorAll("button, [role='switch'], input")].filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width && (rect.left < box.left - 1 || rect.right > box.right + 1);
      }).length;
    });
    expect(outside).toBe(0);
  });
});
