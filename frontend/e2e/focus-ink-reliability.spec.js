import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { catalogWorkspaceStorageKey, parseCatalogWorkspace } from "../src/workspace/catalog/catalogWorkspaceState.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const IPAD_PORTRAIT = { width: 834, height: 1194 };
const IPAD_LANDSCAPE = { width: 1194, height: 834 };

async function mockAuthenticatedWorkspace(page) {
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  });
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "ink-student", email: "ink@example.test", full_name: "Ink Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by ink tests" } }) });
  });
}

async function openWorkspace(page, viewport = IPAD_PORTRAIT) {
  await page.setViewportSize(viewport);
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width > 0)).toBe(true);
}

async function dispatchPointer(stage, type, pointerId, x, y, pointerType = "pen") {
  await stage.dispatchEvent(type, {
    pointerId,
    pointerType,
    isPrimary: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    pressure: type === "pointerup" ? 0 : 0.5,
    width: pointerType === "pen" ? 2 : 9,
    height: pointerType === "pen" ? 2 : 9,
    bubbles: true,
    cancelable: true
  });
}

async function drawStroke(stage, pointerId, points, pointerType = "pen") {
  await dispatchPointer(stage, "pointerdown", pointerId, points[0].x, points[0].y, pointerType);
  for (let index = 1; index < points.length; index += 1) await dispatchPointer(stage, "pointermove", pointerId, points[index].x, points[index].y, pointerType);
  await dispatchPointer(stage, "pointerup", pointerId, points.at(-1).x, points.at(-1).y, pointerType);
}

// The marks as the reader would load them: the stored form is compact (shared
// point fields kept once per stroke), so raw JSON differs from a seeded one
// that holds the same marks.
async function savedAnnotations(page) {
  const key = catalogWorkspaceStorageKey("user:ink-student", "biochemistry-1", "vitamin-1");
  return parseCatalogWorkspace(await page.evaluate((key) => localStorage.getItem(key), key))?.annotations ?? [];
}

async function firstPageBox(page) {
  return page.locator(".workspace-v2-a4-page").first().boundingBox();
}

for (const device of [
  { name: "phone", viewport: { width: 390, height: 844 }, dpr: 3 },
  { name: "iPad portrait", viewport: IPAD_PORTRAIT, dpr: 2 },
  { name: "iPad landscape", viewport: { width: 1194, height: 834 }, dpr: 2 }
]) test(`${device.name}: zoomed Retina handwriting uses screen-resolution pixels and hands off to vector ink`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: device.dpr });
  const page = await context.newPage();
  try {
    await mockAuthenticatedWorkspace(page);
    await openWorkspace(page, device.viewport);
    const stage = page.locator(".workspace-v2-document-stage");
    const bounds = await stage.boundingBox();
    const x = bounds.x + bounds.width * .3;
    const y = bounds.y + bounds.height * .35;
    await stage.dispatchEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey: true, deltaY: -4000 });
    await expect.poll(() => page.locator(".workspace-v2-a4-document").evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--workspace-a4-zoom")))).toBeGreaterThan(3);
    await dispatchPointer(stage, "pointerdown", 901, x, y);
    for (let i = 1; i < 35; i += 1) await dispatchPointer(stage, "pointermove", 901, x + i * 5, y + Math.sin(i * .4) * 24);
    const canvas = page.locator(".workspace-v2-live-annotation-canvas");
    await expect.poll(() => canvas.evaluate((node) => node.width)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("retina-live.png") });
    const pixels = await canvas.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { perScreenPixel: node.width / box.width, pixels: node.width * node.height, dpr: devicePixelRatio };
    });
    const alpha = await canvas.evaluate((node, point) => {
      const box = node.getBoundingClientRect();
      const px = Math.floor((point.x - box.left) * node.width / box.width);
      const py = Math.floor((point.y - box.top) * node.height / box.height);
      return node.getContext("2d").getImageData(px, py, 1, 1).data[3];
    }, { x: x + 80, y: y + Math.sin(16 * .4) * 24 });
    expect(alpha).toBeGreaterThan(0);
    await testInfo.attach("ink-density.json", { body: Buffer.from(JSON.stringify(pixels)), contentType: "application/json" });
    await dispatchPointer(stage, "pointerup", 901, x + 170, y + Math.sin(34 * .4) * 24);
    await expect(page.locator('.workspace-v2-annotation-layer [data-annotation-type="pen"]')).toHaveCount(1);
    await expect.poll(() => canvas.evaluate((node) => {
      const data = node.getContext("2d").getImageData(0, 0, node.width, node.height).data;
      return data.some((value, i) => i % 4 === 3 && value > 0);
    })).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("retina-committed.png") });
    expect(pixels.pixels).toBeLessThanOrEqual(6_000_000);
    expect(pixels.perScreenPixel).toBeGreaterThanOrEqual(pixels.dpr * .85);
  } finally {
    await context.close().catch(() => {});
  }
});

test("wobbly pen and highlighter lines become clean straight lines of the same tool", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await firstPageBox(page);
  const x = bounds.x + bounds.width * .15;
  const y = bounds.y + bounds.height * .3;
  for (const [tool, pointerId, offset] of [["pen", 41, 0], ["highlighter", 42, 140]]) {
    if (tool === "highlighter") await page.getByRole("button", { name: "Highlight", exact: true }).click();
    // A hand-drawn diagonal with tremor and a slight bow.
    const points = Array.from({ length: 24 }, (_, index) => ({
      x: x + index * 14,
      y: y + offset + index * 5 + Math.sin(index * 1.3) * 3 + Math.sin(index / 23 * Math.PI) * 6
    }));
    await drawStroke(stage, pointerId, points);
    await expect.poll(async () => (await savedAnnotations(page)).filter((item) => item.type === tool).length).toBe(1);
    const [saved] = (await savedAnnotations(page)).filter((item) => item.type === tool);
    const first = saved.points[0];
    const last = saved.points.at(-1);
    const length = Math.hypot(last.x - first.x, last.y - first.y);
    for (const point of saved.points) {
      const offLine = Math.abs((last.x - first.x) * (point.y - first.y) - (last.y - first.y) * (point.x - first.x)) / length;
      expect(offLine).toBeLessThan(.05);
    }
    expect(last.x).toBeGreaterThan(first.x);
  }
  expect((await savedAnnotations(page)).filter((item) => item.type === "shape")).toHaveLength(0);
  await expect(page.locator('.workspace-v2-annotation-layer [data-annotation-type="highlighter"]')).toHaveCount(1);
});

test("a curved stroke and handwriting stay freehand", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await firstPageBox(page);
  const x = bounds.x + bounds.width * .2;
  const y = bounds.y + bounds.height * .35;
  const arc = Array.from({ length: 24 }, (_, index) => ({ x: x + Math.sin(index / 23 * Math.PI / 2) * 220, y: y - Math.cos(index / 23 * Math.PI / 2) * 220 + 220 }));
  const cursive = Array.from({ length: 40 }, (_, index) => ({ x: x + index * 6, y: y + 260 + Math.sin(index * .8) * 16 }));
  await drawStroke(stage, 43, arc);
  await drawStroke(stage, 44, cursive);
  await expect.poll(async () => (await savedAnnotations(page)).filter((item) => item.type === "pen").length).toBe(2);
  for (const saved of (await savedAnnotations(page)).filter((item) => item.type === "pen")) expect(saved.points.length).toBeGreaterThan(10);
});

test("a sticky note has a clear Delete, and undo and redo restore and remove it in place", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Add note card/i }).click();
  await page.getByRole("textbox", { name: "Card text" }).fill("Delete me");
  await page.getByRole("button", { name: "Add card" }).click();
  const card = page.locator('.workspace-v2-annotation-layer [data-annotation-type="card"]');
  await expect(card).toHaveCount(1);
  const rect = card.locator(".workspace-note-card-paper");
  const position = { x: await rect.getAttribute("x"), y: await rect.getAttribute("y") };
  const box = await card.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  const remove = page.locator("[data-selection-toolbar]").getByRole("button", { name: "Delete" });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(card).toHaveCount(1);
  expect({ x: await rect.getAttribute("x"), y: await rect.getAttribute("y") }).toEqual(position);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(card).toHaveCount(1);

  // The card editor offers the same delete.
  const again = await card.boundingBox();
  await page.mouse.click(again.x + again.width / 2, again.y + 30);
  await page.locator("[data-selection-toolbar]").getByRole("button", { name: "Edit card" }).click();
  await page.getByRole("dialog", { name: "Edit note card" }).getByRole("button", { name: "Delete card" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(card).toHaveCount(1);
});

test("the eraser shows its real reach at every zoom and one drag is one undo", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 900 });
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await firstPageBox(page);
  const x = bounds.x + bounds.width * .25;
  const y = bounds.y + bounds.height * .25;
  await drawStroke(stage, 51, Array.from({ length: 12 }, (_, index) => ({ x: x + index * 3 + Math.sin(index) * 12, y: y + index * 14 })));
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await drawStroke(stage, 52, Array.from({ length: 12 }, (_, index) => ({ x: x + 60 + Math.sin(index) * 12, y: y + index * 14 })));
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(2);

  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const hitbox = page.locator(".workspace-v2-eraser-hitbox");
  await page.mouse.move(x - 40, y + 40);
  await expect.poll(async () => hitbox.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  const size = await hitbox.evaluate((node) => node.getBoundingClientRect().width);
  expect(size).toBeGreaterThanOrEqual(6);
  const center = await hitbox.evaluate((node) => { const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
  expect(Math.abs(center.x - (x - 40))).toBeLessThan(1.5);
  expect(Math.abs(center.y - (y + 40))).toBeLessThan(1.5);

  // One horizontal drag through both marks.
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(x - 40 + step * 15, y + 40);
  await page.mouse.up();
  const masks = page.locator('.workspace-v2-annotation-layer mask[id^="workspace-erase-"]');
  await expect(masks).toHaveCount(2);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(masks).toHaveCount(0);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect(masks).toHaveCount(2);

  // The outline stays the same on-screen size after zooming.
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.mouse.move(x + 10, y + 10);
  await page.mouse.move(x + 12, y + 12);
  await expect.poll(async () => hitbox.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  expect(Math.abs(await hitbox.evaluate((node) => node.getBoundingClientRect().width) - size)).toBeLessThan(.5);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await expect.poll(async () => hitbox.evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
});

test("the stroke eraser removes each touched stroke whole and one drag is one undo", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 900 });
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await firstPageBox(page);
  const x = bounds.x + bounds.width * .25;
  const y = bounds.y + bounds.height * .25;
  await drawStroke(stage, 61, Array.from({ length: 12 }, (_, index) => ({ x: x + index * 3 + Math.sin(index) * 12, y: y + index * 14 })));
  await drawStroke(stage, 62, Array.from({ length: 12 }, (_, index) => ({ x: x + 160 + Math.sin(index) * 12, y: y + index * 14 })));
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(2);

  const eraser = page.getByRole("button", { name: "Eraser", exact: true });
  await eraser.click();
  const options = page.getByRole("dialog", { name: "Eraser options" });
  if (!(await options.isVisible())) await eraser.click();
  await options.getByRole("button", { name: "Stroke Eraser" }).click();
  await expect(options.getByRole("button", { name: "Stroke Eraser" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(options).toHaveCount(0);

  // A short drag across the first stroke only: it goes whole, with no mask.
  await page.mouse.move(x - 30, y + 80);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(x - 30 + step * 12, y + 80);
  await page.mouse.up();
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(1);
  await expect(page.locator('.workspace-v2-annotation-layer mask[id^="workspace-erase-"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(2);
});

test("a stylus flick with the Pan tool scrolls and keeps gliding after release", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Hand", exact: true }).click();
  const stage = page.locator(".workspace-v2-document-stage");
  const box = await stage.boundingBox();
  const startTop = await stage.evaluate((node) => node.scrollTop);
  const released = await page.evaluate(async ({ x, y }) => {
    const target = document.querySelector(".workspace-v2-document-stage");
    // This checks a 60Hz input flick, independently of software WebKit's paint
    // cadence. Live frame latency has a separate benchmark using actual times.
    let inputTime = performance.now();
    const send = (type, clientY) => {
      const event = new PointerEvent(type, { pointerId: 61, pointerType: "pen", isPrimary: true, clientX: x, clientY, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5, bubbles: true, cancelable: true });
      Object.defineProperty(event, "timeStamp", { value: inputTime });
      inputTime += 1000 / 60;
      target.dispatchEvent(event);
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    send("pointerdown", y);
    for (let step = 1; step <= 8; step += 1) { await frame(); send("pointermove", y - step * 28); }
    send("pointerup", y - 8 * 28);
    return target.scrollTop;
  }, { x: box.x + box.width / 2, y: box.y + box.height * .75 });
  expect(released).toBeGreaterThan(startTop + 100);
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop), { timeout: 2_000 }).toBeGreaterThan(released + 20);
  expect((await savedAnnotations(page)).length).toBe(0);
});

test("with a drawing tool, a stylus drag beside the page scrolls instead of drawing", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 900 });
  // Zoom out until the page no longer fills the width, leaving a gutter.
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  for (let step = 0; step < 4 && await zoomOut.isEnabled(); step += 1) await zoomOut.click();
  const stage = page.locator(".workspace-v2-document-stage");
  await expect.poll(async () => {
    const [pageBox, stageBox] = await Promise.all([firstPageBox(page), stage.boundingBox()]);
    return pageBox.x - stageBox.x;
  }).toBeGreaterThan(40);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const [pageBox, stageBox] = await Promise.all([firstPageBox(page), stage.boundingBox()]);
  const gutterX = stageBox.x + (pageBox.x - stageBox.x) / 2;
  const startTop = await stage.evaluate((node) => node.scrollTop);
  const y = stageBox.y + stageBox.height * .7;
  await drawStroke(stage, 62, Array.from({ length: 10 }, (_, index) => ({ x: gutterX, y: y - index * 30 })));
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBeGreaterThan(startTop + 100);
  expect((await savedAnnotations(page)).length).toBe(0);

  // The flick can glide into page two. Clamping page one's old coordinates
  // to the viewport can put the next stroke in the gap between pages.
  const onPage = await stage.evaluate((node) => {
    const viewport = node.getBoundingClientRect();
    for (const element of node.querySelectorAll("[data-workspace-page]")) {
      const box = element.getBoundingClientRect();
      const top = Math.max(box.top, viewport.top + 40);
      const bottom = Math.min(box.bottom, viewport.bottom - 40);
      if (bottom - top < 100) continue;
      const x = box.left + box.width * .3;
      const y = (top + bottom) / 2;
      if (document.elementFromPoint(x, y)?.closest("[data-workspace-page]") !== element) continue;
      // Hit-test and touch down in one browser task: momentum cannot move a
      // gap under a point between a remote boundingBox read and pointerdown.
      node.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 63, pointerType: "pen", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1, pressure: .5, width: 2, height: 2, bubbles: true, cancelable: true }));
      return { x, y };
    }
    return null;
  });
  expect(onPage).not.toBeNull();
  // On a currently visible page the same stylus still writes.
  for (let index = 1; index < 10; index++) await dispatchPointer(stage, "pointermove", 63, onPage.x + index * 6, onPage.y + Math.sin(index) * 20);
  await dispatchPointer(stage, "pointerup", 63, onPage.x + 54, onPage.y + Math.sin(9) * 20);
  await expect.poll(async () => (await savedAnnotations(page)).filter((item) => item.type === "pen").length).toBe(1);
});

test("one pen stroke is one undo step and redo restores the same stroke", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await firstPageBox(page);
  const x = bounds.x + bounds.width * .3;
  const y = bounds.y + bounds.height * .3;
  await drawStroke(stage, 71, Array.from({ length: 40 }, (_, index) => ({ x: x + index * 4, y: y + Math.sin(index * .5) * 25 })));
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(1);
  const [stroke] = await savedAnnotations(page);
  const undo = page.getByRole("button", { name: "Undo (Ctrl+Z)" });
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(0);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect.poll(async () => (await savedAnnotations(page)).length).toBe(1);
  expect((await savedAnnotations(page))[0]).toEqual(stroke);
});

test("the very next stroke after a tool tap uses the new tool, even before React re-renders", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const bounds = await firstPageBox(page);
  const result = await page.evaluate(({ x, y }) => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const send = (type, pointerId, clientX, clientY) => stage.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: "pen", isPrimary: true, clientX, clientY, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5, bubbles: true, cancelable: true }));
    const stroke = (pointerId, offset) => {
      send("pointerdown", pointerId, x, y + offset);
      for (let step = 1; step <= 12; step += 1) send("pointermove", pointerId, x + step * 9, y + offset + Math.sin(step) * 14);
      send("pointerup", pointerId, x + 108, y + offset);
    };
    const tool = (name) => document.querySelector(`[data-workspace-tool="${name}"]`).click();
    // Tap and draw in the same task: no render can happen in between.
    tool("highlighter");
    stroke(81, 0);
    tool("hand");
    const before = stage.scrollTop;
    send("pointerdown", 82, x, y + 300);
    for (let step = 1; step <= 6; step += 1) send("pointermove", 82, x, y + 300 - step * 30);
    send("pointerup", 82, x, y + 120);
    tool("pen");
    stroke(83, 160);
    return { panned: stage.scrollTop !== before };
  }, { x: bounds.x + bounds.width * .2, y: bounds.y + bounds.height * .2 });
  expect(result.panned).toBe(true);
  await expect.poll(async () => (await savedAnnotations(page)).map((item) => item.type).sort().join(",")).toBe("highlighter,pen");
});

test("a note in the Notes panel has its own Delete, and undo/redo restore and remove it", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 900 });
  await page.getByRole("button", { name: "Open notes" }).click();
  await page.getByPlaceholder(/Write a note for page/).fill("Remember the cofactor");
  await page.getByRole("button", { name: /^Save to page/ }).click();
  const note = page.getByRole("button", { name: /^Open note from page/ });
  await expect(note).toHaveCount(1);
  await page.getByRole("button", { name: /^Delete note from page/ }).click();
  await expect(note).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("Remember the cofactor");
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect(note).toHaveCount(0);
});


test("an existing erasure masks only its own stroke during a new eraser preview", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await seedMaskScopeWorkspace(page);
  await openWorkspace(page);
  const marks = page.locator('[data-pdf-page="1"] [data-annotation-type="pen"]');
  await expect(marks).toHaveCount(2);
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const stage = page.locator(".workspace-v2-document-stage");
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const bounds = await firstPageBox(page);
  const x = bounds.x + bounds.width * .7;
  await dispatchPointer(stage, "pointerdown", 191, x, bounds.y + bounds.height * .38);
  await dispatchPointer(stage, "pointermove", 191, x, bounds.y + bounds.height * .5);
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const pixel = await visiblePixel(page, bounds.x + bounds.width * .4, bounds.y + bounds.height * .38);
  expect(pixel[0]).toBeGreaterThan(250);
  expect(pixel[1]).toBeLessThan(5);
  expect(pixel[2]).toBeLessThan(5);
  expect(pixel[3]).toBeGreaterThan(250);
  await dispatchPointer(stage, "pointerup", 191, x, bounds.y + bounds.height * .5);
  await expect.poll(async () => (await savedAnnotations(page)).map((a) => a.erasures?.length || 0)).toEqual([1, 2]);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect.poll(async () => (await savedAnnotations(page)).map((a) => a.erasures?.length || 0)).toEqual([0, 1]);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect.poll(async () => (await savedAnnotations(page)).map((a) => a.erasures?.length || 0)).toEqual([1, 2]);
});

async function seedMaskScopeWorkspace(page, maskCount = 1) {
  const stroke = (id, color, y) => ({ id, page: 1, type: "pen", color, width: 14, opacity: 1, profile: "ball", createdAt: "2026-01-01T00:00:00.000Z", points: Array.from({ length: 20 }, (_, index) => ({ x: 150 + index * 700 / 19, y, t: index * 8, p: .5, pointer: "pen" })) });
  const red = stroke("preview-red", "#ff0000", 380);
  const blue = { ...stroke("preview-blue", "#0000ff", 500), erasures: Array.from({ length: maskCount }, () => ({ radius: 30, points: [{ x: 400, y: 500 }, { x: 400, y: 380 }] })) };
  // Seed the same canonical shape hydration loads: exact Undo must not race the
  // initial normalization save. Blue's historical mask remains independent of red.
  const snapshot = { version: 1, ...parseCatalogWorkspace(JSON.stringify({ version: 1, page: 1, zoom: 1, annotations: [red, blue], notes: [] })) };
  await page.addInitScript(({ key, snapshot }) => {
    localStorage.setItem(key, JSON.stringify(snapshot));
  }, { key: catalogWorkspaceStorageKey("user:ink-student", "biochemistry-1", "vitamin-1"), snapshot });
}


test("pointer moves avoid forced scroll reads and scripted scrolling remains pinned", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const box = await firstPageBox(page);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const start = { x: box.x + box.width * .3, y: box.y + box.height * .28 };
  const initial = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  await dispatchPointer(stage, "pointerdown", 211, start.x, start.y);
  const reads = await page.evaluate(({ x, y }) => {
    const target = document.querySelector(".workspace-v2-document-stage");
    const descriptors = ["scrollLeft", "scrollTop"].map((key) => [key, Object.getOwnPropertyDescriptor(Element.prototype, key)]);
    let count = 0;
    try {
      for (const [key, descriptor] of descriptors) {
        Object.defineProperty(Element.prototype, key, { ...descriptor, get() {
          if (this === target) count++;
          return descriptor.get.call(this);
        } });
      }
      target.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 211, pointerType: "pen", isPrimary: true,
        clientX: x + 25, clientY: y + 8, button: 0, buttons: 1, pressure: .5,
        bubbles: true, cancelable: true
      }));
    } finally {
      for (const [key, descriptor] of descriptors) Object.defineProperty(Element.prototype, key, descriptor);
    }
    return count;
  }, start);
  expect(reads).toBe(0);
  await stage.evaluate((node) => { node.scrollTop += 180; });
  await expect.poll(() => stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }))).toEqual(initial);
  await dispatchPointer(stage, "pointermove", 211, start.x + 55, start.y + 12);
  await dispatchPointer(stage, "pointerup", 211, start.x + 55, start.y + 12);
  await expect.poll(async () => (await savedAnnotations(page)).filter((annotation) => annotation.type === "pen").length).toBe(1);
  const ink = (await savedAnnotations(page)).find((annotation) => annotation.type === "pen");
  expect(ink.points.at(-1).y - ink.points[0].y).toBeLessThan(25);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect.poll(() => savedAnnotations(page)).toEqual([]);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect.poll(() => savedAnnotations(page)).toEqual([ink]);
});


test("a stationary precision eraser retains its pixels without repainting and commits once", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await seedMaskScopeWorkspace(page);
  await openWorkspace(page);
  await expect(page.locator('[data-pdf-page="1"] [data-annotation-type="pen"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await firstPageBox(page);
  const position = { x: bounds.x + bounds.width * .7, y: bounds.y + bounds.height * .38 };
  await dispatchPointer(stage, "pointerdown", 212, position.x, position.y);
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const clip = { x: Math.ceil(bounds.x), y: Math.ceil(bounds.y), width: Math.floor(bounds.width) - 2, height: Math.min(Math.floor(bounds.height) - 2, 1000) };
  const before = await page.screenshot({ type: "png", scale: "css", clip });
  const repaints = await page.evaluate(async ({ x, y }) => {
    const canvas = document.querySelector(".workspace-v2-live-annotation-canvas");
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    const setAttribute = Element.prototype.setAttribute;
    let count = 0;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas === canvas) count++;
      return clear.apply(this, args);
    };
    Element.prototype.setAttribute = function (name, value) {
      if (this.closest?.(".workspace-v2-svg-eraser-preview") && this.getAttribute(name) !== String(value)) count++;
      return setAttribute.call(this, name, value);
    };
    try {
      const target = document.querySelector(".workspace-v2-document-stage");
      for (let i = 0; i < 20; i++) {
        target.dispatchEvent(new PointerEvent("pointermove", {
          pointerId: 212, pointerType: "pen", isPrimary: true,
          clientX: x, clientY: y, button: 0, buttons: 1, pressure: .5,
          bubbles: true, cancelable: true
        }));
        await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);
    } finally {
      CanvasRenderingContext2D.prototype.clearRect = clear;
      Element.prototype.setAttribute = setAttribute;
    }
    return count;
  }, position);
  const after = await page.screenshot({ type: "png", scale: "css", clip });
  expect(before.equals(after)).toBe(true);
  expect(repaints).toBe(0);
  const pixel = await visiblePixel(page, bounds.x + bounds.width * .4, bounds.y + bounds.height * .38);
  expect(pixel[0]).toBeGreaterThan(250); expect(pixel[1]).toBeLessThan(5); expect(pixel[2]).toBeLessThan(5);
  await dispatchPointer(stage, "pointerup", 212, position.x, position.y);
  await expect.poll(async () => (await savedAnnotations(page)).map((annotation) => annotation.erasures?.length || 0)).toEqual([1, 1]);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect.poll(async () => (await savedAnnotations(page)).map((annotation) => annotation.erasures?.length || 0)).toEqual([0, 1]);
  await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
  await expect.poll(async () => (await savedAnnotations(page)).map((annotation) => annotation.erasures?.length || 0)).toEqual([1, 1]);
});

async function visiblePixel(page, x, y) {
  const png = await page.screenshot({ type: "png", scale: "css", clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
  return page.evaluate(async (data) => {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    image.src = "data:image/png;base64," + data;
    await loaded;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const pixel = [...context.getImageData(0, 0, 1, 1).data];
    canvas.width = canvas.height = 0;
    return pixel;
  }, png.toString("base64"));
}


test("precision preview preserves fractional viewport native pixels and releases its layer", async ({ page }, testInfo) => {
 await mockAuthenticatedWorkspace(page); await seedMaskScopeWorkspace(page); await openWorkspace(page);
 await expect(page.locator('[data-pdf-page="1"] [data-annotation-type="pen"]')).toHaveCount(2);
 await page.getByRole("button", {name:"Eraser",exact:true}).click();
 await page.addStyleTag({content:".workspace-v2-eraser-hitbox {visibility:hidden !important}"});
 await page.evaluate(async()=>{
  const source=document.querySelector('[data-pdf-page="1"] > svg.workspace-v2-annotation-layer');
  source.style.width=`${source.clientWidth+.25}px`;source.style.height=`${source.clientHeight+.25}px`;
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 });
 const stage=page.locator(".workspace-v2-document-stage");const bounds=await firstPageBox(page);const x=bounds.x+bounds.width*.7;
 await dispatchPointer(stage,"pointerdown",199,x,bounds.y+bounds.height*.38);
 await dispatchPointer(stage,"pointermove",199,x,bounds.y+bounds.height*.5);
 await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 const overlay=page.locator(".workspace-v2-svg-eraser-preview");await expect(overlay).toHaveCount(1);
 await expect(overlay).toHaveAttribute("aria-hidden","true");await expect(overlay.locator("[data-annotation-id]")).toHaveCount(0);
 const clip={x:Math.ceil(bounds.x),y:Math.ceil(bounds.y),width:Math.floor(bounds.width)-2,height:Math.floor(bounds.height)-2};
 const geometry=await page.evaluate(()=>{
  const source=document.querySelector('[data-pdf-page="1"] > svg.workspace-v2-annotation-layer');
  const preview=document.querySelector('.workspace-v2-svg-eraser-preview');
  const shape=(node)=>({rect:node.getBoundingClientRect().toJSON(),style:node.getAttribute('style'),viewBox:node.getAttribute('viewBox'),mask:[...node.querySelectorAll('mask')].map(m=>({id:m.id,x:m.getAttribute('x'),y:m.getAttribute('y'),width:m.getAttribute('width'),height:m.getAttribute('height')}))});
  return {source:shape(source),preview:shape(preview),dpr:devicePixelRatio};
 });
 await testInfo.attach("geometry.json",{body:Buffer.from(JSON.stringify(geometry,null,2)),contentType:"application/json"});
 const before=await page.screenshot({type:"png",scale:"css",clip});
 await dispatchPointer(stage,"pointerup",199,x,bounds.y+bounds.height*.5);
 await expect(overlay).toHaveCount(0);
 await expect.poll(async()=>(await savedAnnotations(page)).map(a=>a.erasures?.length||0)).toEqual([1,2]);
 await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 const after=await page.screenshot({type:"png",scale:"css",clip});
 await testInfo.attach("before.png",{body:before,contentType:"image/png"});
 await testInfo.attach("after.png",{body:after,contentType:"image/png"});
 expect(before.equals(after)).toBe(true);
 await expect(page.locator('[data-pdf-page="1"] > svg.workspace-v2-annotation-layer')).toBeVisible();
});


for (const maskCount of [31, 32, 33]) {
  test(`precision preview falls back safely at ${maskCount} historical masks`, async ({ page }) => {
    await mockAuthenticatedWorkspace(page);
    await seedMaskScopeWorkspace(page, maskCount);
    await openWorkspace(page);
    await expect(page.locator('[data-pdf-page="1"] [data-annotation-type="pen"]')).toHaveCount(2);
    const original = await savedAnnotations(page);
    await page.getByRole("button", { name: "Eraser", exact: true }).click();
    const stage = page.locator(".workspace-v2-document-stage");
    const bounds = await firstPageBox(page);
    const x = bounds.x + bounds.width * .7;
    await dispatchPointer(stage, "pointerdown", 220, x, bounds.y + bounds.height * .38);
    await expect(page.locator(".workspace-v2-svg-eraser-preview")).toHaveCount(1);
    await dispatchPointer(stage, "pointermove", 220, x, bounds.y + bounds.height * .5);
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    await expect(page.locator(".workspace-v2-svg-eraser-preview")).toHaveCount(0);
    const pixel = await visiblePixel(page, bounds.x + bounds.width * .4, bounds.y + bounds.height * .38);
    expect(pixel[0]).toBeGreaterThan(250);
    expect(pixel[1]).toBeLessThan(5);
    expect(pixel[2]).toBeLessThan(5);
    await dispatchPointer(stage, "pointerup", 220, x, bounds.y + bounds.height * .5);
    await expect.poll(async () => JSON.stringify(await savedAnnotations(page))).not.toBe(JSON.stringify(original));
    const committed = await savedAnnotations(page);
    await expect(page.locator('[mask*="eraser-preview-"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    await expect.poll(() => savedAnnotations(page)).toEqual(original);
    await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
    await expect.poll(() => savedAnnotations(page)).toEqual(committed);
    await expect(page.locator(".workspace-v2-svg-eraser-preview")).toHaveCount(0);
  });
}

test("canceling a precision eraser restores the original pixels and removes temporary masks", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await seedMaskScopeWorkspace(page);
  await openWorkspace(page);
  await expect(page.locator('[data-pdf-page="1"] [data-annotation-type="pen"]')).toHaveCount(2);
  const original = await savedAnnotations(page);
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await page.addStyleTag({ content: ".workspace-v2-eraser-hitbox {visibility:hidden !important}" });
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await firstPageBox(page);
  const clip = { x: Math.ceil(bounds.x), y: Math.ceil(bounds.y), width: Math.floor(bounds.width) - 2, height: Math.min(Math.floor(bounds.height) - 2, 1000) };
  const before = await page.screenshot({ type: "png", scale: "css", clip });
  const x = bounds.x + bounds.width * .7;
  await dispatchPointer(stage, "pointerdown", 230, x, bounds.y + bounds.height * .38);
  await dispatchPointer(stage, "pointermove", 230, x, bounds.y + bounds.height * .5);
  await expect(page.locator(".workspace-v2-svg-eraser-preview")).toHaveCount(1);
  await dispatchPointer(stage, "pointercancel", 230, x, bounds.y + bounds.height * .5);
  await expect(page.locator(".workspace-v2-svg-eraser-preview")).toHaveCount(0);
  await expect(page.locator('[mask*="eraser-preview-"]')).toHaveCount(0);
  await expect.poll(() => savedAnnotations(page)).toEqual(original);
  await expect(page.getByRole("button", { name: "Undo (Ctrl+Z)" })).toBeDisabled();
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const after = await page.screenshot({ type: "png", scale: "css", clip });
  expect(before.equals(after)).toBe(true);
});

for (const maskCount of [1, 31]) {
  test(`an unfinished eraser with ${maskCount} historical masks releases its hidden layer and resumes once`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await mockAuthenticatedWorkspace(page);
    await seedMaskScopeWorkspace(page, maskCount);
    // Landscape keeps the tabs in the toolbar's one row, so opening the second
    // sheet below does not add a tab row and move the reader between the two
    // pixel captures (portrait drops the row while one document is open).
    await openWorkspace(page, IPAD_LANDSCAPE);
    await expect(page.locator('[data-pdf-page="1"] [data-annotation-type="pen"]')).toHaveCount(2);
    const original = await savedAnnotations(page);
    await page.getByRole("button", { name: "Eraser", exact: true }).click();
    await page.addStyleTag({ content: ".workspace-v2-eraser-hitbox {visibility:hidden !important}" });
    await page.evaluate(() => {
      const create = document.createElement;
      window.__eraserOwnedCanvases = [];
      document.createElement = function (tag, ...args) {
        const node = create.call(this, tag, ...args);
        if (tag === "canvas") window.__eraserOwnedCanvases.push(node);
        return node;
      };
      window.__restoreEraserCreate = () => { document.createElement = create; };
    });
    const stage = page.locator(".workspace-pane.is-active .workspace-v2-document-stage");
    const bounds = await firstPageBox(page);
    const x = bounds.x + bounds.width * .7;
    await dispatchPointer(stage, "pointerdown", 240, x, bounds.y + bounds.height * .38);
    await dispatchPointer(stage, "pointermove", 240, x, bounds.y + bounds.height * .5);
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); window.__restoreEraserCreate(); });
    expect(await page.evaluate(() => window.__eraserOwnedCanvases.length)).toBe(maskCount === 1 ? 0 : 1);
    const clip = { x: Math.ceil(bounds.x), y: Math.ceil(bounds.y), width: Math.floor(bounds.width) - 2, height: Math.min(Math.floor(bounds.height) - 2, 1000) };
    const inspect = () => page.locator(".workspace-pane.is-active .workspace-v2-live-annotation-canvas").evaluate(canvas => ({ width: canvas.width, height: canvas.height, rect: canvas.getBoundingClientRect().toJSON(), clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, dpr: devicePixelRatio }));
    const initialGeometry = await inspect();
    const before = await page.screenshot({ type: "png", scale: "css", clip });
    await page.evaluate(() => { location.hash = "/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace"; });
    await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Vitamin -2");
    await page.getByRole("button", { name: /Normal Study/ }).click();
    await expect(page.locator(".workspace-pane.is-kept .workspace-v2-svg-eraser-preview")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__eraserOwnedCanvases.every(canvas => canvas.width === 0 && canvas.height === 0))).toBe(true);
    await page.locator(".workspace-pane.is-active .workspace-v2-toolbar [role='tab']").filter({ hasText: "Vitamin -1" }).click();
    await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Vitamin -1");
    // Hidden PDF buffers are released independently of ink. Compare only after
    // PDF.js swaps a completed back buffer into the visible page layer.
    await expect.poll(() => page.locator('.workspace-pane.is-active [data-pdf-page="1"] .workspace-v2-a4-canvas.is-visible').evaluate(canvas => canvas.width * canvas.height)).toBeGreaterThan(0);
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    const after = await page.screenshot({ type: "png", scale: "css", clip });
    await testInfo.attach("before.png", { body: before, contentType: "image/png" });
    await testInfo.attach("after.png", { body: after, contentType: "image/png" });
    await testInfo.attach("geometry.json", { body: Buffer.from(JSON.stringify({ before: initialGeometry, after: await inspect() })), contentType: "application/json" });
    expect(before.equals(after)).toBe(true);
    await dispatchPointer(stage, "pointerup", 240, x, bounds.y + bounds.height * .5);
    await expect.poll(async () => (await savedAnnotations(page)).map(annotation => annotation.erasures?.length || 0)).toEqual([1, maskCount + 1]);
    const committed = await savedAnnotations(page);
    await expect(page.locator(".workspace-v2-svg-eraser-preview")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
    await expect.poll(() => savedAnnotations(page)).toEqual(original);
    await page.getByRole("button", { name: "Redo (Ctrl+Shift+Z)" }).click();
    await expect.poll(() => savedAnnotations(page)).toEqual(committed);
  });
}

test('dense precision previews keep native pixels and exact one-step history', async ({ page }, testInfo) => {
  await mockAuthenticatedWorkspace(page);
  const annotations = Array.from({ length: 160 }, (_, index) => ({ id: `clip-${index}`, page: 1, type: ['pen', 'pencil', 'highlighter'][index % 3], color: ['#8b5cf6', '#dc2626', '#16a34a'][index % 3], width: 4 + index % 5 * 4, opacity: index % 3 === 2 ? .34 : 1, profile: index % 3 === 1 ? 'pencil' : 'ball', locked: index % 13 === 0, points: Array.from({ length: 40 }, (_, step) => ({ x: (index * 13 + step * 4) % 980, y: (index * 29 + step * 7) % 980, t: step * 8, p: step % 5 / 4, pointer: 'pen' })), ...(index % 7 === 0 ? { erasures: [{ radius: 12, points: [{ x: 400, y: 350 }, { x: 480, y: 600 }] }] } : {}) }));
  for (const [index, points] of [[[0, 0], [1000, 0]], [[1000, 0], [1000, 1000]], [[1000, 1000], [0, 1000]], [[0, 1000], [0, 0]]].entries()) annotations.push({ id: `edge-${index}`, page: 1, type: 'pen', color: '#0000ff', width: 24, opacity: 1, profile: 'ball', points: points.map(([x, y]) => ({ x, y, p: .8, pointer: 'pen' })) });
  const snapshot = { version: 1, ...parseCatalogWorkspace(JSON.stringify({ version: 1, page: 1, zoom: 1, annotations, notes: [] })) };
  await page.addInitScript(({ key, snapshot }) => { localStorage.setItem(key, JSON.stringify(snapshot)); },
    { key: catalogWorkspaceStorageKey('user:ink-student', 'biochemistry-1', 'vitamin-1'), snapshot });
  await openWorkspace(page);
  await expect(page.locator('[data-pdf-page="1"] [data-annotation-id]')).toHaveCount(164);
  const layer = page.locator('[data-pdf-page="1"] > svg.workspace-v2-annotation-layer');
  const renderedIds = () => layer.locator('[data-annotation-id]').evaluateAll(marks => marks.map(mark => mark.dataset.annotationId));
  const awaitSavedOrder = async () => {
    // This fixture has one highlighter group, painted below the other ink.
    await expect.poll(async () => {
      const saved = await savedAnnotations(page);
      const painted = [...saved.filter(mark => mark.type === 'highlighter'), ...saved.filter(mark => mark.type !== 'highlighter')];
      return JSON.stringify(painted.map(mark => mark.id)) === JSON.stringify(await renderedIds());
    }).toBe(true);
  };
  await awaitSavedOrder();
  const original = await savedAnnotations(page);
  const bounds = await firstPageBox(page);
  const clip = { x: Math.floor(bounds.x), y: Math.floor(bounds.y), width: Math.ceil(bounds.width), height: Math.min(Math.ceil(bounds.height), 900) };
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.addStyleTag({ content: '.workspace-v2-eraser-hitbox {visibility:hidden !important}' });
  const stage = page.locator('.workspace-v2-document-stage');
  for (let step = 0; step < 12; step++) {
    await dispatchPointer(stage, step === 0 ? 'pointerdown' : 'pointermove', 701,
      bounds.x + bounds.width * (.2 + step * .02), bounds.y + bounds.height * (.3 + step * .012));
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  }
  await expect(page.locator('.workspace-v2-svg-eraser-preview')).toHaveCount(1);
  const before = await page.screenshot({ type: 'png', scale: 'css', clip });
  await dispatchPointer(stage, 'pointerup', 701, bounds.x + bounds.width * .42, bounds.y + bounds.height * .432);
  await expect(page.locator('.workspace-v2-svg-eraser-preview')).toHaveCount(0);
  await expect.poll(() => savedAnnotations(page)).not.toEqual(original);
  await awaitSavedOrder();
  const committed = await savedAnnotations(page);
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const after = await page.screenshot({ type: 'png', scale: 'css', clip });
  await testInfo.attach('dense-preview.png', { body: before, contentType: 'image/png' });
  await testInfo.attach('dense-commit.png', { body: after, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  const undone = await savedAnnotations(page);
  await testInfo.attach('dense-history.json', { body: Buffer.from(JSON.stringify({ original, committed, undone })), contentType: 'application/json' });
  await expect.poll(() => savedAnnotations(page)).toEqual(original);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
  await expect.poll(() => savedAnnotations(page)).toEqual(committed);
  await expect(layer).toBeVisible();
  expect(before.equals(after)).toBe(true);
});

 test('object eraser preserves locked cards and restores exact complete history', async ({page}) => {
  await mockAuthenticatedWorkspace(page);
  const points = y => [{x:150,y,p:.5,pointer:'pen',t:0},{x:850,y,p:.5,pointer:'pen',t:20}];
  const annotations = [
    {id:'object-first',type:'pen',page:1,width:14,points:points(380)},
    {id:'object-second',type:'pencil',page:1,width:14,points:points(500)},
    {id:'locked-card',type:'card',page:1,x:320,y:420,width:170,height:100,locked:true,text:'Keep this note'}
  ];
  const snapshot = {version:1,...parseCatalogWorkspace(JSON.stringify({version:1,annotations,notes:[],page:1,zoom:1}))};
  await page.addInitScript(({key,snapshot}) => localStorage.setItem(key,JSON.stringify(snapshot)),{key:catalogWorkspaceStorageKey('user:ink-student','biochemistry-1','vitamin-1'),snapshot});
  await openWorkspace(page);
  await expect(page.locator('[data-pdf-page="1"] [data-annotation-id]')).toHaveCount(3);
  const original = await savedAnnotations(page);
  const eraser = page.getByRole('button',{name:'Eraser',exact:true}); await eraser.click();
  const options = page.getByRole('dialog',{name:'Eraser options'});
  if(!await options.isVisible())await eraser.click();
  await options.getByRole('button',{name:'Object Eraser'}).click();
  await expect(options.getByRole('button',{name:'Object Eraser'})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  const bounds = await firstPageBox(page),stage = page.locator('.workspace-v2-document-stage');
  const x = bounds.x+bounds.width*.4;
  await dispatchPointer(stage,'pointerdown',702,x,bounds.y+bounds.height*.38);
  for(let step=1;step<=12;step++)await dispatchPointer(stage,'pointermove',702,x,bounds.y+bounds.height*(.38+step*.01));
  await dispatchPointer(stage,'pointerup',702,x,bounds.y+bounds.height*.5);
  await expect.poll(()=>savedAnnotations(page)).toEqual(original.filter(mark=>mark.locked));
  const committed = await savedAnnotations(page);
  await expect(page.locator('mask[id^="workspace-erase-"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo (Ctrl+Z)'}).click();
  await expect.poll(()=>savedAnnotations(page)).toEqual(original);
  await page.getByRole('button',{name:'Redo (Ctrl+Shift+Z)'}).click();
  await expect.poll(()=>savedAnnotations(page)).toEqual(committed);
});
