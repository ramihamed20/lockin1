import { expect, test } from "@playwright/test";
import { studentSession } from "./fixtures/productionApi.js";
import { POLICY_VERSION } from "../src/lib/policyContent.js";

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

async function mockStudent(page, { installments = false, failFirst = false, locale = "en" } = {}) {
  const state = { submitted: null, acceptedPolicy: null, requests: [], subscription: EXPIRED };
  const user = studentSession({ preferred_language: locale, policy_version: POLICY_VERSION, policy_accepted_at: "2026-11-01T12:00:00Z" });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") return json({ user });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (pathname === "/api/v1/account/policies" && request.method() === "POST") {
      state.acceptedPolicy = request.postDataJSON();
      return json({ user });
    }
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (pathname === "/api/v1/subscriptions/current") return json({ subscription: state.subscription });
    if (pathname === "/api/v1/entitlements/me") return json({ results: [] });
    if (pathname === "/api/v1/catalog/products") {
      return json({
        checkout_available: false,
        manual_payment_available: true,
        first_subscription_offer_eligible: false,
        results: [{ id: "product", plans: [plan("plan-one", "lockin_first_month", 15000), {
          ...plan("plan-two", "lockin_two_months", 25000),
          current_version: {
            ...plan("plan-two", "lockin_two_months", 25000).current_version,
            prices: [{ id: "plan-two-price", currency: "LYD", amount_minor: 25000, currency_exponent: 3,
              installments_available: installments, installment_amounts_minor: [10000, 15000] }]
          }
        }] }]
      });
    }
    if (pathname === "/api/v1/payments/manual-libyana" && request.method() === "POST") {
      state.requests.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (failFirst && state.requests.length === 1) return json({ error: { code: "unavailable", message: "Please try again" } }, 503);
      state.submitted = request.postDataJSON();
      state.subscription = { ...EXPIRED, status: "active", access_allowed: true, payment_verification: "provisional",
        manual_payment_review: { payment_id: "payment-one", status: "pending", submitted_at: "2026-11-01T12:00:00Z" } };
      return json({ payment: { id: "payment-one" }, submission: { id: "submission-one", status: "pending" }, subscription: state.subscription }, 201);
    }
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
  return state;
}

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "ipad-landscape", width: 1180, height: 820 },
  { name: "desktop", width: 1440, height: 900 }
];

for (const viewport of VIEWPORTS) {
  test(`plans are reachable and the checkout is guided on ${viewport.name}`, async ({ page }, testInfo) => {
    const state = await mockStudent(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/#/");

    // Navigation depends on the authenticated shell. Trace recording and a
    // cold install can outlast a generic five-second locator assertion.
    await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible({ timeout: 15_000 });

    // Access is resolved after the shell paints. An expired account moves to
    // Subscription; wait for that navigation before opening the phone drawer.
    await expect(page).toHaveURL(/#\/subscription$/);

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
    // Portrait rails intentionally distribute spare height between entries.
    // Plans must be the very next destination after Store at every width.
    const destinations = await nav.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("href")));
    expect(destinations.indexOf("#/subscription")).toBe(destinations.indexOf("#/store") + 1);
    await plans.click();

    const steps = page.getByRole("list", { name: "Subscription steps" });
    await expect(steps.getByRole("button", { name: "Payment", exact: true })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: /^Recharge card code/ })).toHaveCount(0);
    await page.getByRole("radio", { name: /Two months/ }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Price & details", exact: true })).toBeFocused();
    await expect(page.locator(".subscription-order-plan")).toContainText("Two months");
    await expect(page.locator(".subscription-order-price")).toContainText("25");
    await expect(page.getByRole("textbox", { name: /^Recharge card code/ })).toHaveCount(0);
    expect(state.requests).toHaveLength(0);
    await page.getByRole("button", { name: "Continue to payment", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Payment", exact: true })).toBeFocused();
    const code = page.getByRole("textbox", { name: /^Recharge card code/ });
    await code.scrollIntoViewIfNeeded();
    await expect(code).toBeInViewport();
    await code.fill("1234567890123");
    await expect(page.getByRole("link", { name: "terms and refund policy", exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`subscription-${viewport.name}.png`), fullPage: true });

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Continue to payment", exact: true }).click();
    await expect(code).toHaveValue("1234567890123");
    const pay = page.getByRole("button", { name: /^Pay / });
    await expect(pay).toBeDisabled();
    await page.locator("#libyana-payment").getByRole("checkbox").check();
    await expect(pay).toBeEnabled();
    await pay.click();
    await expect.poll(() => state.submitted).not.toBeNull();
    expect(state.acceptedPolicy).toEqual({ version: POLICY_VERSION, accept_policies: true });
    expect(state.submitted.plan_id).toBe("plan-two");
    expect(state.submitted.recharge_codes).toEqual(["1234567890123"]);
    await expect(page.getByRole("heading", { name: "Your recharge card is being reviewed" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Recharge card code/ })).toHaveCount(0);
    expect(state.requests).toHaveLength(1);
  });
}


test("Arabic stages fit a narrow phone and preserve LTR card entry", async ({ page }) => {
  await mockStudent(page, { locale: "ar" });
  await page.addInitScript(() => localStorage.setItem("lock-in.locale", "ar"));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/#/subscription");
  await expect(page.getByRole("list", { name: "خطوات الاشتراك" })).toBeVisible();
  for (const next of ["متابعة", "المتابعة إلى الدفع"]) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: next, exact: true }).click();
  }
  const code = page.getByRole("textbox", { name: /^رمز بطاقة التعبئة/ });
  await expect(code).toHaveAttribute("dir", "ltr");
  await code.fill("123");
  await page.locator("#libyana-payment").getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: /^ادفع / })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("installments show the first payment and failed submissions retry the same attempt", async ({ page }) => {
  const state = await mockStudent(page, { installments: true, failFirst: true });
  await page.goto("/#/subscription");
  await page.getByRole("radio", { name: "Two months", exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Pay in installments", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Pay in installments", exact: true })).toBeChecked();
  await expect(page.locator(".subscription-order-price")).toContainText("10");
  await expect(page.locator(".subscription-order-price")).toContainText("25");
  await expect(page.locator(".subscription-installment-preview li")).toHaveCount(2);
  await page.getByRole("button", { name: "Continue to payment", exact: true }).click();
  await page.getByRole("textbox", { name: /^Recharge card code/ }).fill("1234567890123");
  await page.locator("#libyana-payment").getByRole("checkbox").check();
  const pay = page.getByRole("button", { name: /^Pay / });
  await expect(pay).toContainText("10");
  await pay.click();
  await expect(page.locator(".form-alert.error")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Recharge card code/ })).toHaveValue("1234567890123");
  await pay.click();
  await expect.poll(() => state.submitted).not.toBeNull();
  expect(state.submitted.pay_in_installments).toBe(true);
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0].key).toBeTruthy();
  expect(state.requests[0].key).toBe(state.requests[1].key);
  expect(state.requests[0].body).toEqual(state.requests[1].body);
});
