import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "e2e-billing-user",
  email: "student@example.com",
  full_name: "Rami Student",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student"],
  date_joined: "2026-07-18T00:00:00Z"
};

const subscription = {
  id: "81000000-0000-4000-8000-000000000001",
  product_code: "lockin",
  plan_code: "lockin_trial",
  plan_title: "Lock-in trial",
  status: "trialing",
  trial_started_at: "2026-07-01T00:00:00Z",
  trial_ends_at: "2026-07-31T00:00:00Z",
  current_period_started_at: "2026-07-01T00:00:00Z",
  current_period_ends_at: "2026-07-31T00:00:00Z",
  grace_ends_at: null,
  cancel_at_period_end: false,
  cancellation_requested_at: null,
  ended_at: null,
  status_reason: "trial_started",
  revision: 1,
  transitions: []
};

const entitlement = {
  id: "82000000-0000-4000-8000-000000000001",
  code: "focus.workspace",
  title: "Focus workspace",
  description: "Professional document study workspace.",
  source_type: "subscription",
  starts_at: "2026-07-01T00:00:00Z",
  ends_at: "2026-07-31T00:00:00Z",
  quantity_limit: null,
  configuration: {}
};

const catalog = {
  checkout_available: false,
  results: [
    {
      id: "product-1",
      code: "lockin",
      title: "Lock-in",
      description: "Learning operating system",
      plans: [
        {
          id: "plan-1",
          code: "future_paid",
          current_version: {
            id: "version-1",
            version: 1,
            title: "Lock-in Study",
            description: "A future published study plan.",
            audience: "individual",
            trial_days: 0,
            grace_days: 3,
            prices: [
              {
                id: "price-1",
                code: "bhd_monthly",
                amount_minor: 1234,
                currency: "BHD",
                currency_exponent: 3,
                region_code: "",
                interval: "month",
                interval_count: 1,
                tax_behavior: "unspecified",
                valid_until: null
              }
            ]
          }
        }
      ]
    }
  ]
};

const invoice = {
  id: "83000000-0000-4000-8000-000000000001",
  number: "LI-2026-000001",
  subscription_id: subscription.id,
  payment_id: "84000000-0000-4000-8000-000000000001",
  status: "paid",
  currency: "BHD",
  currency_exponent: 3,
  subtotal_minor: 1234,
  discount_minor: 0,
  tax_minor: 0,
  total_minor: 1234,
  amount_paid_minor: 1234,
  amount_refunded_minor: 0,
  period_started_at: "2026-07-01T00:00:00Z",
  period_ends_at: "2026-08-01T00:00:00Z",
  issued_at: "2026-07-01T00:00:00Z",
  paid_at: "2026-07-01T00:00:00Z",
  lines: []
};

const pageOf = <T,>(results: T[]) => ({ next: null, previous: null, results });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.endsWith("/auth/session")) await json({ user });
    else if (path.endsWith("/auth/csrf")) await json({ csrf_token: "e2e-csrf" });
    else if (path === "/api/v1/notifications/summary") await json({ unread_count: 0 });
    else if (path === "/api/v1/subscriptions/current" && request.method() === "GET") {
      await json({ subscription });
    } else if (path === "/api/v1/subscriptions/current/cancel") {
      await json({
        ...subscription,
        cancel_at_period_end: true,
        cancellation_requested_at: "2026-07-18T00:00:00Z",
        revision: 2
      });
    } else if (path === "/api/v1/entitlements/me") await json({ results: [entitlement] });
    else if (path === "/api/v1/catalog/products") await json(catalog);
    else if (path === "/api/v1/payments") await json(pageOf([{ id: invoice.payment_id }]));
    else if (path === "/api/v1/invoices") await json(pageOf([invoice]));
    else if (path === "/api/v1/refunds") await json(pageOf([]));
    else await json({ error: { code: "not_found", message: "Not found." } }, 404);
  });
});

test("plan and access is clear, accessible, responsive, and RTL-safe", async ({ page }, testInfo) => {
  await page.goto("/subscription");
  await expect(page.getByRole("heading", { name: "Plan and access" })).toBeVisible();
  await expect(page.getByText("Focus workspace")).toBeVisible();
  await expect(page.getByText(/BHD\s*1\.234/)).toHaveCount(2);
  await expect(page.getByText(/BHD\s*1\.234/).first()).toBeVisible();
  await expect(page.getByText("LI-2026-000001")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Manage cancellation" }).click();
  await expect(page.getByRole("heading", { name: "Schedule cancellation?" })).toBeVisible();
  await page.getByRole("button", { name: "Schedule cancellation" }).click();
  await expect(page.getByText(/Cancellation is scheduled for/)).toBeVisible();

  if (testInfo.project.name.includes("mobile")) {
    await page.evaluate(() => localStorage.setItem("lockin.locale", "ar"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "الخطة والصلاحيات" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.screenshot({ path: testInfo.outputPath("plan-and-access.png"), fullPage: true });
});
