import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

async function openSyntheticReader(page, slug) {
  await withoutServiceWorker(page);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/auth/session") return route.fulfill({ json: { user: studentSession() } });
    if (path === "/api/v1/focus/lock-in") return route.fulfill({ json: { active_session: null } });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Unused geometry fixture endpoint" } } });
  });
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(`/#/materials/catalog/biochemistry-1/sheets/${slug}/workspace`);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await painted(page, 1);
}
async function painted(page, number) {
  await expect.poll(() => page.locator(`[data-pdf-page="${number}"] .workspace-v2-a4-canvas.is-visible`).evaluate((canvas) => canvas.width > 0 && canvas.height > 0), { timeout: 25000 }).toBe(true);
}
async function geometry(page) {
  return page.locator(".workspace-pane.is-active [data-pdf-page]").evaluateAll((pages) => {
    const bounds = pages.map((node) => node.getBoundingClientRect());
    const scale = bounds[0].width / 595;
    return bounds.map((box) => ({ ratio: box.height / box.width, top: (box.top - bounds[0].top) / scale }));
  });
}

test("mixed and rotated pages keep exact offsets through last-page jumps, painting and tablet rotation", async ({ page }) => {
  test.setTimeout(90000);
  await openSyntheticReader(page, "mixed-probe");
  const before = await geometry(page);
  expect(before).toHaveLength(64);
  const ratios = [1100 / 595, 595 / 842, 595 / 842, 595 / 420, 700 / 1200];
  let expectedTop = 0;
  for (let index = 0; index < before.length; index++) {
    expect(before[index].ratio).toBeCloseTo(ratios[index % 5], 3);
    expect(Math.abs(before[index].top - expectedTop)).toBeLessThan(.5);
    expectedTop += 595 * ratios[index % 5] + 14;
  }
  await page.getByRole("button", { name: "PDF page 1 of 64", exact: true }).click();
  const jump = page.locator(".workspace-pane.is-active .workspace-v2-page-input input");
  for (const number of [64, 31, 1]) {
    await jump.fill(String(number));
    await jump.press("Enter");
    await painted(page, number);
    await expect(jump).toHaveValue(String(number));
    const after = await geometry(page);
    after.forEach((box, index) => expect(Math.abs(box.top - before[index].top)).toBeLessThan(.5));
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect.poll(async () => (await geometry(page)).map((box) => Math.round(box.top))).toEqual(before.map((box) => Math.round(box.top)));
});

test("image-heavy synthetic PDF paints real scan pixels inside the page", async ({ page }) => {
  test.setTimeout(90000);
  await openSyntheticReader(page, "scanned-probe");
  const shades = await page.locator('[data-pdf-page="1"] .workspace-v2-a4-canvas.is-visible').evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    return [.4, .9].map((y) => ctx.getImageData(Math.floor(canvas.width * .5), Math.floor(canvas.height * y), 1, 1).data[0]);
  });
  expect(shades[0]).toBeLessThan(150);
  expect(shades[1]).toBeGreaterThan(200);
});
