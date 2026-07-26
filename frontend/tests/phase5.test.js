import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { motivationApi } from "../src/api/motivation.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";
import { isKnownNotificationRoute } from "../src/lib/notificationRoutes.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function setup() {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  globalThis.document = { cookie: "csrftoken=csrf-value" };
  __testing.reset();
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
  globalThis.localStorage = originalLocalStorage;
  __testing.reset();
});

test("motivation and notification requests follow Django server-authoritative contracts", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push({ url: address, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, csrf: new Headers(options.headers).get("X-CSRFToken") });
    if (address.endsWith("/progression/xp")) return response({ total_points: 120, ranking_points: 120, transaction_count: 1, level: 1, level_progress: 120, level_target: 500, last_awarded_at: null });
    if (address.startsWith("/api/v1/progression/xp/ledger?")) return response({ count: 1, next: null, previous: null, results: [{ id: "award", points: 50, category: "learning", reason: "Lesson", occurred_at: "2026-01-01T00:00:00Z" }] });
    if (address.endsWith("/progression/streak")) return response({ current_days: 2, longest_days: 3, freeze_tokens_available: 1, policy: { title: "Learning", version: 1, qualifying_activity_types: ["lesson.completed"], grace_days: 1, freeze_tokens_enabled: true } });
    if (address.endsWith("/progression/achievements")) return response([{ code: "first_step", category: "learning", icon_key: "award", title: "First step", description: "Complete one lesson", current_value: 1, target_value: 1, earned_at: "2026-01-01T00:00:00Z" }]);
    if (address.endsWith("/progression/rankings/current")) return response({ definition: null, snapshot: null, entries: [], own_entry: null });
    if (address.endsWith("/progression/rankings/profile") && options.method === "GET") return response({ included: true, display_mode: "initials", updated_at: "2026-01-01T00:00:00Z" });
    if (address.endsWith("/progression/rankings/profile") && options.method === "PUT") return response({ included: false, display_mode: "anonymous", updated_at: "2026-01-02T00:00:00Z" });
    if (address.startsWith("/api/v1/notifications?") && options.method === "GET") return response({ next: "/api/v1/notifications?cursor=next-cursor", previous: null, results: [{ id: "00000000-0000-4000-8000-000000000010", title: "Ready", body: "Open material", has_target: true, read_at: null }] });
    if (address.endsWith("/notifications/summary")) return response({ unread_count: 1 });
    if (address.endsWith("/notifications/00000000-0000-4000-8000-000000000010/read")) return response({ id: "00000000-0000-4000-8000-000000000010", read_at: "2026-01-01T00:00:00Z" });
    if (address.endsWith("/notifications/00000000-0000-4000-8000-000000000010/open")) return response({ route: "/materials" });
    if (address.endsWith("/notifications/read-all")) return response({ updated: 1 });
    if (address.endsWith("/notifications/preferences") && options.method === "GET") return response([{ category: "learning", channel: "in_app", enabled: true, required: false, available: true }]);
    if (address.endsWith("/notifications/preferences") && options.method === "PUT") return response([{ category: "learning", channel: "in_app", enabled: false, required: false, available: true }]);
    throw new Error(`Unexpected request ${options.method} ${address}`);
  };

  await motivationApi.xpSummary();
  await motivationApi.xpLedger({ page: 2, pageSize: 10 });
  await motivationApi.streakSummary();
  await motivationApi.achievements();
  await motivationApi.currentRanking();
  await motivationApi.rankingProfile();
  await motivationApi.updateRankingProfile({ included: false, displayMode: "anonymous" });
  const notifications = await motivationApi.listNotifications({ unreadOnly: true });
  await motivationApi.notificationSummary();
  await motivationApi.markNotificationRead("00000000-0000-4000-8000-000000000010");
  await motivationApi.openNotification("00000000-0000-4000-8000-000000000010");
  await motivationApi.markAllNotificationsRead();
  await motivationApi.notificationPreferences();
  await motivationApi.updateNotificationPreferences([{ category: "learning", channel: "in_app", enabled: false, required: false, available: true }]);

  assert.equal(notifications.nextCursor, "next-cursor");
  assert.deepEqual(calls.map(({ url, method, body }) => ({ url, method, body })), [
    { url: "/api/v1/progression/xp", method: "GET", body: undefined },
    { url: "/api/v1/progression/xp/ledger?page=2&page_size=10", method: "GET", body: undefined },
    { url: "/api/v1/progression/streak", method: "GET", body: undefined },
    { url: "/api/v1/progression/achievements", method: "GET", body: undefined },
    { url: "/api/v1/progression/rankings/current", method: "GET", body: undefined },
    { url: "/api/v1/progression/rankings/profile", method: "GET", body: undefined },
    { url: "/api/v1/progression/rankings/profile", method: "PUT", body: { included: false, display_mode: "anonymous" } },
    { url: "/api/v1/notifications?page_size=30&unread=true", method: "GET", body: undefined },
    { url: "/api/v1/notifications/summary", method: "GET", body: undefined },
    { url: "/api/v1/notifications/00000000-0000-4000-8000-000000000010/read", method: "POST", body: {} },
    { url: "/api/v1/notifications/00000000-0000-4000-8000-000000000010/open", method: "POST", body: {} },
    { url: "/api/v1/notifications/read-all", method: "POST", body: {} },
    { url: "/api/v1/notifications/preferences", method: "GET", body: undefined },
    { url: "/api/v1/notifications/preferences", method: "PUT", body: [{ category: "learning", channel: "in_app", enabled: false }] }
  ]);
  assert.equal(calls.filter((call) => ["POST", "PUT"].includes(call.method)).every((call) => call.csrf === "csrf-value"), true);
});

test("Phase 5 routes use server values and keep unsupported client authority disabled", async () => {
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/notifications"), true);
  assert.equal(canAccessRoute(student, "/progression"), true);
  assert.equal(canAccessRoute(student, "/community/discussions/00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isKnownNotificationRoute("/progression"), true);
  assert.equal(isKnownNotificationRoute("/community/discussions/00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isKnownNotificationRoute("https://untrusted.invalid/"), false);
  assert.equal(isKnownNotificationRoute("/operations/analytics"), false);
  const [app, notifications, layout, progress, achievements, ranked, analytics, worker] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Notifications.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Progress.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Achievements.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Ranked.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Analytics.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/notifications"/);
  assert.match(app, /path="\/progression"/);
  assert.match(app, /path="\/subscription"/);
  assert.match(notifications, /isKnownNotificationRoute/);
  assert.match(notifications, /error\.status === 410/);
  assert.match(layout, /isKnownNotificationRoute/);
  assert.match(layout, /error\.status === 410/);
  assert.match(layout, /motivationApi\.notificationSummary/);
  assert.match(layout, /No consume action is available/);
  assert.match(progress, /motivationApi\.xpLedger/);
  assert.match(achievements, /motivationApi\.achievements/);
  assert.match(ranked, /motivationApi\.updateRankingProfile/);
  assert.doesNotMatch(progress + achievements + ranked + layout, /awardXp|consumeFreeze|xpAwarded|featured\?\.name \|\| "Lina A\."/);
  assert.doesNotMatch(analytics, /operations\/analytics|api\("\/api\/analytics"/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*api/i);
});

test("notification preference validation keeps Django detail text", async () => {
  setup();
  globalThis.fetch = async () => response({ detail: "Required account and billing messages cannot be disabled." }, 400);
  await assert.rejects(
    motivationApi.updateNotificationPreferences([{ category: "account", channel: "in_app", enabled: false }]),
    (error) => error.message === "Required account and billing messages cannot be disabled."
  );
});
