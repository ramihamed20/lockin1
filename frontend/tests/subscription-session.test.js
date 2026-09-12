import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPendingManualPayment,
  isSubscriptionSnapshotFresh,
  manualPaymentReview,
  readSubscriptionSnapshot,
  subscriptionRefreshAt,
  writeSubscriptionSnapshot
} from "../src/lib/subscriptionSession.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  };
}

test("an authoritative paid subscription remains fresh locally until expires_at", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");
  const expiresAt = "2026-10-01T00:00:00Z";
  const snapshot = {
    version: 2,
    userId: "user-1",
    subscription: { status: "active", access_allowed: true, expires_at: expiresAt },
    entitlements: [],
    storedAt: new Date(now).toISOString()
  };

  assert.equal(subscriptionRefreshAt(snapshot), Date.parse(expiresAt));
  assert.equal(isSubscriptionSnapshotFresh(snapshot, "user-1", now), true);
  assert.equal(isSubscriptionSnapshotFresh(snapshot, "user-1", now + 29_999), true);
  assert.equal(isSubscriptionSnapshotFresh(snapshot, "user-1", now + 30_000), false);
  assert.equal(isSubscriptionSnapshotFresh(snapshot, "user-1", Date.parse(expiresAt)), false);
  assert.equal(isSubscriptionSnapshotFresh({
    ...snapshot,
    subscription: { status: "active", access_allowed: true }
  }, "user-1", now), false);
});

test("the session cache is scoped to the authenticated user and survives screen refreshes", () => {
  globalThis.window = { sessionStorage: storage() };
  const subscription = {
    status: "active",
    access_allowed: true,
    expires_at: "2026-10-01T00:00:00Z"
  };

  writeSubscriptionSnapshot("user-1", subscription, []);
  assert.deepEqual(readSubscriptionSnapshot("user-1", Date.now() + 1_000)?.subscription, subscription);
  assert.equal(readSubscriptionSnapshot("user-2", Date.now() + 1_000), null);
  assert.equal(readSubscriptionSnapshot("user-1", Date.parse("2026-10-01T00:00:00Z")), null);
  delete globalThis.window;
});

test("a reader without access re-reads the server rather than trusting the cache", () => {
  // The state a reader is in while an administrator decides on their recharge
  // card. It used to be cached as fresh for ever, so the approval that ended it
  // was the one change the client would never go and look for.
  const now = Date.parse("2026-09-01T00:00:00Z");
  const waiting = {
    version: 2,
    userId: "user-1",
    subscription: { status: "expired", access_allowed: false },
    entitlements: [],
    storedAt: new Date(now).toISOString()
  };

  assert.equal(subscriptionRefreshAt(waiting), null);
  assert.equal(isSubscriptionSnapshotFresh(waiting, "user-1", now), true);
  assert.equal(isSubscriptionSnapshotFresh(waiting, "user-1", now + 29_999), true);
  assert.equal(isSubscriptionSnapshotFresh(waiting, "user-1", now + 30_000), false);
  // A snapshot with no usable age cannot be trusted at all.
  assert.equal(isSubscriptionSnapshotFresh({ ...waiting, storedAt: "" }, "user-1", now), false);
});

test("direct manual access does not create recurring checks", () => {
  const direct = { version: 2, userId: "user-1", subscription: null, entitlements: [{ source_type: "manual", code: "content.premium" }] };

  assert.equal(subscriptionRefreshAt(direct), null);
  assert.equal(isSubscriptionSnapshotFresh(direct, "user-1"), true);
});

test("the pending review carried on the snapshot is what gates a new submission", () => {
  const pending = { manual_payment_review: { status: "pending", payment_id: "p1" } };
  const rejected = { manual_payment_review: { status: "rejected", payment_id: "p1", rejection_reason: "Spent card" } };

  assert.equal(hasPendingManualPayment(pending), true);
  assert.equal(hasPendingManualPayment(rejected), false);
  assert.equal(hasPendingManualPayment({ manual_payment_review: null }), false);
  assert.equal(hasPendingManualPayment(null), false);
  assert.equal(manualPaymentReview(rejected).rejection_reason, "Spent card");
  assert.equal(manualPaymentReview({}), null);
});

test("Founder access is exempt from expiry checks without a paid entitlement", () => {
  const founder = {
    version: 2,
    userId: "founder-1",
    subscription: { status: "founder", access_allowed: true, access_exempt: true },
    entitlements: []
  };

  assert.equal(subscriptionRefreshAt(founder), null);
  assert.equal(isSubscriptionSnapshotFresh(founder, "founder-1"), true);
});
