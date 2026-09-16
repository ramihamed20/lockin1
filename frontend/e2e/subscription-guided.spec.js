import { expect, test } from "@playwright/test";
import { studentSession } from "./fixtures/productionApi.js";

/**
 * Students could not find the plans or tell how to subscribe. The sidebar now
 * lists them under Store, and the page walks through plan, price and payment.
 */

const EXPIRED = {
  id: "subscription-expired",
  status: "expired",
  access_allowed: false,
  remaining_days: 0,
  current_period_ends_at: "2026-01-01T00:00:00Z",
  plan_title: null
};

function plan(id, code, amount) {
  return {
    id,
    code,
    current_version: {
      title: code,
      description: `${code} description`,
      availability: "available",
      prices: [{ id: `${id}-price`, currency: "LYD", amount_minor: amount, currency_exponent: 3, first_subscription_only: false }]
    }
  };
}

let submitted = null;

async function mockStudent(page) {
  submitted = null;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession() });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (pathname === "/api/v1/subscriptions/current") return json({ subscription: EXPIRED });
    if (pathname === "/api/v1/entitlements/me") return json({ results: [] });
    if (pathname === "/api/v1/catalog/products") {
      return json({
        checkout_available: false,
        manual_payment_available: true,
        first_subscription_offer_eligible: false,
        results: [{ id: "product", plans: [plan("plan-one", "lockin_first_month", 15000), plan("plan-two", "lockin_two_months", 25000)] }]
      });
    }
    if (pathname === "/api/v1/payments/manual-libyana" && request.method() === "POST") {
      submitted = request.postDataJSON();
      return json({ subscription: { ...EXPIRED, status: "active", access_allowed: true, payment_verification: "provisional" } }, 201);
    }
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
}

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "ipad-landscape", width: 1180, height: 820 },
  { name: "desktop", width: 1440, height: 900 }
];

for (const viewport of VIEWPORTS) {
  test(`plans are reachable and the checkout is guided on ${viewport.name}`, async ({ page }, testInfo) => {
    await mockStudent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/#/");

    const compact = viewport.width < 640;
    if (compact) await page.getByRole("button", { name: "More" }).click();
    const nav = compact ? page.locator("#mobile-drawer") : page.getByRole("navigation", { name: "Primary" });
    const store = nav.getByRole("link", { name: "Store", exact: true });
    const plans = nav.getByRole("link", { name: "Plans", exact: true });
    await expect(plans).toBeVisible();
    // Directly under Store.
    const storeBox = await store.boundingBox();
    const plansBox = await plans.boundingBox();
    expect(plansBox.y).toBeGreaterThan(storeBox.y);
    expect(plansBox.y - storeBox.y).toBeLessThan(storeBox.height * 1.8);
    await plans.click();

    const steps = page.getByRole("list", { name: "Subscription steps" });
    await expect(steps.getByRole("button", { name: /Choose plan/ })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("textbox", { name: /^Recharge card code/ })).toHaveCount(0);
    await page.getByRole("radio", { name: /Two months/ }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(steps.getByRole("button", { name: /Price & details/ })).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("heading", { name: "Two months" })).toBeVisible();
    await expect(page.getByText(/25/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await page.getByRole("button", { name: "Continue to payment" }).click();

    await expect(page.getByRole("heading", { name: "Pay with Libyana" })).toBeVisible();
    const code = page.getByRole("textbox", { name: /^Recharge card code/ });
    await expect(code).toBeInViewport();
    await code.fill("1234567890123");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`subscription-${viewport.name}.png`), fullPage: true });

    await page.getByRole("button", { name: "Submit card and continue" }).click();
    await expect.poll(() => submitted).not.toBeNull();
    expect(submitted.plan_id).toBe("plan-two");
    expect(submitted.recharge_codes).toEqual(["1234567890123"]);
  });
}
