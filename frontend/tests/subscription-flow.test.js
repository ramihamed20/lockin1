import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("manual Libyana checkout sends only the selected plan and recharge code", () => {
  const billing = source("../src/api/billing.js");
  const manualCheckout = billing.match(/async submitLibyana[\s\S]+?\n  }\n};/)?.[0] || "";

  assert.match(manualCheckout, /body:\s*\{ plan_id: planId, recharge_code: rechargeCode \}/);
  assert.doesNotMatch(manualCheckout, /body:\s*\{[^}]*price/i);
  assert.doesNotMatch(manualCheckout, /body:\s*\{[^}]*duration/i);
  assert.doesNotMatch(manualCheckout, /body:\s*\{[^}]*status/i);
});

test("subscription access is centralized and expired accounts retain safe routes", () => {
  const guard = source("../src/components/auth/ProtectedRoute.jsx");
  const app = source("../src/App.jsx");

  assert.match(guard, /SUBSCRIPTION_PROTECTED_PATHS/);
  assert.match(guard, /subscription\.access_allowed/);
  assert.match(guard, /<ExpiredAccess subscription=\{subscription\}/);
  assert.match(app, /path="\/subscription"/);
  assert.match(app, /path="\/settings"/);
});

test("subscription UI preserves LTR recharge entry inside Arabic RTL and uses server plan terms", () => {
  const page = source("../src/pages/Subscription.jsx");
  const status = source("../src/components/subscription/SubscriptionStatus.jsx");

  assert.match(page, /dir="ltr"/);
  assert.match(page, /inputMode="numeric"/);
  assert.match(page, /effectivePlan/);
  assert.match(page, /billingApi\.submitLibyana\(effectivePlan, code\)/);
  assert.match(status, /payment_verification === "provisional"/);
  assert.doesNotMatch(page, />pending_review</);
});

test("Creator Studio exposes manual review and immutable plan-version controls", () => {
  const adminPage = source("../src/pages/OperationsAdmin.jsx");
  const adminApi = source("../src/api/adminControl.js");

  assert.match(adminPage, /ManualPaymentReviewPanel/);
  assert.match(adminPage, /PlanPriceEditor/);
  assert.match(adminApi, /manual-review/);
  assert.match(adminApi, /createPlanVersion/);
});
