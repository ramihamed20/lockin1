import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { focusApi } from "../src/api/focus.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";

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

test("Focus requests use Django's entitlement, workspace revision, and annotation-sync contracts", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: options.body ? JSON.parse(options.body) : undefined, csrf: new Headers(options.headers).get("X-CSRFToken") });
    if (String(url).endsWith("/focus/documents/version")) return response({ document: { document_version_id: "version", view_url: "/api/v1/files/file/view" }, annotation_revision: 0, latest_workspace: null, summary: {} });
    if (String(url).startsWith("/api/v1/focus/sessions?")) return response({ count: 0, next: null, previous: null, results: [] });
    if (String(url).endsWith("/focus/sessions") && options.method === "POST") return response({ id: "session", status: "active", workspace: { revision: 1 } }, 201);
    if (String(url).endsWith("/focus/sessions/session/pause")) return response({ id: "session", status: "paused", workspace: { revision: 1 } });
    if (String(url).endsWith("/focus/sessions/session/workspace")) return response({ session_id: "session", revision: 2, current_page: 5 });
    if (String(url).includes("/focus/documents/version/annotations") && options.method === "GET") return response({ collection_revision: 0, count: 0, next: null, previous: null, results: [] });
    if (String(url).endsWith("/focus/documents/version/annotations") && options.method === "POST") return response({ collection_revision: 1, saved_at: "2026-01-01T00:00:00Z", annotations: [], deleted_ids: [], replayed: false });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  await focusApi.getDocument("version");
  await focusApi.listSessions({ page: 2, pageSize: 10 });
  await focusApi.startSession({ documentVersionId: "version", clientInstanceId: "00000000-0000-4000-8000-000000000001" });
  await focusApi.sessionAction("session", "pause");
  await focusApi.updateWorkspace("session", { expectedRevision: 1, currentPage: 5, pageCount: 120, zoom: 1.5, sidebar: "thumbnails", activeTool: "highlighter", layout: { toolbar_collapsed: false, reading_direction: "vertical" }, openTabs: ["version"] });
  const annotations = await focusApi.getAnnotations("version", { pages: [1, 2], page: 2, pageSize: 250 });
  await focusApi.syncAnnotations("version", { expectedCollectionRevision: 0, idempotencyKey: "00000000-0000-4000-8000-000000000002", annotations: [], deletedIds: [] });

  assert.equal(annotations.collection_revision, 0);
  assert.deepEqual(calls.map(({ url, method, body }) => ({ url, method, body })), [
    { url: "/api/v1/focus/documents/version", method: "GET", body: undefined },
    { url: "/api/v1/focus/sessions?page=2&page_size=10", method: "GET", body: undefined },
    { url: "/api/v1/focus/sessions", method: "POST", body: { document_version_id: "version", client_instance_id: "00000000-0000-4000-8000-000000000001" } },
    { url: "/api/v1/focus/sessions/session/pause", method: "POST", body: {} },
    { url: "/api/v1/focus/sessions/session/workspace", method: "PATCH", body: { expected_revision: 1, current_page: 5, zoom: 1.5, sidebar: "thumbnails", active_tool: "highlighter", layout: { toolbar_collapsed: false, reading_direction: "vertical" }, open_tabs: ["version"], page_count: 120 } },
    { url: "/api/v1/focus/documents/version/annotations?pages=1%2C2&page=2&page_size=250", method: "GET", body: undefined },
    { url: "/api/v1/focus/documents/version/annotations", method: "POST", body: { expected_collection_revision: 0, idempotency_key: "00000000-0000-4000-8000-000000000002", annotations: [], deleted_ids: [] } }
  ]);
  assert.equal(calls.filter((call) => ["POST", "PATCH"].includes(call.method)).every((call) => call.csrf === "csrf-value"), true);
});

test("Focus is authenticated-route guarded, uses the real route, and does not introduce a private-data cache", async () => {
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/focus/version"), true);
  assert.equal(canAccessRoute(student, "/focus/version/extra"), false);
  const [app, learningObject, workspace, worker] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/LearningObjectStudy.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/FocusWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/focus\/:documentVersionId"/);
  assert.match(learningObject, /focus_context/);
  assert.match(workspace, /focusApi\.syncAnnotations/);
  assert.match(workspace, /expectedCollectionRevision/);
  assert.match(workspace, /action === "complete" \|\| action === "abandon"/);
  assert.match(workspace, /const annotationsSaved = await syncAnnotations\(\);\s*if \(!annotationsSaved\) return;/);
  assert.doesNotMatch(workspace, /\/api\/sheets|xpAwarded|correctAnswer/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*api/i);
});
