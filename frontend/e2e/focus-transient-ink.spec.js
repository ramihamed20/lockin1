import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";

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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by transient ink tests" } }) });
  });
}

async function dispatchPointer(stage, type, x, y) {
  await stage.dispatchEvent(type, {
    pointerId: 71, pointerType: "pen", isPrimary: true, clientX: x, clientY: y, button: 0,
    buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5, width: 2, height: 2, bubbles: true, cancelable: true
  });
}

/**
 * Painted pixels on the transient canvas, and whether they read as red.
 * `from`/`to` limit the count to a band of client x coordinates.
 */
function transientInk(page, { from = -Infinity, to = Infinity } = {}) {
  return page.locator("canvas.workspace-v2-transient-ink-canvas").first().evaluate((canvas, band) => {
    if (!canvas.width || !canvas.height) return { painted: 0, red: false };
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const left = Math.max(0, Math.floor((band.from - rect.left) * scale));
    const right = Math.min(canvas.width, Math.ceil((band.to - rect.left) * scale));
    if (right <= left) return { painted: 0, red: false };
    const { data } = canvas.getContext("2d").getImageData(left, 0, right - left, canvas.height);
    let painted = 0;
    let red = 0;
    let blue = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 24) continue;
      painted += 1;
      red += data[index];
      blue += data[index + 2];
    }
    return { painted, red: red > blue * 1.5 };
  }, { from: Number.isFinite(from) ? from : -1e9, to: Number.isFinite(to) ? to : 1e9 });
}

function savedAnnotations(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("lock-in.catalog-workspace.v1.user_ink-student."));
    return key ? JSON.parse(localStorage.getItem(key))?.annotations ?? [] : [];
  });
}

async function choosePen(page, name) {
  const pen = page.locator('[data-workspace-tool="pen"]').first();
  await pen.click();
  const options = page.locator("#workspace-pen-options");
  if (!await options.isVisible()) await pen.click();
  await options.getByRole("button", { name }).click();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
}

test("Neon and Pointer glow while drawing, stay three seconds after the lift, then clear; neither is saved", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const x = bounds.x + bounds.width * .2;
  const y = bounds.y + Math.min(bounds.height, 700) * .4;

  // Neon: holds for the whole gesture, glows in its default red, stays three
  // seconds after the lift, then clears.
  await choosePen(page, /Neon Pen/);
  await dispatchPointer(stage, "pointerdown", x, y);
  for (let step = 1; step <= 12; step += 1) await dispatchPointer(stage, "pointermove", x + step * 18, y + (step % 2) * 10);
  await page.waitForTimeout(600);
  const held = await transientInk(page);
  expect(held.painted).toBeGreaterThan(200);
  expect(held.red).toBe(true);
  await dispatchPointer(stage, "pointerup", x + 216, y);
  await page.waitForTimeout(1_500);
  expect((await transientInk(page)).painted).toBeGreaterThan(200);
  await expect.poll(async () => (await transientInk(page)).painted, { timeout: 6_000 }).toBe(0);

  // Pointer: the same hold and fade as Neon.
  await choosePen(page, /Pointer Pen/);
  await dispatchPointer(stage, "pointerdown", x, y + 80);
  for (let step = 1; step <= 12; step += 1) await dispatchPointer(stage, "pointermove", x + step * 18, y + 80);
  // Painting happens on the next animation frame, not in the pointer event.
  await expect.poll(async () => (await transientInk(page)).painted, { intervals: [16, 32, 50] }).toBeGreaterThan(200);
  await dispatchPointer(stage, "pointerup", x + 216, y + 80);
  await page.waitForTimeout(1_500);
  expect((await transientInk(page)).painted).toBeGreaterThan(200);
  await expect.poll(async () => (await transientInk(page)).painted, { timeout: 6_000 }).toBe(0);

  // Nothing reached the sheet, the history or the saved workspace.
  await page.waitForTimeout(1_200);
  expect(await savedAnnotations(page)).toEqual([]);
  await expect(page.getByRole("button", { name: /Undo/ }).first()).toBeDisabled();
  await expect(page.locator(".workspace-v2-annotation-layer path")).toHaveCount(0);
});
