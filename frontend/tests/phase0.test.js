import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ApiError,
  __testing,
  ensureCsrfToken,
  getSessionMarker,
  isApiError,
  onUnauthorized,
  request,
  setSessionMarker
} from "../src/api/client.js";
import { authApi } from "../src/lib/api.js";
import {
  normalizeOperationsSession,
  normalizeSessionResponse,
  normalizeUser
} from "../src/api/contracts.js";
import {
  buildQueryString,
  createPageState,
  generateIdempotencyKey,
  resetPagination
} from "../src/api/pagination.js";
import {
  canAccessRoute,
  hasOperationalCapability,
  hasProductRole
} from "../src/lib/authz.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function setupBrowserState() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  globalThis.document = { cookie: "" };
  __testing.reset();
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
  globalThis.localStorage = originalLocalStorage;
  __testing.reset();
});

test("rejects absolute and boundary-escaping API paths before fetch", async () => {
  setupBrowserState();
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse({});
  };

  await assert.rejects(
    request("https://untrusted.example/session"),
    (error) => isApiError(error) && error.code === "invalid_api_path"
  );
  await assert.rejects(
    request("/../outside"),
    (error) => isApiError(error) && error.code === "invalid_api_path"
  );
  assert.equal(called, false);
});

test("bootstraps CSRF and sends the header only to the internal API path", async () => {
  setupBrowserState();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith("/auth/csrf")) return jsonResponse({ csrf_token: "csrf-value" });
    return jsonResponse({ ok: true });
  };

  const payload = await request("/auth/login", {
    method: "POST",
    body: { email: "student@example.test", password: "safe-password" }
  });

  assert.deepEqual(payload, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/v1/auth/csrf");
  assert.equal(calls[1].url, "/api/v1/auth/login");
  assert.equal(calls[1].options.credentials, "include");
  assert.equal(calls[1].options.headers.get("X-CSRFToken"), "csrf-value");
  assert.equal(calls[1].options.headers.get("Content-Type"), "application/json");
});

test("shares one CSRF bootstrap across concurrent unsafe requests", async () => {
  setupBrowserState();
  let bootstrapCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/auth/csrf")) {
      bootstrapCalls += 1;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 5));
      return jsonResponse({ csrf_token: "shared-csrf-value" });
    }
    return jsonResponse({ ok: true });
  };

  const [first, second] = await Promise.all([
    ensureCsrfToken(),
    ensureCsrfToken()
  ]);

  assert.equal(first, "shared-csrf-value");
  assert.equal(second, "shared-csrf-value");
  assert.equal(bootstrapCalls, 1);
});

test("fails closed when CSRF bootstrap returns no token", async () => {
  setupBrowserState();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ csrf_token: "" });
  };

  await assert.rejects(
    ensureCsrfToken(),
    (error) => isApiError(error) && error.code === "csrf_token_missing"
  );
  assert.equal(calls, 1);
});

test("keeps multipart content type browser-managed and supports 204", async () => {
  setupBrowserState();
  globalThis.document.cookie = "csrftoken=csrf-value";
  let requestOptions;
  globalThis.fetch = async (_url, options = {}) => {
    requestOptions = options;
    return new Response(null, { status: 204 });
  };

  const form = new FormData();
  form.append("file", new Blob(["content"], { type: "text/plain" }), "note.txt");
  const payload = await request("/management/files", { method: "POST", body: form });

  assert.equal(payload, null);
  assert.equal(requestOptions.headers.get("Content-Type"), null);
  assert.equal(requestOptions.headers.get("X-CSRFToken"), "csrf-value");
});

test("preserves Django error envelopes for binary response modes and conflicts", async () => {
  setupBrowserState();
  globalThis.fetch = async () =>
    jsonResponse(
      {
        error: {
          code: "revision_conflict",
          message: "Reload the current server state.",
          fields: { expected_revision: ["This revision is stale."] },
          request_id: "req-409"
        }
      },
      409
    );

  await assert.rejects(
    request("/progress/learning-objects/a", { responseType: "blob" }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "revision_conflict");
      assert.deepEqual(error.fields, { expected_revision: ["This revision is stale."] });
      assert.equal(error.request_id, "req-409");
      return true;
    }
  );
});

test("401 clears only the local marker and notifies React authentication state", async () => {
  setupBrowserState();
  setSessionMarker(true);
  let notices = 0;
  const unsubscribe = onUnauthorized(() => {
    notices += 1;
  });
  globalThis.fetch = async () =>
    jsonResponse(
      {
        error: {
          code: "not_authenticated",
          message: "Authentication credentials were not provided.",
          fields: null,
          request_id: "req-401"
        }
      },
      401
    );

  await assert.rejects(request("/auth/session"), (error) => isApiError(error) && error.status === 401);
  unsubscribe();
  assert.equal(getSessionMarker(), "");
  assert.equal(notices, 1);
});

test("Django's anonymous 403 session response clears the UI marker without treating other 403s as logout", async () => {
  setupBrowserState();
  setSessionMarker(true);
  globalThis.fetch = async () =>
    jsonResponse(
      {
        error: {
          code: "not_authenticated",
          message: "Authentication credentials were not provided.",
          fields: null,
          request_id: "req-anonymous"
        }
      },
      403
    );

  await assert.rejects(authApi.me(), (error) => isApiError(error) && error.status === 403);
  assert.equal(getSessionMarker(), "");
});

test("normalizes Django user and operations-session contracts without conflating them", () => {
  const user = normalizeUser({
    id: "f2bf24a7-d623-4d4b-9f34-c05c8f70f005",
    email: "student@example.test",
    full_name: "Student",
    preferred_language: "en",
    status: "active",
    is_email_verified: true,
    roles: ["student", "creator", "unknown-role"],
    date_joined: "2026-07-20T00:00:00Z"
  });
  const session = normalizeSessionResponse({ user });
  const operations = normalizeOperationsSession({
    roles: ["content_manager"],
    capabilities: ["overview.view", "content.view", "analytics.view"],
    dashboards: ["overview", "content"],
    timezone: "UTC"
  });

  assert.deepEqual(user.roles, ["student", "creator", "unknown-role"]);
  assert.equal(session.authenticated, true);
  assert.equal(hasProductRole(session, "creator"), true);
  assert.equal(hasOperationalCapability(operations, "content.view"), true);
  assert.equal(hasOperationalCapability(operations, "users.view"), false);
  assert.equal(canAccessRoute(session, "/operations/content", operations), true);
  assert.equal(canAccessRoute(session, "/operations/users", operations), false);
  assert.equal(canAccessRoute(session, "/unknown-route", operations), false);
});

test("uses the documented P25 helper and safe idempotency UUID generation", () => {
  assert.equal(buildQueryString({ page: 2, page_size: 25, kinds: ["node", "content"], empty: "" }), "?page=2&page_size=25&kinds=node%2Ccontent");
  assert.deepEqual(createPageState(0, 120), { page: 1, pageSize: 100 });
  assert.deepEqual(resetPagination({ page: 4, pageSize: 50, cursor: "later" }), { page: 1, pageSize: 50, cursor: null });
  assert.match(generateIdempotencyKey(), /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
});

test("PWA configuration has no API runtime caching and the application wires its route guard", async () => {
  const config = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");
  const serviceWorker = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

  assert.equal(config.includes("runtimeCaching"), false);
  assert.equal(config.includes("api-cache"), false);
  assert.equal(serviceWorker.includes("NetworkFirst"), false);
  assert.equal(serviceWorker.includes("api-cache"), false);
  assert.match(serviceWorker, /caches\.delete\(legacyPrivateCacheName\)/);
  assert.match(
    app,
    /<Route element=\{<ProtectedRoute user=\{user\} operationsSession=\{operationsSession\} \/>\}>/
  );
});
