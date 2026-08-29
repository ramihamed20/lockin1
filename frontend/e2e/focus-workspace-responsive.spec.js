import { expect, test } from "@playwright/test";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

const PHONES = [
  { width: 320, height: 568, name: "phone-320" },
  { width: 360, height: 800, name: "phone-360" },
  { width: 390, height: 844, name: "phone-390" },
  { width: 412, height: 915, name: "phone-412" }
];

const TABLETS = [
  { width: 768, height: 1024, name: "tablet-768" },
  { width: 820, height: 1180, name: "tablet-820" },
  { width: 834, height: 1194, name: "tablet-834" },
  { width: 1024, height: 1366, name: "tablet-1024" }
];

async function mockAuthenticatedWorkspace(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "responsive-student", email: "responsive@example.test", full_name: "Responsive Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by responsive tests" } }) });
  });
}

/** Every visible control must stay inside the viewport and remain tappable. */
async function auditViewport(page, viewport) {
  const report = await page.evaluate((size) => {
    const root = document.querySelector(".workspace-v2");
    const rootBounds = root.getBoundingClientRect();
    const overflowing = [];
    const undersized = [];
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    for (const control of root.querySelectorAll("button:not([disabled]), input, [role='switch']")) {
      const bounds = control.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      // Closed drawers park their controls off-screen and mark them inert.
      if (control.closest("[inert], [aria-hidden='true']")) continue;
      const scroller = control.closest(".workspace-v2-toolbar-scroll, .workspace-v2-tool-options, .workspace-v2-settings-content, .workspace-v2-side-content");
      if (!scroller && (bounds.right > size.width + 1 || bounds.left < -1 || bounds.bottom > size.height + 1 || bounds.top < -1)) {
        overflowing.push(`${control.className || control.tagName}@${Math.round(bounds.left)},${Math.round(bounds.top)} ${Math.round(bounds.width)}x${Math.round(bounds.height)}`);
      }
      const target = Math.min(bounds.width, bounds.height);
      if (coarse && target < 24) undersized.push(`${control.getAttribute("aria-label") || control.className} ${Math.round(bounds.width)}x${Math.round(bounds.height)}`);
    }
    return {
      overflowing,
      undersized,
      documentScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      workspaceWidth: Math.round(rootBounds.width),
      workspaceHeight: Math.round(rootBounds.height),
      stageScrollsSideways: (() => {
        const stage = document.querySelector(".workspace-v2-document-stage");
        return stage ? stage.scrollWidth > stage.clientWidth + 1 : false;
      })()
    };
  }, viewport);
  expect(report.overflowing, `controls escaped the ${viewport.name} viewport`).toEqual([]);
  expect(report.documentScrollsSideways, `${viewport.name} scrolled the page sideways`).toBe(false);
  expect(report.workspaceWidth).toBe(viewport.width);
  return report;
}

for (const orientation of ["portrait", "landscape"]) {
  for (const device of [...PHONES, ...TABLETS]) {
    const viewport = orientation === "portrait"
      ? { ...device, name: `${device.name}-portrait` }
      : { width: device.height, height: device.width, name: `${device.name}-landscape` };

    test(`the workspace fits ${viewport.name} with the page dock and tool options open`, async ({ page }) => {
      test.setTimeout(60_000);
      await mockAuthenticatedWorkspace(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(ROUTE);
      await page.getByRole("button", { name: /Normal Study/ }).click();
      await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });

      // The reader always fills the viewport, and the page dock is reachable.
      await auditViewport(page, viewport);
      await expect(page.locator(".workspace-v2-page-number")).toBeVisible();
      await page.locator(".workspace-v2-page-number").click();
      await expect(page.locator(".workspace-v2-page-navigator")).toBeVisible();
      await auditViewport(page, viewport);
      await page.locator(".workspace-v2-page-number").click();

      // The pen palette is the widest surface the toolbar can open.
      const pen = page.locator('[data-workspace-tool="pen"]');
      await pen.scrollIntoViewIfNeeded();
      await pen.click();
      await pen.click();
      await expect(page.locator("#workspace-pen-options")).toBeVisible();
      const optionsFit = await page.locator("#workspace-pen-options").evaluate((node, size) => {
        const bounds = node.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, bottom: bounds.bottom, viewportWidth: size.width, viewportHeight: size.height };
      }, viewport);
      expect(optionsFit.left).toBeGreaterThanOrEqual(-1);
      expect(optionsFit.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(optionsFit.bottom).toBeLessThanOrEqual(viewport.height + 1);
      await auditViewport(page, viewport);

      // Every tool stays reachable through the horizontally scrollable rail.
      const reachable = await page.locator(".workspace-v2-tool-list").evaluate((list) => {
        const scroller = list.closest(".workspace-v2-toolbar-scroll");
        scroller.scrollLeft = scroller.scrollWidth;
        return [...list.querySelectorAll("button")].length;
      });
      expect(reachable).toBe(9);
    });
  }
}
