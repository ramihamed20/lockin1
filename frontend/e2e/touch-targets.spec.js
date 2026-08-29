import { devices, expect, test } from "@playwright/test";

/**
 * Every control a finger can reach has to meet the platform minimum of 44px.
 * The audit found fifteen that did not, from the dashboard's continue row to
 * the Creator Studio rail. These run with touch emulation on, because the size
 * floors are gated on `pointer: coarse` and a desktop pointer never sees them.
 */

const ROUTES = [
  "#/",
  "#/progress",
  "#/study-plan",
  "#/community",
  "#/store",
  "#/review",
  "#/questions",
  "#/settings",
  "#/profile",
  "#/search",
  "#/bookmarks",
  "#/subscription",
  "#/ranked",
  "#/achievements",
  "#/operations/admin/overview",
  "#/operations/admin/users"
];

async function mockOperator(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "touch-operator", email: "touch@example.test", full_name: "Touch Operator", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student", "administrator"], date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ capabilities: ["overview.view", "content.manage", "assessments.manage"], operator: { id: "touch-operator", label: "Operator" } })
      });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by the touch tests" } }) });
  });
}

/**
 * A native radio or checkbox paints a small box but is operated by its label,
 * so the label is the target that has to be large enough.
 */
function undersizedControls() {
  const minimum = 44;
  const offenders = [];
  const selector = "a[href], button, [role='button'], input:not([type='hidden']), select, textarea, [role='tab'], [role='switch'], summary";
  for (const control of document.querySelectorAll(selector)) {
    const bounds = control.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) continue;
    if (control.closest("[inert], [aria-hidden='true']")) continue;
    if (getComputedStyle(control).visibility === "hidden") continue;

    let target = bounds;
    if (control instanceof HTMLInputElement && ["radio", "checkbox"].includes(control.type)) {
      const label = control.closest("label") || (control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null);
      if (label) target = label.getBoundingClientRect();
    }
    if (target.height < minimum - 0.5 || target.width < minimum - 0.5) {
      const name = (control.getAttribute("aria-label") || control.textContent || control.getAttribute("placeholder") || control.tagName).trim().slice(0, 30);
      offenders.push(`${name} ${Math.round(target.width)}x${Math.round(target.height)}`);
    }
  }
  return [...new Set(offenders)];
}

// The browser is fixed by the project config; only the device traits are used.
function deviceTraits({ defaultBrowserType, ...traits }) {
  return traits;
}

for (const [label, descriptor] of [["phone", devices["Pixel 5"]], ["tablet", devices["iPad Pro 11"]]]) {
  test.describe(`${label} touch targets`, () => {
    test.use(deviceTraits(descriptor));

    test(`every control meets the touch minimum on ${label}`, async ({ page }) => {
      test.setTimeout(120_000);
      await mockOperator(page);
      // The floors are gated on a coarse pointer; without one nothing applies.
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "touch emulation is not active").toBe(true);

      const failures = {};
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForTimeout(700);
        const offenders = await page.evaluate(undersizedControls);
        if (offenders.length) failures[route] = offenders;
      }
      expect(failures).toEqual({});
    });
  });
}

test.describe("quiz touch targets", () => {
  test.use(deviceTraits(devices["Pixel 5"]));

  test("leaving a quiz is as easy to hit as answering it", async ({ page }) => {
    await mockOperator(page);
    await page.goto("/#/questions/demo/oral-histology/sheet-1");
    const exit = page.locator(".demo-quiz-exit");
    await expect(exit).toBeVisible({ timeout: 15_000 });
    const bounds = await exit.boundingBox();
    expect(bounds.width).toBeGreaterThanOrEqual(43.5);
    expect(bounds.height).toBeGreaterThanOrEqual(43.5);
  });
});
