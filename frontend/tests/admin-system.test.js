import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adminControlApi } from "../src/api/adminControl.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";

const USER_ID = "00000000-0000-4000-8000-000000000301";
const PAYMENT_ID = "00000000-0000-4000-8000-000000000302";
const SUBSCRIPTION_ID = "00000000-0000-4000-8000-000000000303";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000304";

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

test("admin-control client uses only Django paths, CSRF, pagination, and idempotent mutations", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method: options.method, body, csrf: headers.get("X-CSRFToken"), idempotency: headers.get("Idempotency-Key") });
    if (String(url).includes("/purchases?")) return response({ count: 0, next: null, previous: null, results: [] });
    if (String(url).includes("/subscriptions?")) return response({ count: 0, next: null, previous: null, results: [] });
    if (String(url).endsWith("/refunds")) return response({ id: "refund" }, 201);
    if (String(url).endsWith("/actions")) return response({ id: SUBSCRIPTION_ID, status: "suspended" });
    if (String(url).endsWith("/dispatch")) return response({ id: CAMPAIGN_ID, status: "completed" });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  await adminControlApi.purchases({ page: 2, pageSize: 25, query: "student@example.test", status: "succeeded" });
  await adminControlApi.subscriptions({ page: 1, pageSize: 25, query: "student@example.test", status: "active" });
  await adminControlApi.refund(PAYMENT_ID, { amountMinor: 1500, refundReason: "Verified duplicate payment." });
  await adminControlApi.subscriptionAction(SUBSCRIPTION_ID, { action: "suspend", reason: "Verified account access issue." });
  await adminControlApi.dispatchCampaign(CAMPAIGN_ID, "Send the approved operational notice.");

  assert.equal(calls[0].url, "/api/v1/operations/admin/purchases?page=2&page_size=25&q=student%40example.test&status=succeeded");
  assert.equal(calls[1].url, "/api/v1/operations/admin/subscriptions?page=1&page_size=25&q=student%40example.test&status=active");
  assert.deepEqual(calls[2].body, { amount_minor: 1500, reason: "Verified duplicate payment." });
  assert.deepEqual(calls[3].body, { action: "suspend", reason: "Verified account access issue." });
  assert.deepEqual(calls[4].body, { reason: "Send the approved operational notice." });
  assert.equal(calls.slice(2).every((call) => call.csrf === "csrf-value"), true);
  assert.match(calls[2].idempotency, /^[\da-f-]{36}$/i);
  assert.match(calls[3].idempotency, /^[\da-f-]{36}$/i);
  assert.equal(calls[4].idempotency, null);
});

test("operations console navigation fails closed without the overview capability", () => {
  const user = { id: USER_ID, roles: ["student"] };
  assert.equal(canAccessRoute(user, "/operations/admin/overview", { capabilities: ["users.view"] }), false);
  assert.equal(canAccessRoute(user, "/operations/admin/overview", { capabilities: ["overview.view"] }), true);
});

test("Creator Studio follows the shared hidden visual-page-heading default", async () => {
  const [pageComponent, operationsPage] = await Promise.all([
    readFile(new URL("../src/components/ui/index.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/OperationsAdmin.jsx", import.meta.url), "utf8")
  ]);

  assert.match(pageComponent, /showHeading\s*=\s*false/);
  assert.match(pageComponent, /showHeading\s*&&\s*<header className="section-heading">/);
  assert.match(operationsPage, /<Page title="Creator Studio" showHeading=\{false\}>/);
  assert.doesNotMatch(operationsPage, /Creator Studio" subtitle=/);
});

test("student directory filters stay server-side", async () => {
  setup();
  let calledUrl = "";
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return response({ count: 0, next: null, previous: null, results: [] });
  };

  await adminControlApi.users({ query: "founder", status: "active", role: "creator", ordering: "full_name" });

  assert.equal(calledUrl, "/api/v1/operations/users?page=1&page_size=25&q=founder&status=active&role=creator&ordering=full_name");
});

test("configuration changes use Django's versioned PATCH contract and content access remains capability-gated", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
    return response({ key: "platform.maintenance_mode", value: true, version: 2 });
  };

  await adminControlApi.updateConfiguration("platform.maintenance_mode", {
    value: true,
    expectedVersion: 1,
    changeReason: "Schedule a verified maintenance window."
  });

  assert.deepEqual(calls[0], {
    url: "/api/v1/operations/configuration/platform.maintenance_mode",
    method: "PATCH",
    body: { value: true, expected_version: 1, reason: "Schedule a verified maintenance window." }
  });
  const user = { id: USER_ID, roles: ["student"] };
  assert.equal(canAccessRoute(user, "/creator/content", { capabilities: ["content.manage"] }), true);
  assert.equal(canAccessRoute(user, "/creator/content", { capabilities: ["assessments.view"] }), false);
});
