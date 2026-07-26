import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { accountsApi } from "../src/api/accounts.js";
import { __testing, getSessionMarker, setSessionMarker } from "../src/api/client.js";

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

test("registration uses Django's exact public contract and never sends a role", async () => {
  setup();
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return response({ status: "verification_required" }, 201);
  };
  await accountsApi.register({ fullName: "New Student", email: "new@example.test", password: "safe", passwordConfirm: "safe", preferredLanguage: "ar", acceptPolicies: true });
  assert.deepEqual(sent, { full_name: "New Student", email: "new@example.test", password: "safe", password_confirm: "safe", preferred_language: "ar", accept_policies: true });
  assert.equal("roles" in sent, false);
});

test("profile, email, password, verification-token and session actions use exact account request fields", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, body: options.body && JSON.parse(options.body), method: options.method });
    if (url === "/api/v1/account/profile") return response({ user: { id: "a", email: "a@example.test", full_name: "A", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: null } });
    if (url === "/api/v1/account/sessions") return response({ sessions: [{ id: "session-id", device_label: "Browser on Computer", created_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-01T00:00:00Z", expires_at: "2026-02-01T00:00:00Z", is_current: true }] });
    if (url === "/api/v1/account/sessions/session-id") return new Response(null, { status: 204 });
    return response({ status: "accepted" });
  };
  await accountsApi.updateProfile({ fullName: "A", preferredLanguage: "en" });
  await accountsApi.changePassword("old", "new", "new");
  await accountsApi.requestEmailChange("next@example.test", "old");
  await accountsApi.confirmPasswordReset("one-time", "new", "new");
  await accountsApi.verifyEmail("verify-once");
  await accountsApi.resendVerification("a@example.test");
  await accountsApi.confirmEmailChange("confirm-once");
  const sessions = await accountsApi.listSessions();
  await accountsApi.revokeSession("session-id");
  assert.equal(sessions[0].is_current, true);
  assert.deepEqual(calls, [
    { url: "/api/v1/account/profile", method: "PATCH", body: { full_name: "A", preferred_language: "en" } },
    { url: "/api/v1/account/password", method: "POST", body: { current_password: "old", new_password: "new", new_password_confirm: "new" } },
    { url: "/api/v1/account/email", method: "POST", body: { new_email: "next@example.test", current_password: "old" } },
    { url: "/api/v1/auth/password-reset/confirm", method: "POST", body: { token: "one-time", new_password: "new", new_password_confirm: "new" } },
    { url: "/api/v1/auth/verify-email", method: "POST", body: { token: "verify-once" } },
    { url: "/api/v1/auth/resend-verification", method: "POST", body: { email: "a@example.test" } },
    { url: "/api/v1/account/email/confirm", method: "POST", body: { token: "confirm-once" } },
    { url: "/api/v1/account/sessions", method: "GET", body: undefined },
    { url: "/api/v1/account/sessions/session-id", method: "DELETE", body: undefined }
  ]);
});

test("anonymous Django session 403 clears only the local UI marker", async () => {
  setup();
  setSessionMarker(true);
  globalThis.fetch = async () => response({ error: { code: "not_authenticated", message: "Authentication credentials were not provided.", fields: null, request_id: "req" } }, 403);
  await assert.rejects(accountsApi.currentSession());
  assert.equal(getSessionMarker(), "");
});

test("account token routes and direct privileged-route guards are attached to the live app", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /"\/verify-email", "\/confirm-email", "\/reset-password"/);
  assert.match(app, /path="\/admin\/\*"/);
  assert.match(app, /path="\/operations\/\*"/);
  assert.match(app, /onSignedOut=\{clearAuthenticatedUi\}/);
});

test("student dashboard follows the shared hidden visual-page-heading default and retains its document title", async () => {
  const [dashboard, pageComponent] = await Promise.all([
    readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/index.jsx", import.meta.url), "utf8")
  ]);

  assert.match(dashboard, /<Page title="Dashboard" showHeading=\{false\}>/);
  assert.doesNotMatch(dashboard, /title="Dashboard" subtitle=/);
  assert.match(pageComponent, /showHeading\s*=\s*false/);
  assert.match(pageComponent, /usePageTitle\(title\)/);
});
