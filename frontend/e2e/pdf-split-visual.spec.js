import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const SECOND_ROUTE = "/materials/catalog/biochemistry-1/sheets/vitamin-2/workspace";

async function expectTopAlignedPages(page, count, tolerance = 4) {
  const collect = async () => page.evaluate((expected) => {
    const panes = [...document.querySelectorAll(".workspace-pane[data-split-slot]")].slice(0, expected);
    return panes.map((pane) => {
      const stage = pane.querySelector(".workspace-v2-document-stage");
      const pdfPage = pane.querySelector(".workspace-v2-a4-page");
      const layer = pane.querySelector(".workspace-v2-a4-live-layer");
      if (!stage || !pdfPage) return null;
      return {
        offset: pdfPage.getBoundingClientRect().top - stage.getBoundingClientRect().top,
        scrollTop: stage.scrollTop,
        stageHeight: stage.clientHeight,
        layerTop: layer?.getBoundingClientRect().top - stage.getBoundingClientRect().top
      };
    });
  }, count);
  console.log("TOP_ALIGN_BEFORE_ASSERT", count, JSON.stringify(await collect()));
  await expect.poll(async () => {
    const data = await collect();
    if (data.length !== count || data.some((item) => !item)) return 999;
    return Math.max(...data.map((item) => item.offset)) - Math.min(...data.map((item) => item.offset));
  }, { timeout: 15000 }).toBeLessThanOrEqual(tolerance);
  console.log("TOP_ALIGNED_PAGES", count, JSON.stringify(await collect()));
}


async function openTwoSheets(page, width, height) {
  await withoutServiceWorker(page);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/e2e-fixtures/pdf/**", route => route.fulfill({ path: "e2e/fixtures/pdf/sheet-41.pdf", contentType: "application/pdf" }));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/auth/session") return route.fulfill({ json: { user: studentSession() } });
    if (path === "/api/v1/auth/csrf") return route.fulfill({ json: { csrf_token: "split-preview-csrf" } });
    if (path === "/api/v1/operations/session") return route.fulfill({ status: 403, json: { error: { code: "permission_denied", message: "Student account" } } });
    if (path === "/api/v1/focus/lock-in") return route.fulfill({ json: { active_session: null } });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Unused preview endpoint" } } });
  });
  await page.setViewportSize({ width, height });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-pane.is-active .workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 25000 });
  await page.evaluate(route => { location.hash = route; }, SECOND_ROUTE);
  await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Vitamin -2", { timeout: 25000 });
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await page.locator(".workspace-pane.is-active .workspace-tab [role=tab]").filter({ hasText: "Vitamin -1" }).click();
  await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Vitamin -1");
}

for (const viewport of [
  { width: 1180, height: 820, name: "ipad" },
  { width: 390, height: 844, name: "phone" },
]) {
  test(`PDF split visual on ${viewport.name}: open, drag and side-by-side view`, async ({ page }) => {
    test.setTimeout(120000);
    await mkdir("output/playwright", { recursive: true });
    await openTwoSheets(page, viewport.width, viewport.height);
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-before.png`, fullPage: false });

    const sourceTab = page.locator(".workspace-pane.is-active .workspace-tab").filter({ hasText: "Vitamin -2" }).locator("[role=tab]");
    await sourceTab.scrollIntoViewIfNeeded();
    const source = await sourceTab.boundingBox();
    const stage = await page.locator(".workspace-pane.is-active .workspace-v2-document-stage").boundingBox();
    expect(source).toBeTruthy();
    expect(stage).toBeTruthy();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 25, source.y + 45, { steps: 4 });
    await page.mouse.move(stage.x + stage.width * .78, stage.y + stage.height * .78, { steps: 14 });
    console.log("SPLIT_DRAG_GEOMETRY", viewport.name, JSON.stringify(await page.evaluate(() => {
      const keys = [".workspace-split-layout", ".workspace-pane.is-active", ".workspace-v2-document-stage", ".workspace-tab-drag-ghost", ".workspace-tab-drop-highlight"];
      return keys.map(selector => {
        const element = document.querySelector(selector);
        if (!element) return [selector, "missing"];
        const r = element.getBoundingClientRect(), style = getComputedStyle(element);
        return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, position: style.position, display: style.display, transform: style.transform, overflow: style.overflow }];
      });
    })));
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-drag-attempt.png`, fullPage: false });
    await expect(page.locator(".workspace-tab-drop-highlight.is-end")).toBeVisible({ timeout: 10000 });
    const purple = await page.locator(".workspace-tab-drop-highlight").boundingBox();
    const globalToolbar = await page.locator(".workspace-pane.is-active .workspace-v2-toolbar").boundingBox();
    expect(purple.y).toBeGreaterThanOrEqual(globalToolbar.y + globalToolbar.height - 1);
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-dragging.png`, fullPage: false });
    await page.mouse.up();

    await expect(page.locator(".workspace-split-layout.is-split")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".workspace-pane.is-secondary .workspace-split-pane-remove")).toHaveAttribute("aria-label", /Vitamin -2/);
    await expect(page.locator(".workspace-split-pane-heading")).toHaveCount(0);
    await expect(page.locator(".workspace-split-shared-chrome .workspace-v2-toolbar")).toHaveCount(1);
    await expect(page.locator(".workspace-pane .workspace-v2-toolbar")).toHaveCount(0);
    await expect(page.locator(".workspace-pane.is-secondary .workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 25000 });
    const firstBox = await page.locator(".workspace-pane.is-active").boundingBox();
    const secondBox = await page.locator(".workspace-pane.is-secondary").boundingBox();
    expect(firstBox.width).toBeGreaterThan(100);
    expect(firstBox.height).toBeGreaterThan(100);
    expect(secondBox.width).toBeGreaterThan(100);
    expect(secondBox.height).toBeGreaterThan(100);
    if (viewport.name === "phone") expect(secondBox.y).toBeGreaterThan(firstBox.y);
    else expect(secondBox.x).toBeGreaterThan(firstBox.x);
    await page.waitForTimeout(600);
    console.log("SPLIT_AFTER_GEOMETRY", viewport.name, JSON.stringify(await page.evaluate(() => {
      const keys = [".workspace-split-layout", ".workspace-pane.is-active", ".workspace-pane.is-secondary", ".workspace-pane.is-active .workspace-v2", ".workspace-pane.is-secondary .workspace-v2", ".workspace-split-divider"];
      return keys.map(selector => {
        const element = document.querySelector(selector);
        if (!element) return [selector, "missing"];
        const r = element.getBoundingClientRect(), style = getComputedStyle(element);
        return [selector, { x:r.x, y:r.y, width:r.width, height:r.height, position:style.position, display:style.display, transform:style.transform, zIndex:style.zIndex }];
      });
    })));
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-before-align-assert.png`, fullPage: false });
    await expectTopAlignedPages(page, 2);
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-after.png`, fullPage: false });
    const seam = page.locator('.workspace-split-divider[data-axis="primary"]');
    // The old ratio popover is intentionally removed; resize in 5% steps.
    const axisIsRows = (await seam.getAttribute("aria-orientation")) === "horizontal";
    const rtlColumns = await page.locator(".workspace-split-layout").evaluate((node) => getComputedStyle(node).direction === "rtl");
    const growKey = axisIsRows ? "ArrowDown" : (rtlColumns ? "ArrowLeft" : "ArrowRight");
    for (let i = 0; i < 4; i += 1) await seam.press(growKey);
    await expect(seam).toHaveAttribute("aria-valuenow", "70");
    const bigger = await page.locator('.workspace-pane[data-split-slot="0"]').boundingBox();
    const smaller = await page.locator('.workspace-pane[data-split-slot="1"]').boundingBox();
    const amount = viewport.name === "phone"
      ? bigger.height / (bigger.height + smaller.height)
      : bigger.width / (bigger.width + smaller.width);
    expect(amount).toBeGreaterThan(.65);
    expect(amount).toBeLessThan(.75);
    await page.screenshot({ path: `output/playwright/pdf-split-${viewport.name}-70-30.png`, fullPage: false });
  });
}


test("one original shared toolbar controls two, three and four PDF cells", async ({ page }) => {
  test.setTimeout(120000);
  await mkdir("output/playwright", { recursive: true });
  await openTwoSheets(page, 1180, 820);
  for (const [slug, title] of [["vitamin-3", "Vitamin -3"], ["range-probe", "Range probe"]]) {
    await page.evaluate((value) => { location.hash = "/materials/catalog/biochemistry-1/sheets/" + value + "/workspace"; }, slug);
    await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText(title);
    await page.getByRole("button", { name: /Normal Study/ }).click();
  }
  await page.locator(".workspace-pane.is-active .workspace-tab [role=tab]").filter({ hasText: "Vitamin -1" }).click();
  await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Vitamin -1");

  const addByDragging = async (name) => {
    const barReady = (await page.locator(".workspace-split-shared-chrome .workspace-tab [role=tab]").count()) > 0;
    const source = (barReady ? page.locator(".workspace-split-shared-chrome") : page.locator(".workspace-pane.is-active"))
      .locator(".workspace-tab [role=tab]").filter({ hasText: name });
    await source.scrollIntoViewIfNeeded();
    const a = await source.boundingBox();
    const stage = await page.locator(".workspace-pane.is-active .workspace-v2-document-stage").boundingBox();
    expect(a).toBeTruthy();
    expect(stage).toBeTruthy();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 22, a.y + 42, { steps: 4 });
    await page.mouse.move(stage.x + stage.width * .77, stage.y + stage.height * .67, { steps: 13 });
    await page.mouse.up();
  };

  for (const [n, name, suffix] of [[2, "Vitamin -2", "two"], [3, "Vitamin -3", "three"], [4, "Range probe", "four"]]) {
    await addByDragging(name);
    const layout = page.locator(".workspace-split-layout.is-split");
    await expect(layout).toHaveAttribute("data-pane-count", String(n));
    await expect(page.locator(".workspace-pane[data-split-slot]")).toHaveCount(n);
    await expect(page.locator(".workspace-split-shared-chrome .workspace-v2-toolbar")).toHaveCount(1);
    await expect(page.locator(".workspace-pane .workspace-v2-toolbar")).toHaveCount(0);
    for (let i = 0; i < n; i++) {
      const pane = page.locator(`.workspace-pane[data-split-slot="${i}"]`);
      const canvas = pane.locator(".workspace-v2-a4-canvas.is-visible").first();
      await expect(canvas).toBeVisible({ timeout: 20000 });
      await expect.poll(() => canvas.evaluate((node) => node.width * node.height), { timeout: 20000 }).toBeGreaterThan(1000);
      const box = await pane.boundingBox();
      expect(box.width).toBeGreaterThan(130);
      expect(box.height).toBeGreaterThan(130);
    }
    if (n >= 3) {
      const primary = layout.locator('.workspace-split-divider[data-axis="primary"]');
      const secondary = layout.locator('.workspace-split-divider[data-axis="secondary"]');
      await expect(primary).toBeVisible();
      await expect(secondary).toBeVisible();
      const rtlColumns = await layout.evaluate((node) => getComputedStyle(node).direction === "rtl");
      // Resizing persists as extra panes open; move only the remaining 5% steps.
      const primarySteps = Math.max(0, (70 - Number(await primary.getAttribute("aria-valuenow"))) / 5);
      const secondarySteps = Math.max(0, (60 - Number(await secondary.getAttribute("aria-valuenow"))) / 5);
      for (let i = 0; i < primarySteps; i += 1) await primary.press(rtlColumns ? "ArrowLeft" : "ArrowRight");
      for (let i = 0; i < secondarySteps; i += 1) await secondary.press("ArrowDown");
      await expect(primary).toHaveAttribute("aria-valuenow", "70");
      await expect(secondary).toHaveAttribute("aria-valuenow", "60");
    }
    await expectTopAlignedPages(page, n);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `output/playwright/pdf-grid-ipad-${suffix}.png`, fullPage: false });
  }
  const first = await page.locator('.workspace-pane[data-split-slot="0"]').boundingBox();
  const rightTop = await page.locator('.workspace-pane[data-split-slot="1"]').boundingBox();
  const rightBottom = await page.locator('.workspace-pane[data-split-slot="2"]').boundingBox();
  const leftBottom = await page.locator('.workspace-pane[data-split-slot="3"]').boundingBox();
  expect(first.x).toBeLessThan(rightTop.x);
  expect(rightBottom.y).toBeGreaterThan(rightTop.y);
  expect(leftBottom.y).toBeGreaterThan(first.y);
  await page.locator('.workspace-pane[data-split-slot="2"] .workspace-v2-document-stage').click({ position: { x: 22, y: 70 }, force: true });
  await expect(page.locator('.workspace-pane[data-split-slot="2"]')).toHaveAttribute("data-focused", "true");
  await expect(page.locator(".workspace-split-shared-chrome .workspace-v2-toolbar")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: /Sheet for Active Study/ })).toBeVisible();
  const studySheet = page.getByRole("combobox", { name: /Sheet for Active Study/ });
  await expect(studySheet).toHaveValue(/vitamin-3/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workspace-pane[data-split-slot]")).toHaveCount(4);
  await page.screenshot({ path: "output/playwright/pdf-grid-phone-four.png", fullPage: false });

  // Remove the original URL-owning pane while another pane is selected:
  // promote the focused one, never collapse the other three sheets.
  await page.locator('.workspace-pane[data-split-slot="0"] .workspace-split-pane-remove').click();
  await expect(page.locator('.workspace-split-layout')).toHaveAttribute("data-pane-count", "3");
  await expect(page).toHaveURL(/\/sheets\/vitamin-3\/workspace$/);
  await expect(page.locator(".workspace-pane[data-split-slot]")).toHaveCount(3);
  await expect(page.locator(".workspace-split-shared-chrome .workspace-v2-toolbar")).toHaveCount(1);
  await page.screenshot({ path: "output/playwright/pdf-grid-phone-three-after-removal.png", fullPage: false });
  await page.locator('.workspace-pane[data-split-slot="0"] .workspace-split-pane-remove').click();
  await expect(page.locator('.workspace-split-layout')).toHaveAttribute("data-pane-count", "2");
  await expect(page.locator(".workspace-pane[data-split-slot]")).toHaveCount(2);
  await page.locator('.workspace-pane[data-split-slot="0"] .workspace-split-pane-remove').click();
  await expect(page.locator(".workspace-split-layout.is-split")).toHaveCount(0);
  await expect(page).toHaveURL(/\/sheets\/range-probe\/workspace$/);
  await expect(page.locator(".workspace-pane.is-active .workspace-v3-document-context strong")).toHaveText("Range probe");
});
