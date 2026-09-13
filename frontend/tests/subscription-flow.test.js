import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("manual Libyana checkout sends only the selected plan and recharge codes", () => {
  const billing = source("../src/api/billing.js");
  const manualCheckout = billing.match(/async submitLibyana[\s\S]+?\n  }\n};/)?.[0] || "";

  assert.match(manualCheckout, /body:\s*\{ plan_id: planId, recharge_codes: rechargeCodes \}/);
  assert.doesNotMatch(manualCheckout, /body:\s*\{[^}]*price/i);
  assert.doesNotMatch(manualCheckout, /body:\s*\{[^}]*duration/i);
  assert.doesNotMatch(manualCheckout, /body:\s*\{[^}]*status/i);
});

test("subscription access is centralized and expired accounts retain safe routes", () => {
  const guard = source("../src/components/auth/ProtectedRoute.jsx");
  const app = source("../src/App.jsx");
  const provider = source("../src/lib/SubscriptionSessionContext.jsx");
  const expired = source("../src/components/subscription/ExpiredAccess.jsx");

  assert.match(guard, /SUBSCRIPTION_PROTECTED_PATHS/);
  assert.match(guard, /subscriptionSession\.canAccessNow\(\)/);
  assert.doesNotMatch(guard, /billingApi\.currentSubscription/);
  assert.doesNotMatch(guard, /location\.pathname, user/);
  assert.match(provider, /subscriptionRefreshAt/);
  assert.match(provider, /window\.setTimeout\(schedule/);
  assert.match(provider, /setInterval/);
  assert.match(provider, /visibilitychange/);
  assert.match(provider, /addEventListener\("focus"/);
  assert.match(provider, /RETRY_BASE_DELAY_MS/);
  assert.match(provider, /window\.setTimeout\(\(\) => void refresh\(\), delay\)/);
  assert.doesNotMatch(provider, /state\.ready \|\| state\.error/);
  assert.match(guard, /<ExpiredAccess \/>/);
  assert.match(expired, /Navigate replace to="\/subscription"/);
  assert.match(app, /SubscriptionSessionProvider/);
  assert.match(app, /path="\/subscription"/);
  assert.match(app, /path="\/settings"/);
});

test("subscription UI preserves LTR recharge entry inside Arabic RTL and uses server plan terms", () => {
  const page = source("../src/pages/Subscription.jsx");
  const status = source("../src/components/subscription/SubscriptionStatus.jsx");

  assert.match(page, /dir="ltr"/);
  assert.match(page, /inputMode="numeric"/);
  assert.match(page, /effectivePlan/);
  assert.match(page, /billingApi\.submitLibyana\(/);
  assert.match(page, /early_renewal_available/);
  assert.match(page, /status === "active" && subscription\?\.access_allowed/);
  assert.match(page, /pattern="\[0-9\]\{13\}"/);
  assert.match(page, /setAuthoritativeSubscription\(result\.subscription\)/);
  assert.doesNotMatch(page, /billingApi\.currentSubscription/);
  assert.match(page, /subscription\.directAccess/);
  assert.match(page, /comingSoonOffers/);
  assert.match(page, /version\?\.availability === "coming_soon"/);
  assert.match(page, /disabled aria-disabled="true"/);
  assert.match(status, /payment_verification === "provisional"/);
  assert.doesNotMatch(page, />pending_review</);
});

test("Creator Studio exposes manual review and immutable plan-version controls", () => {
  const adminPage = source("../src/pages/OperationsAdmin.jsx");
  const payments = source("../src/pages/admin/PaymentsConsole.jsx");
  const subscriptions = source("../src/pages/admin/SubscriptionsConsole.jsx");
  const adminApi = source("../src/api/adminControl.js");

  assert.match(adminPage, /PaymentsConsole/);
  assert.match(adminPage, /SubscriptionsConsole/);
  assert.match(adminPage, /PlanPriceEditor/);
  assert.match(payments, /ReviewActions/);
  assert.match(subscriptions, /Cancel immediately/);
  assert.match(subscriptions, /Paid access ends now/);
  assert.match(payments, /Payment approved\. The subscription is verified/);
  assert.match(adminApi, /manual-review/);
  assert.match(adminApi, /createPlanVersion/);
});

test("a review refreshes the queue it moved the payment out of", () => {
  const payments = source("../src/pages/admin/PaymentsConsole.jsx");

  // The decision changes which filter the payment belongs to, so the list, the
  // queue counters and the open payment are all re-read rather than left
  // showing the state the reviewer just ended.
  assert.match(payments, /list\.reload\(\);\s*\n\s*summary\.reload\(\);/);
  assert.match(payments, /data\.reload\(\);\s*\n\s*onReviewed\?\.\(\);/);
});

test("the admin console never offers an action the server would refuse", () => {
  const payments = source("../src/pages/admin/PaymentsConsole.jsx");
  const subscriptions = source("../src/pages/admin/SubscriptionsConsole.jsx");

  // Approve and reject are rendered only for a submission still awaiting a
  // decision, and only for an administrator who may actually take one.
  assert.match(payments, /const reviewable = submission\.status === "pending"/);
  assert.match(payments, /canManage && reviewable/);
  // Suspending a suspended subscription, or reactivating a live one, is not
  // offered at all rather than refused after the fact.
  assert.match(subscriptions, /availableActions/);
  assert.match(subscriptions, /effectiveAction/);
});
