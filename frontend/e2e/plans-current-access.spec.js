import { expect, test } from "@playwright/test";
import { studentSession } from "./fixtures/productionApi.js";

/**
 * Plans -> Current Access, on an iPad.
 *
 * The plan name sat in a grid cell with `overflow-wrap: anywhere`, which also
 * collapses that cell's minimum width to a single character. On a tablet the
 * heading column kept its full width and squeezed the summary to its floor, so
 * "Free Trial" was broken one letter above another. The header now yields the
 * heading column first and keeps the longest word as the cell's floor.
 */

const TRIAL = {
  id: "subscription-trialing",
  status: "trialing",
  access_allowed: true,
  remaining_days: 3,
  trial_ends_at: "2026-10-01T00:00:00Z",
  current_period_ends_at: "2026-10-01T00:00:00Z",
  // The seeded trial plan's real title, which is what wrapped.
  plan_title: "Free Trial"
};

function plan(id, code, amount) {
  return {
    id,
    code,
    current_version: {
      title: code,
      description: `${code} description`,
      availability: "available",
      prices: [
        {
          id: `${id}-price`,
          currency: "LYD",
          amount_minor: amount,
          currency_exponent: 3,
          first_subscription_only: false
        }
      ]
    }
  };
}

async function mockTrialStudent(page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession() });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (pathname === "/api/v1/operations/session") {
      return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    }
    if (pathname === "/api/v1/subscriptions/current") return json({ subscription: TRIAL });
    if (pathname === "/api/v1/entitlements/me") return json({ results: [] });
    if (pathname === "/api/v1/catalog/products") {
      return json({
        checkout_available: false,
        manual_payment_available: true,
        first_subscription_offer_eligible: false,
        results: [
          {
            id: "product",
            plans: [
              plan("plan-one", "lockin_first_month", 15000),
              plan("plan-two", "lockin_two_months", 25000)
            ]
          }
        ]
      });
    }
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
}

/** The number of rendered text lines the element's own text occupies. */
async function textLineCount(locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getClientRects().length;
  });
}

const VIEWPORTS = [
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "ipad-landscape", width: 1180, height: 820 },
  { name: "ipad-mini-portrait", width: 744, height: 1133 },
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 }
];

for (const viewport of VIEWPORTS) {
  test(`"Free Trial" stays on one line in Current Access on ${viewport.name}`, async ({
    page
  }, testInfo) => {
    await mockTrialStudent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/#/subscription");

    const summary = page.locator(".subscription-premium-header .subscription-current-summary");
    const planName = summary.locator("strong").first();
    await expect(planName).toHaveText("Free Trial");
    expect(await textLineCount(planName)).toBe(1);

    // The state pill beside it carries the same words and must also read
    // normally rather than a letter at a time.
    const stateTitle = summary.locator(".subscription-state strong");
    await expect(stateTitle).toHaveText("Free trial");
    expect(await textLineCount(stateTitle)).toBe(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: testInfo.outputPath(`plans-current-access-${viewport.name}.png`)
    });
  });
}

test("the plan step no longer repeats guidance under its heading", async ({ page }) => {
  await mockTrialStudent(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/#/subscription");

  await expect(page.getByRole("group", { name: "Choose a plan" })).toBeVisible();
  await expect(
    page.getByText("Pick the plan that fits your study time", { exact: false })
  ).toHaveCount(0);
  await expect(page.getByText("You can review the price before paying", { exact: false })).toHaveCount(
    0
  );
});
