import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

async function mockAuthenticatedWorkspace(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "controls-student", email: "controls@example.test", full_name: "Controls Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    // The workspace sits behind the subscription gate, so the access contract
    // has to answer before the reader renders.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by control tests" } }) });
  });
}

async function openWorkspace(page, viewport = { width: 1280, height: 900 }) {
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

/** The lasso adds an invisible hit target per pen stroke; only count the painted ink. */
function visibleInk(page) {
  return page.locator(".workspace-v2-annotation-layer [data-annotation-type='pen']:not(.workspace-v2-annotation-hit)");
}

async function drawStroke(stage, pointerId, points) {
  await dispatchPointer(stage, "pointerdown", pointerId, points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) await dispatchPointer(stage, "pointermove", pointerId, points[index].x, points[index].y);
  await dispatchPointer(stage, "pointerup", pointerId, points.at(-1).x, points.at(-1).y);
}

test("browser and OS shortcuts never hijack the tool palette", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const shapes = page.locator('[data-workspace-tool="shapes"]');
  const pen = page.locator('[data-workspace-tool="pen"]');

  for (const combination of ["Control+s", "Control+p", "Control+e", "Control+l", "Alt+s"]) {
    await page.keyboard.press(combination);
  }
  await expect(shapes).toHaveAttribute("aria-pressed", "false");
  await expect(pen).toHaveAttribute("aria-pressed", "false");

  // Unmodified letters remain the fast tool switches.
  await page.keyboard.press("p");
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("s");
  await expect(shapes).toHaveAttribute("aria-pressed", "true");
});

test("Space activates the focused toolbar button and still pans elsewhere", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const highlighter = page.locator('[data-workspace-tool="highlighter"]');
  await highlighter.focus();
  await page.keyboard.press("Space");
  await expect(highlighter).toHaveAttribute("aria-pressed", "true");

  // With focus off any control, Space is the hold-to-pan modifier again.
  await page.locator(".workspace-v2-document-stage").evaluate((node) => node.focus?.());
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.down("Space");
  await expect(page.locator('[data-workspace-tool="hand"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("Space");
  await expect(highlighter).toHaveAttribute("aria-pressed", "true");
});

test("page keys move the reader instead of only relabelling the indicator", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const indicator = page.locator(".workspace-v2-page-number");
  await expect(indicator).toHaveAttribute("aria-label", "Page 1 of 16");
  const startScrollTop = await stage.evaluate((node) => node.scrollTop);

  await page.keyboard.press("ArrowRight");
  await expect(indicator).toHaveAttribute("aria-label", "Page 2 of 16");
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBeGreaterThan(startScrollTop + 100);

  await page.keyboard.press("ArrowLeft");
  await expect(indicator).toHaveAttribute("aria-label", "Page 1 of 16");
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBeLessThan(startScrollTop + 100);

  await page.keyboard.press("End");
  await expect(indicator).toHaveAttribute("aria-label", "Page 16 of 16");
  await page.keyboard.press("Home");
  await expect(indicator).toHaveAttribute("aria-label", "Page 1 of 16");
});

test("the page dock jumps to a typed page and steps the zoom", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const readerScale = () => page.locator(".workspace-v2-a4-document").evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--workspace-a4-zoom")));

  await page.locator(".workspace-v2-page-number").click();
  const navigator = page.locator(".workspace-v2-page-navigator");
  await expect(navigator).toBeVisible();

  const startScrollTop = await stage.evaluate((node) => node.scrollTop);
  await navigator.locator("input[type='number']").fill("7");
  await navigator.locator("input[type='number']").press("Enter");
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", "Page 7 of 16");
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBeGreaterThan(startScrollTop + 500);

  const startScale = await readerScale();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(readerScale).toBeGreaterThan(startScale + .1);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(readerScale).toBeLessThan(startScale + .1);
  await page.getByRole("button", { name: "Fit width", exact: true }).click();
  await expect.poll(readerScale).toBeCloseTo(startScale, 1);
});

test("a horizontal trackpad gesture pans a zoomed page", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page);
  const stage = page.locator(".workspace-v2-document-stage");
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // At fit width there is nothing to pan sideways, so the same gesture is inert.
  const fittedScrollLeft = await stage.evaluate((node) => node.scrollLeft);
  await page.mouse.wheel(240, 0);
  await page.waitForTimeout(120);
  expect(await stage.evaluate((node) => node.scrollLeft)).toBe(fittedScrollLeft);

  await page.keyboard.down("Control");
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect.poll(async () => stage.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeGreaterThan(50);

  const before = await stage.evaluate((node) => node.scrollLeft);
  await page.mouse.wheel(220, 0);
  await expect.poll(async () => stage.evaluate((node) => node.scrollLeft)).toBeGreaterThan(before + 50);

  const afterRight = await stage.evaluate((node) => node.scrollLeft);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, -220);
  await page.keyboard.up("Shift");
  await expect.poll(async () => stage.evaluate((node) => node.scrollLeft)).toBeLessThan(afterRight - 50);
});

test("controls drawn over the document keep their touch activation", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  const stage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();

  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(stage, 21, [
    { x: pageBounds.x + pageBounds.width * .3, y: pageBounds.y + pageBounds.height * .3 },
    { x: pageBounds.x + pageBounds.width * .5, y: pageBounds.y + pageBounds.height * .32 },
    { x: pageBounds.x + pageBounds.width * .66, y: pageBounds.y + pageBounds.height * .3 }
  ]);
  await expect(page.locator(".workspace-v2-annotation-layer [data-annotation-id]")).toHaveCount(1);

  await page.getByRole("button", { name: "Lasso", exact: true }).click();
  await drawStroke(stage, 22, [
    { x: pageBounds.x + pageBounds.width * .22, y: pageBounds.y + pageBounds.height * .24 },
    { x: pageBounds.x + pageBounds.width * .76, y: pageBounds.y + pageBounds.height * .24 },
    { x: pageBounds.x + pageBounds.width * .76, y: pageBounds.y + pageBounds.height * .4 },
    { x: pageBounds.x + pageBounds.width * .22, y: pageBounds.y + pageBounds.height * .4 },
    { x: pageBounds.x + pageBounds.width * .22, y: pageBounds.y + pageBounds.height * .25 }
  ]);
  const menu = page.locator(".workspace-v2-selection-menu");
  await expect(menu).toBeVisible();

  // A tap on the document itself must still be swallowed by the custom gesture
  // pipeline, while a tap on a control keeps its compatibility click.
  const prevention = await page.evaluate(() => {
    const dispatch = (element) => {
      const event = new TouchEvent("touchstart", { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      onDocument: dispatch(document.querySelector(".workspace-v2-a4-page")),
      onControl: dispatch(document.querySelector(".workspace-v2-selection-menu button"))
    };
  });
  expect(prevention).toEqual({ onDocument: true, onControl: false });

  await menu.getByRole("button", { name: "Duplicate" }).click();
  await expect(visibleInk(page)).toHaveCount(2);
});

test("the lasso recolours a selection and the settings panel clears one page", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 900 });
  const stage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const marks = visibleInk(page);

  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(stage, 31, [
    { x: pageBounds.x + pageBounds.width * .3, y: pageBounds.y + pageBounds.height * .3 },
    { x: pageBounds.x + pageBounds.width * .55, y: pageBounds.y + pageBounds.height * .32 },
    { x: pageBounds.x + pageBounds.width * .68, y: pageBounds.y + pageBounds.height * .3 }
  ]);
  await expect(marks).toHaveCount(1);

  await page.getByRole("button", { name: "Lasso", exact: true }).click();
  await drawStroke(stage, 32, [
    { x: pageBounds.x + pageBounds.width * .22, y: pageBounds.y + pageBounds.height * .24 },
    { x: pageBounds.x + pageBounds.width * .78, y: pageBounds.y + pageBounds.height * .24 },
    { x: pageBounds.x + pageBounds.width * .78, y: pageBounds.y + pageBounds.height * .4 },
    { x: pageBounds.x + pageBounds.width * .22, y: pageBounds.y + pageBounds.height * .4 },
    { x: pageBounds.x + pageBounds.width * .22, y: pageBounds.y + pageBounds.height * .25 }
  ]);
  await expect(page.locator(".workspace-v2-selection-menu")).toBeVisible();

  await page.locator('[data-workspace-tool="select"]').click();
  await page.getByRole("button", { name: "Use #20b982" }).click();
  await expect(marks.first()).toHaveAttribute("fill", "#20b982");

  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(marks.first()).not.toHaveAttribute("fill", "#20b982");

  await page.getByRole("button", { name: "Workspace settings" }).click();
  await page.getByRole("button", { name: /Clear ink on page/ }).click();
  await expect(marks).toHaveCount(0);
  await page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
  await expect(marks).toHaveCount(1);
});

test("pinching past a zoom limit rubber-bands and settles back to a legal scale", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  const document = page.locator(".workspace-v2-a4-document");
  const layer = page.locator(".workspace-v2-a4-live-layer");
  const stage = page.locator(".workspace-v2-document-stage");
  const box = await stage.boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const readerScale = () => document.evaluate((node) => Number(getComputedStyle(node).getPropertyValue("--workspace-a4-zoom")));
  const minimumScale = await readerScale();

  const touch = (type, pointerId, x, y) => stage.dispatchEvent(type, {
    pointerId, pointerType: "touch", isPrimary: pointerId === 11, clientX: x, clientY: y,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : .5,
    width: 9, height: 9, bubbles: true, cancelable: true
  });

  // Pinch far past the minimum: the compositor must follow the fingers.
  await touch("pointerdown", 11, center.x - 260, center.y);
  await touch("pointerdown", 12, center.x + 260, center.y);
  await touch("pointermove", 11, center.x - 30, center.y);
  await touch("pointermove", 12, center.x + 30, center.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const liveScale = await layer.evaluate((node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return matrix.a;
  });
  expect(liveScale).toBeLessThan(.97);
  expect(liveScale).toBeGreaterThan(1 / 1.25);

  await touch("pointerup", 11, center.x - 30, center.y);
  await touch("pointerup", 12, center.x + 30, center.y);
  await expect(layer).not.toHaveClass(/is-live-pinching|is-zoom-settling|is-springing-back/);
  // Only the legal scale is ever committed.
  expect(await readerScale()).toBeCloseTo(minimumScale, 3);
  expect(await layer.evaluate((node) => getComputedStyle(node).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
});

test("the live ink layer paints while the stroke is still down and carries its opacity", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 900 });
  const stage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const inkPixels = () => page.locator(".workspace-v2-live-annotation-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 8) painted += 1;
    return { painted, opacity: canvas.style.opacity, blend: canvas.style.mixBlendMode };
  });

  // Draw-and-hold would straighten these strokes into vector shapes and clear
  // the live layer, which is a different feature from the one under test.
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await page.getByRole("switch", { name: /Hold to shape/ }).click();
  await page.getByRole("button", { name: "Close workspace settings" }).click();

  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const y = pageBounds.y + pageBounds.height * .35;
  await dispatchPointer(stage, "pointerdown", 51, pageBounds.x + pageBounds.width * .2, y);
  for (let step = 1; step <= 10; step += 1) {
    await dispatchPointer(stage, "pointermove", 51, pageBounds.x + pageBounds.width * (.2 + step * .02), y + step * 3);
  }
  await expect.poll(async () => (await inkPixels()).painted, { message: "the in-progress stroke is visible before release" }).toBeGreaterThan(0);
  const early = await inkPixels();

  for (let step = 11; step <= 30; step += 1) {
    await dispatchPointer(stage, "pointermove", 51, pageBounds.x + pageBounds.width * (.2 + step * .02), y + step * 3);
  }
  // Appending geometry must extend the same painted stroke, never restart it.
  await expect.poll(async () => (await inkPixels()).painted).toBeGreaterThan(early.painted);
  const later = await inkPixels();
  expect(later.opacity).toBe("1");
  expect(later.blend).toBe("normal");
  await dispatchPointer(stage, "pointerup", 51, pageBounds.x + pageBounds.width * .8, y + 90);
  await expect(visibleInk(page)).toHaveCount(1);

  // The highlighter paints opaquely and carries its own opacity on the element,
  // so overlapping appended geometry cannot stack into a darker band.
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  const highlightY = pageBounds.y + pageBounds.height * .55;
  await dispatchPointer(stage, "pointerdown", 52, pageBounds.x + pageBounds.width * .2, highlightY);
  for (let step = 1; step <= 14; step += 1) {
    await dispatchPointer(stage, "pointermove", 52, pageBounds.x + pageBounds.width * (.2 + step * .03), highlightY);
  }
  await expect.poll(async () => (await inkPixels()).painted).toBeGreaterThan(0);
  const highlight = await inkPixels();
  expect(highlight.blend).toBe("multiply");
  expect(Number(highlight.opacity)).toBeGreaterThan(0);
  expect(Number(highlight.opacity)).toBeLessThan(1);
  await dispatchPointer(stage, "pointerup", 52, pageBounds.x + pageBounds.width * .62, highlightY);
  await expect(page.locator(".workspace-v2-annotation-layer [data-annotation-type='highlighter']")).toHaveCount(1);
});
