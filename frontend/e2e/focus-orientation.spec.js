import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

// Rotating an iPad while a sheet is open must re-lay the reader out for the new
// stage. The reader used to keep the size it opened with, so after a rotation
// the page was centred, padded and given a scroll range for the old
// orientation: stranded against the left edge with no way to pan it back.

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace";
const PORTRAIT = { width: 820, height: 1180 };
const LANDSCAPE = { width: 1180, height: 820 };

async function mockAuthenticatedWorkspace(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (pathname === "/api/v1/auth/session") {
      return json({ user: { id: "orientation-student", email: "orientation@example.test", full_name: "Orientation Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    }
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") return json({ active_session: null });
    return json({ error: { code: "not_found", message: "Not used by orientation tests" } }, 404);
  });
}

async function openWorkspace(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
}

/** Two frames, then until the stage stops moving. */
async function settle(page) {
  // WebKit can return the same intermediate geometry while resize and spring
  // callbacks are waiting for a frame. Flush frames before testing stability.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let previous = "";
  await expect.poll(async () => {
    const layout = await geometry(page);
    const current = JSON.stringify(layout);
    const stable = current === previous && layout.transform === "";
    previous = current;
    return stable;
  }, { intervals: [120, 120, 200, 300] }).toBe(true);
}

function geometry(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const pdf = document.querySelector(".workspace-v2-a4-live-layer");
    const stageBounds = stage.getBoundingClientRect();
    const pdfBounds = pdf.getBoundingClientRect();
    return {
      stageLeft: stageBounds.left,
      stageRight: stageBounds.right,
      stageWidth: stage.clientWidth,
      pdfLeft: pdfBounds.left,
      pdfRight: pdfBounds.right,
      pdfWidth: pdfBounds.width,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      horizontalRange: stage.scrollWidth - stage.clientWidth,
      transform: pdf.style.transform,
      page: document.querySelector(".workspace-v2-page-number")?.textContent?.replace(/\s+/g, "") || ""
    };
  });
}

/** The page sits where the stage says it should, with no range left over from another size. */
async function expectLaidOutForStage(page, label) {
  const layout = await geometry(page);
  expect(layout.transform, `${label}: stale pan transform`).toBe("");
  // The only horizontal scroll is the part of the page wider than the stage.
  expect(Math.abs(layout.horizontalRange - Math.max(0, layout.pdfWidth - layout.stageWidth)), `${label}: horizontal range`).toBeLessThan(2);
  if (layout.pdfWidth <= layout.stageWidth + 1) {
    const offset = (layout.pdfLeft + layout.pdfRight) / 2 - (layout.stageLeft + layout.stageRight) / 2;
    expect(Math.abs(offset), `${label}: page is not centred`).toBeLessThan(2);
  } else {
    expect(layout.pdfLeft, `${label}: page left a gap on the left`).toBeLessThanOrEqual(layout.stageLeft + 1);
    expect(layout.pdfRight, `${label}: page left a gap on the right`).toBeGreaterThanOrEqual(layout.stageRight - 1);
  }
  return layout;
}

async function zoomBy(page, steps) {
  const stage = page.locator(".workspace-v2-document-stage");
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.keyboard.down("Control");
  for (let index = 0; index < Math.abs(steps); index += 1) await page.mouse.wheel(0, steps > 0 ? -120 : 120);
  await page.keyboard.up("Control");
  await settle(page);
}

async function readTo(page, top) {
  await page.locator(".workspace-v2-document-stage").evaluate((stage, value) => { stage.scrollTop = value; }, top);
  await settle(page);
}

async function rotate(page, viewport) {
  await page.setViewportSize(viewport);
  await settle(page);
}

const ZOOMS = [
  { name: "fit width", steps: 0 },
  { name: "below fit width", steps: -3 },
  { name: "above fit width", steps: 3 }
];

for (const [name, sequence] of [
  ["portrait to landscape to portrait", [PORTRAIT, LANDSCAPE, PORTRAIT]],
  ["landscape to portrait to landscape", [LANDSCAPE, PORTRAIT, LANDSCAPE]]
]) {
  for (const zoom of ZOOMS) {
    test(`an iPad rotating ${name} at ${zoom.name} keeps the page centred and the reading position`, async ({ page }) => {
      test.setTimeout(90_000);
      await mockAuthenticatedWorkspace(page);
      await openWorkspace(page, sequence[0]);
      if (zoom.steps) await zoomBy(page, zoom.steps);
      await readTo(page, 2400);
      const opened = await expectLaidOutForStage(page, `opened ${sequence[0].width}`);
      if (zoom.steps < 0) expect(opened.pdfWidth).toBeLessThan(opened.stageWidth - 40);
      if (zoom.steps > 0) expect(opened.pdfWidth).toBeGreaterThan(opened.stageWidth + 40);

      for (const viewport of sequence.slice(1)) {
        await rotate(page, viewport);
        const rotated = await expectLaidOutForStage(page, `rotated to ${viewport.width}x${viewport.height}`);
        // The page being read does not change, and the reader was not sent home.
        expect(rotated.page).toBe(opened.page);
        expect(rotated.scrollTop).toBeGreaterThan(400);

        // Panning still works in both directions when the page is wider than the stage.
        if (rotated.horizontalRange > 20) {
          const stage = page.locator(".workspace-v2-document-stage");
          const box = await stage.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.wheel(-400, 0);
          await expect.poll(async () => (await geometry(page)).scrollLeft).toBeLessThan(rotated.scrollLeft || 1);
          await page.mouse.wheel(800, 0);
          await expect.poll(async () => (await geometry(page)).scrollLeft).toBeGreaterThan(rotated.scrollLeft - 1);
        }
      }
    });
  }
}

test("docking and closing the notes panel in iPad landscape after a rotation keeps the page centred", async ({ page }) => {
  test.setTimeout(90_000);
  await mockAuthenticatedWorkspace(page);
  await openWorkspace(page, PORTRAIT);
  await zoomBy(page, -3);
  await rotate(page, LANDSCAPE);
  await expectLaidOutForStage(page, "landscape");
  await page.getByRole("button", { name: "Open notes" }).click();
  await expect(page.locator("#workspace-notes-panel")).toHaveClass(/is-open/);
  await settle(page);
  await expectLaidOutForStage(page, "notes open");
  await page.getByRole("button", { name: "Close notes" }).first().click();
  await settle(page);
  await expectLaidOutForStage(page, "notes closed");
});
