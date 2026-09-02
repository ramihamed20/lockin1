import assert from "node:assert/strict";
import test from "node:test";

import {
  isSubscriptionSnapshotFresh,
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
    version: 1,
    userId: "user-1",
    subscription: { status: "active", access_allowed: true, expires_at: expiresAt },
    entitlements: []
  };

  assert.equal(subscriptionRefreshAt(snapshot), Date.parse(expiresAt));
  assert.equal(isSubscriptionSnapshotFresh(snapshot, "user-1", now), true);
  assert.equal(isSubscriptionSnapshotFresh(snapshot, "user-1", Date.parse(expiresAt) - 1), true);
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
  assert.deepEqual(readSubscriptionSnapshot("user-1", Date.parse("2026-09-15T00:00:00Z"))?.subscription, subscription);
  assert.equal(readSubscriptionSnapshot("user-2", Date.parse("2026-09-15T00:00:00Z")), null);
  assert.equal(readSubscriptionSnapshot("user-1", Date.parse("2026-10-01T00:00:00Z")), null);
  delete globalThis.window;
});

test("terminal states and direct manual access do not create recurring checks", () => {
  const expired = { version: 1, userId: "user-1", subscription: { status: "expired", access_allowed: false }, entitlements: [] };
  const direct = { version: 1, userId: "user-1", subscription: null, entitlements: [{ source_type: "manual", code: "content.premium" }] };

  assert.equal(subscriptionRefreshAt(expired), null);
  assert.equal(isSubscriptionSnapshotFresh(expired, "user-1"), true);
  assert.equal(subscriptionRefreshAt(direct), null);
  assert.equal(isSubscriptionSnapshotFresh(direct, "user-1"), true);
});
