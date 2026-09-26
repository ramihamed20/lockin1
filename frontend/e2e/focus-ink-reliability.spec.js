import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const IPAD_PORTRAIT = { width: 834, height: 1194 };

async function mockAuthenticatedWorkspace(page) {
  await page.addInitScript(() => { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined }); });
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

function savedAnnotations(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("lock-in.catalog-workspace.v1.user_ink-student."));
    return key ? JSON.parse(localStorage.getItem(key))?.annotations ?? [] : [];
  });
}

async function firstPageBox(page) {
  return page.locator(".workspace-v2-a4-page").first().boundingBox();
}

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
  await page.getByRole("button", { name: /Add sticky note/i }).click();
  await page.getByRole("textbox", { name: "Card text" }).fill("Delete me");
  await page.getByRole("button", { name: "Add card" }).click();
  const card = page.locator('.workspace-v2-annotation-layer [data-annotation-type="card"]');
  await expect(card).toHaveCount(1);
  const rect = card.locator("rect").first();
  const position = { x: await rect.getAttribute("x"), y: await rect.getAttribute("y") };
  const box = await card.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  const remove = page.locator(".workspace-v2-selection-menu").getByRole("button", { name: "Delete note" });
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
  await page.locator(".workspace-v2-selection-menu").getByRole("button", { name: "Edit card" }).click();
  await page.getByRole("dialog", { name: "Edit study card" }).getByRole("button", { name: "Delete card" }).click();
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

test("a stylus flick with the Pan tool scrolls and keeps gliding after release", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Hand", exact: true }).click();
  const stage = page.locator(".workspace-v2-document-stage");
  const box = await stage.boundingBox();
  const startTop = await stage.evaluate((node) => node.scrollTop);
  const released = await page.evaluate(async ({ x, y }) => {
    const target = document.querySelector(".workspace-v2-document-stage");
    const send = (type, clientY) => target.dispatchEvent(new PointerEvent(type, { pointerId: 61, pointerType: "pen", isPrimary: true, clientX: x, clientY, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5, bubbles: true, cancelable: true }));
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

  // On the page itself the same stylus still writes.
  const onPage = { x: pageBox.x + pageBox.width * .3, y: (await firstPageBox(page)).y + 40 };
  const visible = await stage.boundingBox();
  const writeY = Math.max(onPage.y, visible.y + 60);
  await drawStroke(stage, 63, Array.from({ length: 10 }, (_, index) => ({ x: onPage.x + index * 6, y: writeY + Math.sin(index) * 20 })));
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
