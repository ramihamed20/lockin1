import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { WORKSPACE_GESTURE } from "../src/workspace/config.js";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

test("normal PDF zoom fills the stage width without side strips @chromium-only", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 834, height: 1194 }, { width: 1194, height: 834 }]) {
    await openWorkspace(page, viewport);
    const geometry = await page.evaluate(() => {
      const bounds = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      return {
        workspace: bounds(".workspace-v2"),
        reader: bounds(".workspace-v2-reader"),
        stage: bounds(".workspace-v2-document-stage"),
        surface: bounds(".workspace-v2-a4-zoom-surface"),
        pdf: bounds(".workspace-v2-a4-live-layer"),
        zoom: Number(getComputedStyle(document.querySelector(".workspace-v2-a4-document")).getPropertyValue("--workspace-a4-zoom"))
      };
    });
    expect(Math.abs(geometry.pdf.left - geometry.stage.left)).toBeLessThan(1.5);
    expect(Math.abs(geometry.stage.right - geometry.pdf.right)).toBeLessThan(1.5);
    expect(Math.abs(geometry.pdf.width - geometry.stage.width)).toBeLessThan(1.5);
    expect(Math.abs(geometry.pdf.left - geometry.workspace.left)).toBeLessThan(1.5);
    expect(Math.abs(geometry.workspace.right - geometry.pdf.right)).toBeLessThan(1.5);
  }
});

async function mockAuthenticatedWorkspace(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "pinch-student", email: "pinch@example.test", full_name: "Pinch Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by pinch tests" } }) });
  });
}

async function openWorkspace(page, viewport) {
  await page.setViewportSize(viewport);
  // A fresh navigation rather than reload(): reloading a service-worker
  // controlled page truncates mocked API responses on WebKit.
  if (page.url().includes(ROUTE.slice(1))) await page.goto("about:blank");
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => page.locator(".workspace-v2-a4-canvas.is-visible").first().evaluate((canvas) => canvas.width > 0 && canvas.height > 0)).toBe(true);
}

async function dispatchPointer(stage, type, pointerId, x, y, pointerType = "touch", size = 9) {
  await stage.dispatchEvent(type, {
    pointerId,
    pointerType,
    isPrimary: pointerId === 11,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    pressure: type === "pointerup" ? 0 : 0.5,
    width: size,
    height: size,
    bubbles: true,
    cancelable: true
  });
}

async function dispatchTouch(stage, type, pointerId, x, y) {
  await dispatchPointer(stage, type, pointerId, x, y, "touch", 9);
}

async function drawPointerPath(stage, pointerId, points, pointerType = "pen") {
  await dispatchPointer(stage, "pointerdown", pointerId, points[0].x, points[0].y, pointerType, pointerType === "pen" ? 2 : 9);
  for (let index = 1; index < points.length; index += 1) {
    await dispatchPointer(stage, "pointermove", pointerId, points[index].x, points[index].y, pointerType, pointerType === "pen" ? 2 : 9);
  }
  await dispatchPointer(stage, "pointerup", pointerId, points.at(-1).x, points.at(-1).y, pointerType, pointerType === "pen" ? 2 : 9);
}

async function readerScale(page) {
  return page.locator(".workspace-v2-a4-document").evaluate((documentNode) => Number(getComputedStyle(documentNode).getPropertyValue("--workspace-a4-zoom")));
}

async function documentPoint(page, xRatio, yRatio) {
  return page.locator(".workspace-v2-a4-document").evaluate((documentNode, ratios) => {
    const bounds = documentNode.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width * ratios.x,
      y: bounds.top + bounds.height * ratios.y,
      width: bounds.width,
      height: bounds.height
    };
  }, { x: xRatio, y: yRatio });
}

async function anchoredClientPoint(page, anchor) {
  return page.locator(".workspace-v2-a4-document").evaluate((documentNode, fixedAnchor) => {
    const bounds = documentNode.getBoundingClientRect();
    const visualScale = bounds.width / fixedAnchor.intrinsicWidth;
    return {
      x: bounds.left + fixedAnchor.x * visualScale,
      y: bounds.top + fixedAnchor.y * visualScale
    };
  }, anchor);
}

async function expectHorizontalFocalOrPhysicalEdge(page, actualX, targetX, live = false) {
  if (Math.abs(actualX - targetX) < 1.25) return;
  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return {
      leftEdge: Math.abs(pdf.left - viewport.left),
      rightEdge: Math.abs(viewport.right - pdf.right),
      centerError: Math.abs((pdf.left + pdf.right) / 2 - (viewport.left + viewport.right) / 2),
      fits: pdf.width <= viewport.width + 0.5
    };
  });
  const tolerance = live ? 29 : 1.5;
  if (geometry.fits) expect(geometry.centerError).toBeLessThan(tolerance);
  else expect(Math.min(geometry.leftEdge, geometry.rightEdge)).toBeLessThan(tolerance);
}

/**
 * The workspace guarantees focal-exact vertical tracking only while zooming in.
 * Zooming out, `renderLivePinchTransform` deliberately constrains Y against the
 * document edges -- "Y remains focal-exact while zooming in and is constrained
 * only while zooming out or two-finger panning" -- so a gesture that reaches an
 * edge legitimately lands away from its focal point, by the clamped overflow
 * less whatever the rubber band gives back.
 *
 * What must still hold there is the constraint itself: the document never pulls
 * away from an edge far enough to open empty space beyond the reveal allowance,
 * plus the elastic limit while the gesture is still live. This mirrors
 * expectHorizontalFocalOrPhysicalEdge, which already concedes exactly this for
 * X. Both allowances come from WORKSPACE_GESTURE rather than being restated
 * here, so the test cannot drift away from the contract it is checking.
 */
async function expectVerticalFocalOrConstrainedEdge(page, actualY, targetY, live = false) {
  if (Math.abs(actualY - targetY) < (live ? 1.5 : 1.25)) return;
  const geometry = await page.evaluate(() => {
    // constrainPinchTranslation measures the stage's client box against the
    // live layer, so assert against those same two boxes.
    const stage = document.querySelector(".workspace-v2-document-stage");
    const viewportTop = stage.getBoundingClientRect().top;
    const viewportHeight = stage.clientHeight;
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return {
      topGap: pdf.top - viewportTop,
      bottomGap: viewportTop + viewportHeight - pdf.bottom,
      centerError: Math.abs((pdf.top + pdf.bottom) / 2 - (viewportTop + viewportHeight / 2)),
      fits: pdf.height <= viewportHeight + 0.5
    };
  });
  const slack = WORKSPACE_GESTURE.verticalEdgeReveal + (live ? WORKSPACE_GESTURE.pinchElasticLimit : 0);
  // visibleContentStartBounds pins a document shorter than the stage to the
  // centre and lets a taller one rest against either edge. Either way the empty
  // margin a gesture may open is bounded. A negative gap is content correctly
  // overflowing the stage, which is not what this guards against.
  if (geometry.fits) {
    expect(geometry.centerError).toBeLessThanOrEqual(slack);
    return;
  }
  expect(geometry.topGap).toBeLessThanOrEqual(slack);
  expect(geometry.bottomGap).toBeLessThanOrEqual(slack);
}

/**
 * A focal-point assertion is only meaningful once the document has stopped
 * resizing: pages adopt their real aspect ratio as they render, which changes
 * the document height under the gesture.
 */
async function waitForStableDocumentGeometry(page) {
  await expect.poll(async () => page.evaluate(async () => {
    const measure = () => document.querySelector(".workspace-v2-a4-document").getBoundingClientRect().height;
    const first = measure();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.abs(measure() - first) < 0.5;
  }), { timeout: 20_000 }).toBe(true);
}

async function exactPinch(page, { xRatio, yRatio, targetScale, moveX = 0, moveY = 0 }) {
  const stage = page.locator(".workspace-v2-document-stage");
  const initialScale = await readerScale(page);
  const initialPoint = await documentPoint(page, xRatio, yRatio);
  const documentBounds = await page.locator(".workspace-v2-a4-document").boundingBox();
  const anchor = {
    x: (initialPoint.x - documentBounds.x) / initialScale,
    y: (initialPoint.y - documentBounds.y) / initialScale,
    intrinsicWidth: documentBounds.width / initialScale
  };
  const initialHalfSpan = 34;
  const targetHalfSpan = initialHalfSpan * (targetScale / initialScale);
  const targetFocal = { x: initialPoint.x + moveX, y: initialPoint.y + moveY };

  await dispatchTouch(stage, "pointerdown", 11, initialPoint.x - initialHalfSpan, initialPoint.y);
  await dispatchTouch(stage, "pointerdown", 12, initialPoint.x + initialHalfSpan, initialPoint.y);
  await dispatchTouch(stage, "pointermove", 11, targetFocal.x - targetHalfSpan, targetFocal.y);
  await dispatchTouch(stage, "pointermove", 12, targetFocal.x + targetHalfSpan, targetFocal.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const livePoint = await anchoredClientPoint(page, anchor);
  await expectHorizontalFocalOrPhysicalEdge(page, livePoint.x, targetFocal.x, true);
  // The production branch turns on this exact comparison: zooming in keeps Y
  // focal-exact, zooming out hands Y to the edge constraint.
  if (targetScale > initialScale) expect(Math.abs(livePoint.y - targetFocal.y)).toBeLessThan(1.5);
  else await expectVerticalFocalOrConstrainedEdge(page, livePoint.y, targetFocal.y, true);

  await dispatchTouch(stage, "pointerup", 11, targetFocal.x - targetHalfSpan, targetFocal.y);
  await dispatchTouch(stage, "pointerup", 12, targetFocal.x + targetHalfSpan, targetFocal.y);
  await expect(page.locator(".workspace-v2-a4-live-layer")).not.toHaveClass(/is-live-pinching|is-zoom-settling|is-springing-back/);

  const committedScale = await readerScale(page);
  expect(Math.abs(committedScale - targetScale)).toBeLessThan(1e-6);
  const committedPoint = await anchoredClientPoint(page, anchor);
  await expectHorizontalFocalOrPhysicalEdge(page, committedPoint.x, targetFocal.x);
  // The spring has released by now, so a constrained gesture must have settled
  // onto the legal bound itself rather than anywhere inside the elastic band.
  if (targetScale > initialScale) expect(Math.abs(committedPoint.y - targetFocal.y)).toBeLessThan(1.25);
  else await expectVerticalFocalOrConstrainedEdge(page, committedPoint.y, targetFocal.y);

  await page.waitForTimeout(250);
  const settledScale = await readerScale(page);
  const settledPoint = await anchoredClientPoint(page, anchor);
  expect(settledScale).toBe(committedScale);
  expect(Math.abs(settledPoint.x - committedPoint.x)).toBeLessThan(0.25);
  expect(Math.abs(settledPoint.y - committedPoint.y)).toBeLessThan(0.25);
}

test("continuous pinch preserves nine focal locations until a physical horizontal edge @chromium-only", async ({ page }) => {
  test.setTimeout(180_000);
  await mockAuthenticatedWorkspace(page);
  const locations = [
    [0.08, 0.03], [0.5, 0.03], [0.92, 0.03],
    [0.08, 0.075], [0.5, 0.075], [0.92, 0.075],
    [0.08, 0.12], [0.5, 0.12], [0.92, 0.12]
  ];
  for (const [pageXRatio, pageYRatio] of locations) {
    await openWorkspace(page, { width: 1194, height: 834 });
    const targetScale = Math.min(4.873, await readerScale(page) * 1.22);
    const { xRatio, yRatio } = await page.locator(".workspace-v2-a4-page").first().evaluate((pageNode, ratios) => {
      const pageBounds = pageNode.getBoundingClientRect();
      const documentBounds = pageNode.closest(".workspace-v2-a4-document").getBoundingClientRect();
      return {
        xRatio: (pageBounds.left + pageBounds.width * ratios.x - documentBounds.left) / documentBounds.width,
        yRatio: (pageBounds.top + pageBounds.height * ratios.y - documentBounds.top) / documentBounds.height
      };
    }, { x: pageXRatio, y: pageYRatio });
    await exactPinch(page, { xRatio, yRatio, targetScale, moveX: 28, moveY: 19 });
  }
});

test("continuous pinch preserves a focal point between pages", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  const [first, second] = await page.locator(".workspace-v2-a4-page").evaluateAll((pages) => pages.slice(0, 2).map((node) => {
    const bounds = node.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  }));
  const documentBounds = await page.locator(".workspace-v2-a4-document").boundingBox();
  const gapY = (first.bottom + second.top) / 2;
  await exactPinch(page, {
    xRatio: 0.5,
    yRatio: (gapY - documentBounds.y) / documentBounds.height,
    targetScale: 1.836,
    moveX: -31,
    moveY: 24
  });
});

test("last-page zoom-out reconciles from post-layout scroll without jumping", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  const stage = page.locator(".workspace-v2-document-stage");
  // Put the last page's 4% mark at 18% of the stage. Applied twice, and that is
  // the point: pages render lazily, so the first pass is what brings the last
  // page into the render window at all, and it necessarily measures a document
  // whose last page has not adopted its rendered aspect ratio yet. Re-applying
  // it once the geometry has settled is what makes the starting position a
  // property of the final layout instead of a race against it -- and whether
  // the zoom-out below reaches the bottom constraint depends on exactly that.
  const scrollLastPageIntoPosition = async () => {
    await stage.evaluate((node) => {
      const lastPage = document.querySelector(".workspace-v2-a4-page:last-child");
      const viewport = node.getBoundingClientRect();
      const pageBounds = lastPage.getBoundingClientRect();
      const anchorClientY = pageBounds.top + pageBounds.height * 0.04;
      const targetClientY = viewport.top + viewport.height * 0.18;
      node.scrollTop += anchorClientY - targetClientY;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };

  await scrollLastPageIntoPosition();
  await expect.poll(async () => page.locator(".workspace-v2-a4-page:last-child .workspace-v2-a4-canvas.is-visible").evaluate((canvas) => canvas.width > 0), { timeout: 20_000 }).toBe(true);
  await waitForStableDocumentGeometry(page);

  await scrollLastPageIntoPosition();
  await waitForStableDocumentGeometry(page);

  const ratios = await page.locator(".workspace-v2-a4-page:last-child").evaluate((lastPage) => {
    const pageBounds = lastPage.getBoundingClientRect();
    const documentBounds = lastPage.closest(".workspace-v2-a4-document").getBoundingClientRect();
    return {
      xRatio: (pageBounds.left + pageBounds.width * 0.5 - documentBounds.left) / documentBounds.width,
      yRatio: (pageBounds.top + pageBounds.height * 0.04 - documentBounds.top) / documentBounds.height
    };
  });

  await exactPinch(page, { ...ratios, targetScale: 1.836, moveX: 18, moveY: 12 });
  await exactPinch(page, { ...ratios, targetScale: 1.55, moveX: -11, moveY: -9 });
  await exactPinch(page, { ...ratios, targetScale: 2.123, moveX: 9, moveY: 7 });
  await exactPinch(page, { ...ratios, targetScale: 1.55, moveX: -7, moveY: -5 });
  await expect(page.locator(".workspace-v2-a4-page:last-child")).toBeInViewport({ ratio: 0.1 });
});

test("high zoom keeps exact 247.8% and 487.3% values without snapping", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 800 });
  const ratios = await page.locator(".workspace-v2-a4-page").first().evaluate((pageNode) => {
    const pageBounds = pageNode.getBoundingClientRect();
    const documentBounds = pageNode.closest(".workspace-v2-a4-document").getBoundingClientRect();
    return {
      xRatio: (pageBounds.left + pageBounds.width * 0.5 - documentBounds.left) / documentBounds.width,
      yRatio: (pageBounds.top + pageBounds.height * 0.5 - documentBounds.top) / documentBounds.height
    };
  });
  await exactPinch(page, { ...ratios, targetScale: 2.478, moveX: 41, moveY: -26 });
  await exactPinch(page, { ...ratios, targetScale: 4.873, moveX: -37, moveY: 29 });
});

test("reader navigation stops at physical horizontal edges and a 20px vertical reveal", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 800 });
  await exactPinch(page, { xRatio: 0.5, yRatio: 0.05, targetScale: 2.478 });
  const stage = page.locator(".workspace-v2-document-stage");
  await stage.evaluate((node) => { node.scrollLeft = 0; });
  await stage.dispatchEvent("wheel", { deltaX: -100_000, deltaY: -100_000, bubbles: true, cancelable: true });
  await expect.poll(async () => stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }))).toEqual(expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }));
  const leading = await page.evaluate(() => {
    const viewport = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return { left: pdf.left - viewport.left, top: pdf.top - viewport.top };
  });
  expect(Math.abs(leading.left)).toBeLessThan(1.5);
  expect(Math.abs(leading.top - 20)).toBeLessThan(1.5);

  await stage.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await stage.dispatchEvent("wheel", { deltaX: 100_000, deltaY: 100_000, bubbles: true, cancelable: true });
  const trailing = await page.evaluate(() => {
    const viewport = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return { right: viewport.right - pdf.right, bottom: viewport.bottom - pdf.bottom };
  });
  expect(Math.abs(trailing.right)).toBeLessThan(1.5);
  expect(Math.abs(trailing.bottom - 20)).toBeLessThan(1.5);
});

test("diagonal one-finger pan preserves the complete 2D finger vector", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 800 });
  await exactPinch(page, { xRatio: 0.5, yRatio: 0.08, targetScale: 2.478 });
  const stage = page.locator(".workspace-v2-document-stage");
  await stage.dispatchEvent("wheel", { deltaX: 360, deltaY: 520, bubbles: true, cancelable: true });
  const viewport = await stage.boundingBox();
  const before = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  const start = { x: viewport.x + viewport.width * 0.55, y: viewport.y + viewport.height * 0.5 };
  await dispatchTouch(stage, "pointerdown", 31, start.x, start.y);
  await dispatchTouch(stage, "pointermove", 31, start.x + 30, start.y + 53);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const moved = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  expect(Math.abs((before.left - moved.left) - 30)).toBeLessThan(1.5);
  expect(Math.abs((before.top - moved.top) - 53)).toBeLessThan(1.5);
  await dispatchTouch(stage, "pointerup", 31, start.x + 30, start.y + 53);
  await page.waitForTimeout(180);
  const afterMomentum = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  expect(afterMomentum.left).toBeLessThanOrEqual(moved.left);
  expect(afterMomentum.top).toBeLessThanOrEqual(moved.top);
});

test("a horizontal one-finger drag pans a zoomed sheet without changing Y", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 800 });
  await exactPinch(page, { xRatio: 0.5, yRatio: 0.08, targetScale: 2.478 });
  const stage = page.locator(".workspace-v2-document-stage");
  await stage.evaluate((node) => {
    node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
    node.scrollTop = Math.min(520, node.scrollHeight - node.clientHeight);
  });
  const viewport = await stage.boundingBox();
  const before = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  const start = { x: viewport.x + viewport.width * 0.55, y: viewport.y + viewport.height * 0.5 };
  await dispatchTouch(stage, "pointerdown", 32, start.x, start.y);
  await dispatchTouch(stage, "pointermove", 32, start.x + 96, start.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const moved = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  expect(Math.abs((before.left - moved.left) - 96)).toBeLessThan(1.5);
  expect(Math.abs(before.top - moved.top)).toBeLessThan(0.25);
  await dispatchTouch(stage, "pointerup", 32, start.x + 96, start.y);
  await page.waitForTimeout(180);
  const afterMomentum = await stage.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  expect(Math.abs(before.top - afterMomentum.top)).toBeLessThan(0.25);
  expect(afterMomentum.left).not.toBe(before.left);
});

test("zoom-out clamps live translation and settles at the full-width minimum", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 1280, height: 800 });
  const minimumScale = await readerScale(page);
  await exactPinch(page, { xRatio: 0.5, yRatio: 0.08, targetScale: 2.478 });
  const stage = page.locator(".workspace-v2-document-stage");
  const viewport = await stage.boundingBox();
  const center = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  const halfSpan = 80;
  const targetScale = minimumScale;
  const targetHalfSpan = halfSpan * (targetScale / 2.478);
  const movedCenter = { x: center.x + 500, y: center.y + 400 };
  await dispatchTouch(stage, "pointerdown", 41, center.x - halfSpan, center.y);
  await dispatchTouch(stage, "pointerdown", 42, center.x + halfSpan, center.y);
  await dispatchTouch(stage, "pointermove", 41, movedCenter.x - targetHalfSpan, movedCenter.y);
  await dispatchTouch(stage, "pointermove", 42, movedCenter.x + targetHalfSpan, movedCenter.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const live = await page.evaluate(() => {
    const viewportBounds = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return {
      horizontalCenterError: Math.abs((pdf.left + pdf.right) / 2 - (viewportBounds.left + viewportBounds.right) / 2),
      leadingGap: pdf.top - viewportBounds.top
    };
  });
  expect(live.horizontalCenterError).toBeLessThan(29);
  expect(live.leadingGap).toBeLessThan(49);

  await dispatchTouch(stage, "pointerup", 41, movedCenter.x - targetHalfSpan, movedCenter.y);
  await dispatchTouch(stage, "pointerup", 42, movedCenter.x + targetHalfSpan, movedCenter.y);
  await expect(page.locator(".workspace-v2-a4-live-layer")).not.toHaveClass(/is-live-pinching|is-zoom-settling|is-springing-back/);
  const settled = await page.evaluate(() => {
    const viewportBounds = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return {
      horizontalCenterError: Math.abs((pdf.left + pdf.right) / 2 - (viewportBounds.left + viewportBounds.right) / 2),
      leadingGap: pdf.top - viewportBounds.top
    };
  });
  expect(settled.horizontalCenterError).toBeLessThan(1.5);
  expect(settled.leadingGap).toBeLessThanOrEqual(20.5);
});

test("single-finger scrolling and Apple Pencil with palm contact remain intact @chromium-only", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  const stage = page.locator(".workspace-v2-document-stage");
  const stageBounds = await stage.boundingBox();
  const startScrollTop = await stage.evaluate((node) => node.scrollTop);
  const x = stageBounds.x + stageBounds.width * 0.5;
  const y = stageBounds.y + stageBounds.height * 0.55;
  await dispatchTouch(stage, "pointerdown", 11, x, y);
  await dispatchTouch(stage, "pointermove", 11, x, y - 140);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await dispatchTouch(stage, "pointerup", 11, x, y - 140);
  await expect.poll(async () => stage.evaluate((node) => node.scrollTop)).toBeGreaterThan(startScrollTop + 80);

  await openWorkspace(page, { width: 834, height: 1194 });
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const drawingStage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const penStart = { x: pageBounds.x + pageBounds.width * 0.35, y: pageBounds.y + pageBounds.height * 0.35 };
  const scaleBeforePen = await readerScale(page);
  await dispatchPointer(drawingStage, "pointerdown", 31, penStart.x, penStart.y, "pen", 2);
  await dispatchPointer(drawingStage, "pointerdown", 41, penStart.x + 12, penStart.y + 9, "touch", 44);
  await dispatchPointer(drawingStage, "pointermove", 31, penStart.x + 55, penStart.y + 36, "pen", 2);
  await dispatchPointer(drawingStage, "pointermove", 31, penStart.x + 105, penStart.y + 58, "pen", 2);
  await dispatchPointer(drawingStage, "pointerup", 31, penStart.x + 105, penStart.y + 58, "pen", 2);
  await dispatchPointer(drawingStage, "pointerup", 41, penStart.x + 12, penStart.y + 9, "touch", 44);
  await expect(page.locator('.workspace-v2-annotation-layer [data-annotation-id]')).toHaveCount(1);
  expect(await readerScale(page)).toBe(scaleBeforePen);
  await expect(page.locator(".workspace-v2-a4-live-layer")).not.toHaveClass(/is-live-pinching/);
});

test("opaque Ball Pen stays color-stable and Precision Eraser splits only touched geometry", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await page.locator('[data-workspace-tool="pen"]').click();
  await page.getByRole("button", { name: "Use #239ed1" }).click();
  await page.locator('[data-workspace-tool="pen"]').click();
  const stage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const start = { x: pageBounds.x + pageBounds.width * .27, y: pageBounds.y + pageBounds.height * .34 };
  const end = { x: pageBounds.x + pageBounds.width * .73, y: start.y };

  for (let repeat = 0; repeat < 10; repeat += 1) {
    const pointerId = 70 + repeat;
    await dispatchPointer(stage, "pointerdown", pointerId, start.x, start.y, "pen", 2);
    await dispatchPointer(stage, "pointermove", pointerId, end.x, end.y, "pen", 2);
    await dispatchPointer(stage, "pointerup", pointerId, end.x, end.y, "pen", 2);
  }

  const penMarks = page.locator('.workspace-v2-annotation-layer [data-annotation-type="pen"]');
  await expect(penMarks).toHaveCount(10);
  expect(await penMarks.evaluateAll((nodes) => nodes.every((node) => (
    node.getAttribute("fill") === "#239ed1"
    && node.getAttribute("opacity") === "1"
    && getComputedStyle(node).mixBlendMode === "normal"
  )))).toBe(true);

  const nearbyY = start.y + 70;
  await dispatchPointer(stage, "pointerdown", 90, start.x, nearbyY, "pen", 2);
  await dispatchPointer(stage, "pointermove", 90, end.x, nearbyY, "pen", 2);
  await dispatchPointer(stage, "pointerup", 90, end.x, nearbyY, "pen", 2);
  const nearby = penMarks.last();
  const nearbyId = await nearby.getAttribute("data-annotation-id");
  const nearbyPath = await nearby.getAttribute("d");

  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const middleX = (start.x + end.x) / 2;
  await dispatchPointer(stage, "pointerdown", 91, middleX, start.y - 24, "pen", 2);
  await dispatchPointer(stage, "pointermove", 91, middleX, start.y + 24, "pen", 2);
  await dispatchPointer(stage, "pointerup", 91, middleX, start.y + 24, "pen", 2);

  await expect(penMarks).toHaveCount(21);
  await expect(page.locator(`[data-annotation-id="${nearbyId}"]`)).toHaveAttribute("d", nearbyPath);
  const fragmentBoxes = await penMarks.evaluateAll((nodes, untouchedId) => nodes
    .filter((node) => node.getAttribute("data-annotation-id") !== untouchedId)
    .map((node) => {
      const bounds = node.getBBox();
      return { left: bounds.x, right: bounds.x + bounds.width };
    }), nearbyId);
  const erasedDocumentX = ((middleX - pageBounds.x) / pageBounds.width) * 1000;
  expect(fragmentBoxes.every((bounds) => bounds.right < erasedDocumentX || bounds.left > erasedDocumentX)).toBe(true);

  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(penMarks).toHaveCount(11);
  await page.getByRole("button", { name: /Redo/ }).click();
  await expect(penMarks).toHaveCount(21);
});

test("Pencil supports 100 percent opacity without internal color stacking", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  await page.getByRole("button", { name: "Pencil", exact: true }).click();
  await page.locator('[data-workspace-tool="pencil"]').click();
  const opacity = page.locator(".workspace-v2-tool-range.is-opacity input");
  await opacity.fill("1");
  await expect(page.locator(".workspace-v2-tool-range.is-opacity output")).toHaveText("100%");
  await page.locator('[data-workspace-tool="pencil"]').click();

  const stage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const start = { x: pageBounds.x + pageBounds.width * .34, y: pageBounds.y + pageBounds.height * .42 };
  const end = { x: pageBounds.x + pageBounds.width * .66, y: start.y + 2 };
  await drawPointerPath(stage, 100, [start, end]);
  await drawPointerPath(stage, 101, [start, end]);

  const pencils = page.locator('.workspace-v2-annotation-layer [data-annotation-type="pencil"]');
  await expect(pencils).toHaveCount(2);
  expect(await pencils.evaluateAll((nodes) => nodes.every((node) => (
    node.getAttribute("opacity") === "1"
    && getComputedStyle(node).mixBlendMode === "normal"
  )))).toBe(true);
});

test("smart ink gestures erase scribbles, straighten on hold, and preserve raw-stroke history", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const stage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const center = { x: pageBounds.x + pageBounds.width * .5, y: pageBounds.y + pageBounds.height * .3 };

  await drawPointerPath(stage, 120, [
    { x: center.x - 82, y: center.y },
    { x: center.x, y: center.y + 1 },
    { x: center.x + 82, y: center.y }
  ]);
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(1);

  const scribble = Array.from({ length: 72 }, (_, index) => ({
    x: center.x + Math.sin(index * 1.47) * 78,
    y: center.y + Math.sin(index * 2.31) * 46
  }));
  await drawPointerPath(stage, 121, scribble);
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(0);
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(1);

  const heldLine = Array.from({ length: 14 }, (_, index) => ({
    x: center.x - 100 + index * 15,
    y: center.y + 120 + Math.sin(index * .8) * 2
  }));
  await dispatchPointer(stage, "pointerdown", 122, heldLine[0].x, heldLine[0].y, "pen", 2);
  for (let index = 1; index < heldLine.length; index += 1) await dispatchPointer(stage, "pointermove", 122, heldLine[index].x, heldLine[index].y, "pen", 2);
  await page.waitForTimeout(650);
  await expect(page.locator('[data-annotation-type="shape"][data-annotation-shape="line"]')).toHaveCount(1);
  await dispatchPointer(stage, "pointerup", 122, heldLine.at(-1).x, heldLine.at(-1).y, "pen", 2);
  await expect(page.locator('[data-annotation-type="shape"][data-annotation-shape="line"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator('[data-annotation-type="shape"]')).toHaveCount(0);
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(2);
  await page.getByRole("button", { name: /Redo/ }).click();
  await expect(page.locator('[data-annotation-type="shape"][data-annotation-shape="line"]')).toHaveCount(1);
});

test("circle erase removes enclosed ink once and remains undoable", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  const stage = page.locator(".workspace-v2-document-stage");
  const pageBounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const center = { x: pageBounds.x + pageBounds.width * .5, y: pageBounds.y + pageBounds.height * .34 };
  await drawPointerPath(stage, 130, [
    { x: center.x - 45, y: center.y },
    { x: center.x, y: center.y + 2 },
    { x: center.x + 45, y: center.y }
  ]);
  const original = page.locator('[data-annotation-type="pen"]').first();
  await expect(original).toBeVisible();
  const circle = Array.from({ length: 33 }, (_, index) => {
    const angle = index / 32 * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * 92, y: center.y + Math.sin(angle) * 62 };
  });
  await dispatchPointer(stage, "pointerdown", 131, circle[0].x, circle[0].y, "pen", 2);
  for (let index = 1; index < circle.length; index += 1) await dispatchPointer(stage, "pointermove", 131, circle[index].x, circle[index].y, "pen", 2);
  await page.waitForTimeout(650);
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(0);
  await dispatchPointer(stage, "pointerup", 131, circle.at(-1).x, circle.at(-1).y, "pen", 2);
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(0);
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Redo/ }).click();
  await expect(page.locator('[data-annotation-type="pen"]')).toHaveCount(0);
});

test("iPad orientation changes enforce full-width minimum zoom and preserve rendering", async ({ page }) => {
  test.setTimeout(60_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, { width: 834, height: 1194 });
  await exactPinch(page, { xRatio: 0.63, yRatio: 0.045, targetScale: 1.836, moveX: 34, moveY: 27 });
  const portraitScale = await readerScale(page);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await readerScale(page)).toBeGreaterThan(portraitScale);
  const horizontal = await page.evaluate(() => {
    const viewport = document.querySelector(".workspace-v2-document-stage").getBoundingClientRect();
    const pdf = document.querySelector(".workspace-v2-a4-live-layer").getBoundingClientRect();
    return { left: pdf.left - viewport.left, right: viewport.right - pdf.right };
  });
  expect(Math.abs(horizontal.left)).toBeLessThan(1.5);
  expect(Math.abs(horizontal.right)).toBeLessThan(1.5);
  const canvas = page.locator(".workspace-v2-a4-canvas.is-visible").first();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate((node) => node.width > 0 && node.height > 0)).toBe(true);
});

for (const device of [
  { name: "iPhone compact", viewport: { width: 320, height: 700 }, standalone: false },
  { name: "iPhone PWA", viewport: { width: 390, height: 844 }, standalone: true },
  { name: "iPad portrait", viewport: { width: 834, height: 1194 }, standalone: false },
  { name: "iPad landscape", viewport: { width: 1194, height: 834 }, standalone: true }
]) {
  test(`${device.name} keeps continuous scale and 2D focal motion`, async ({ page }) => {
    test.setTimeout(60_000);
    if (device.standalone) await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { configurable: true, value: true }));
    await mockAuthenticatedWorkspace(page);
    await openWorkspace(page, device.viewport);
    const initialScale = await readerScale(page);
    const targetScale = Math.min(4.873, initialScale * 1.4173);
    await exactPinch(page, { xRatio: 0.37, yRatio: 0.06, targetScale, moveX: 80, moveY: -33 });
  });
}
