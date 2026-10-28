import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, request, onUnauthorized, __testing as client } from "../src/api/client.js";
import { __testing as connection } from "../src/lib/connectionState.js";
import { errorCopy, localSaveError, offlineOperationMessage, userErrorMessage, userFieldErrors } from "../src/lib/userErrors.js";

const originalFetch = globalThis.fetch;
test.beforeEach(() => { client.reset(); connection.reset(); });
test.afterEach(() => { globalThis.fetch = originalFetch; client.reset(); connection.reset(); });

test("the request deadline covers a body stalled after successful headers", async () => {
  let finish;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await assert.rejects(request("/auth/session", { timeoutMs: 15 }), error => error.code === "timeout");
  } finally { finish?.({ ok: true }); }
});

test("the request deadline covers CSRF preparation without sending the write", async () => {
  let release;
  const paths = [];
  globalThis.fetch = async path => {
    paths.push(path);
    return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({ csrf_token: "test-only" }))); });
  };
  try {
    await assert.rejects(request("/study-plan/profile", { method: "POST", body: {}, timeoutMs: 15 }), error => error.code === "timeout" && error.requestSent === false);
    assert.deepEqual(paths, ["/api/v1/auth/csrf"]);
  } finally { release?.(); await new Promise(resolve => setTimeout(resolve, 0)); }
});

test("cancelling one writer does not cancel another writer's shared CSRF bootstrap", async () => {
  let release;
  let bootstraps = 0;
  const writes = [];
  globalThis.fetch = async path => {
    if (path.endsWith("/auth/csrf")) {
      bootstraps++;
      return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({ csrf_token: "test-only" }))); });
    }
    writes.push(path);
    return new Response(JSON.stringify({ ok: true }));
  };
  const controller = new AbortController();
  const first = request("/first", { method: "POST", body: {}, signal: controller.signal });
  const second = request("/second", { method: "POST", body: {} });
  controller.abort();
  await assert.rejects(first, error => error.code === "aborted");
  release();
  assert.deepEqual(await second, { ok: true });
  assert.equal(bootstraps, 1);
  assert.deepEqual(writes, ["/api/v1/second"]);
});

test("malformed success JSON is an explicit error while 204 remains a valid empty result", async () => {
  globalThis.fetch = async () => new Response("{broken", { status: 200 });
  await assert.rejects(request("/auth/session"), error => error.code === "invalid_response");
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await request("/auth/session"), null);
});

test("a lost write response is uncertain and is not automatically repeated", async () => {
  let writes = 0;
  globalThis.fetch = async path => {
    if (path.endsWith("/auth/csrf")) return new Response(JSON.stringify({ csrf_token: "test-only" }));
    writes++;
    return new Response("not-json", { status: 200 });
  };
  await assert.rejects(request("/payments/intents", { method: "POST", body: {} }), error => {
    assert.equal(error.code, "invalid_response");
    assert.equal(error.requestSent, true);
    assert.equal(error.message, errorCopy("uncertain", "en"));
    assert.equal(userErrorMessage(error, { locale: "ar" }), errorCopy("uncertain", "ar"));
    return true;
  });
  assert.equal(writes, 1);
});

test("Retry-After seconds and HTTP dates survive with the request reference", async () => {
  for (const value of ["4", new Date(Date.now() + 60_000).toUTCString()]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "throttled", message: "Slow down", request_id: "safe-ref" } }), { status: 429, headers: { "content-type": "application/json", "Retry-After": value } });
    await assert.rejects(request("/auth/session"), error => {
      assert.equal(error.request_id, "safe-ref");
      assert.ok(error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 60);
      assert.ok(error.retryAt > Date.now());
      return true;
    });
  }
});

test("field details replace the placeholder and preserve machine codes", () => {
  const error = new ApiError(400, { error: { code: "invalid", message: "The request could not be completed.", fields: { timezone: ["Choose a valid timezone."] }, field_codes: { timezone: ["invalid_timezone"] } } }, "Request failed");
  assert.equal(error.message, "Timezone: Choose a valid timezone.");
  assert.deepEqual(userFieldErrors(error, "ar").map(item => item.message), [errorCopy("timezone", "ar")]);
  assert.equal(userErrorMessage(error, { locale: "ar" }), `المنطقة الزمنية: ${errorCopy("timezone", "ar")}`);
});

test("permission failures never become subscription expiry or a network claim", () => {
  assert.equal(userErrorMessage({ status: 403, code: "permission_denied" }, { locale: "ar" }), errorCopy("forbidden", "ar"));
  assert.equal(userErrorMessage({ status: 403, code: "not_authenticated" }, { locale: "ar" }), errorCopy("signIn", "ar"));
});

test("storage failures distinguish a full quota, blocked storage and unknown causes", () => {
  assert.equal(localSaveError({ name: "QuotaExceededError" }, "ar"), errorCopy("quota", "ar"));
  assert.equal(localSaveError({ name: "SecurityError" }, "ar"), errorCopy("storageBlocked", "ar"));
  assert.equal(localSaveError(new Error("private internal path"), "ar"), errorCopy("storage", "ar"));
});

test("legacy technical offline reasons are hidden and structured field reasons are translated", () => {
  assert.equal(offlineOperationMessage({ code: "rejected", reason: "{'choice_ids': [ErrorDetail(string='private', code='invalid')]}" }, "ar"), errorCopy("syncRejected", "ar"));
  const operation = { code: "rejected", fields: { duration_minutes: ["A day can contain at most 480 minutes and 48 sessions."] }, field_codes: { duration_minutes: ["day_limit_exceeded"] } };
  assert.equal(offlineOperationMessage(operation, "ar"), `مدة الجلسة: ${errorCopy("dayLimit", "ar")}`);
});


test("gateway errors keep a safe header reference even when the body is HTML", async () => {
  globalThis.fetch = async () => new Response("<html>gateway</html>", { status: 502, headers: { "Content-Type": "text/html", "X-Request-ID": "gateway-ref" } });
  await assert.rejects(request("/auth/session"), error => error.request_id === "gateway-ref" && !error.message.includes("<html>"));
});

test("CSRF denial is distinguished from permission denial and field bounds remain precise", () => {
  assert.equal(userErrorMessage({ status: 403, code: "permission_denied", rawMessage: "CSRF Failed: check failed" }, { locale: "ar" }), errorCopy("secureSession", "ar"));
  const fields = userFieldErrors({ fields: { duration_minutes: ["Ensure this value is greater than or equal to 5."] }, field_codes: { duration_minutes: ["min_value"] } }, "ar");
  assert.match(fields[0].message, /5/);
  assert.match(fields[0].message, /لا تقل/);
});


test("a malformed 401 error body still notifies session expiry", async () => {
  let ended = 0;
  const stop = onUnauthorized(() => ended++);
  globalThis.fetch = async () => new Response("{broken", { status: 401, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(request("/auth/session"), error => error.status === 401);
    assert.equal(ended, 1);
  } finally { stop(); }
});

test("a malformed 429 error body still keeps its retry and support headers", async () => {
  globalThis.fetch = async () => new Response("{broken", { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "5", "X-Request-ID": "rate-reference" } });
  await assert.rejects(request("/auth/session"), error => error.status === 429 && error.retryAfterSeconds === 5 && error.request_id === "rate-reference");
});
