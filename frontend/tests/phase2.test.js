import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dashboardApi, discoveryApi, educationApi, learningApi } from "../src/api/learning.js";
import { progressApi } from "../src/api/progress.js";
import { studyPlanApi } from "../src/api/studyPlan.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function page(results = []) {
  return { count: results.length, next: null, previous: null, results };
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

test("student discovery, bookmark, and revision-safe progress requests match Django contracts", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, csrf: new Headers(options.headers).get("X-CSRFToken") });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    if (String(url).includes("/education/nodes?")) return response(page([{ id: "node", title: "Anatomy" }]));
    if (String(url).endsWith("/education/nodes/node")) return response({ node: { id: "node" }, breadcrumbs: [] });
    if (String(url).startsWith("/api/v1/learning-objects?")) return response(page([{ id: "object", version: {} }]));
    if (String(url).endsWith("/learning-objects/object")) return response({ id: "object", version: {} });
    if (String(url).startsWith("/api/v1/search?")) return response(page());
    if (String(url).endsWith("/dashboard")) return response({ roles: [], account: { active_sessions: 1 } });
    if (String(url).endsWith("/learning/dashboard")) return response({ bookmark_count: 0, completed_count: 0, recent_content: [], review_due: [] });
    if (String(url).startsWith("/api/v1/progress/resume?")) return response(page());
    if (String(url).startsWith("/api/v1/bookmarks?")) return response(page());
    if (String(url).endsWith("/bookmarks")) return response({ id: "bookmark", learning_object: { id: "object" } }, 201);
    if (String(url).endsWith("/progress/learning-objects/object")) return response({ learning_object_id: "object", revision: 2, completion_percent: 40, position: { page: 3 }, status: "in_progress" });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  await educationApi.listNodes({ parentId: "parent", page: 2, pageSize: 25 });
  await educationApi.getNode("node");
  await learningApi.listLearningObjects({ nodeId: "node", contentType: "pdf", page: 3, pageSize: 25 });
  await learningApi.getLearningObject("object");
  await dashboardApi.accountDashboard();
  await progressApi.learningDashboard();
  await discoveryApi.search({ query: "crown", kinds: ["subject", "learning_object"], contentTypes: ["pdf"], academicPath: "dental", page: 2, pageSize: 25 });
  await progressApi.listResume();
  await progressApi.listBookmarks();
  await progressApi.createBookmark("object");
  await progressApi.removeBookmark("object");
  await progressApi.getLearningObjectProgress("object");
  await progressApi.updateLearningObjectProgress("object", { expectedRevision: 1, status: "in_progress", completionPercent: 40, position: { page: 3 } });

  assert.deepEqual(calls.map(({ url, method, body }) => ({ url, method, body })), [
    { url: "/api/v1/education/nodes?parent=parent&page=2&page_size=25", method: "GET", body: undefined },
    { url: "/api/v1/education/nodes/node", method: "GET", body: undefined },
    { url: "/api/v1/learning-objects?node=node&content_type=pdf&page=3&page_size=25", method: "GET", body: undefined },
    { url: "/api/v1/learning-objects/object", method: "GET", body: undefined },
    { url: "/api/v1/dashboard", method: "GET", body: undefined },
    { url: "/api/v1/learning/dashboard", method: "GET", body: undefined },
    { url: "/api/v1/search?q=crown&kinds=subject%2Clearning_object&content_types=pdf&academic_path=dental&page=2&page_size=25", method: "GET", body: undefined },
    { url: "/api/v1/progress/resume?page=1&page_size=25", method: "GET", body: undefined },
    { url: "/api/v1/bookmarks?page=1&page_size=25", method: "GET", body: undefined },
    { url: "/api/v1/bookmarks", method: "POST", body: { learning_object_id: "object" } },
    { url: "/api/v1/bookmarks/object", method: "DELETE", body: undefined },
    { url: "/api/v1/progress/learning-objects/object", method: "GET", body: undefined },
    { url: "/api/v1/progress/learning-objects/object", method: "PUT", body: { expected_revision: 1, status: "in_progress", completion_percent: 40, position: { page: 3 } } }
  ]);
  assert.equal(calls.find((call) => call.method === "POST").csrf, "csrf-value");
  assert.equal(calls.find((call) => call.method === "PUT").csrf, "csrf-value");
});

test("phase 2 routes use direct server file links and remove fabricated dashboard actions", async () => {
  const [app, dashboard, study, topbar, worker, authz] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/LearningObjectStudy.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/authz.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/materials\/objects\/:learningObjectId"/);
  assert.match(app, /path="\/materials\/:materialId\/sheets\/:sheetId" element=\{<LearningObjectStudy/);
  assert.doesNotMatch(app, /<SheetStudy/);
  assert.match(app, /path="\/search"/);
  assert.match(study, /\^\/api\/v1\/files\//);
  assert.doesNotMatch(study, /request\(/);
  assert.match(app, /path="\/study-plan"/);
  assert.doesNotMatch(dashboard, /Build your study week/);
  assert.doesNotMatch(dashboard, /Focus session|FocusTimerCard/);
  assert.match(dashboard, /getRecentOpenedCatalogSheets\(\)/);
  assert.match(dashboard, /to=\{sheetEntry\.path\}/);
  assert.doesNotMatch(dashboard, /next_item|recent_content|getLastOpenedCatalogSheet/);
  assert.match(topbar, /<GlobalSearch onOpenChange=\{setGlobalSearchOpen\}/);
  assert.match(authz, /"\/search"/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*api/i);
});

test("authenticated student routes include search and the learning-object reader only", () => {
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/search"), true);
  assert.equal(canAccessRoute(student, "/study-plan"), true);
  assert.equal(canAccessRoute(student, "/materials/objects/object-id"), true);
  assert.equal(canAccessRoute(student, "/materials/node-id/sheets/sheet-id"), true);
  assert.equal(canAccessRoute(student, "/materials/objects/object-id/extra"), false);
});

test("study plan requests use the authenticated Django API", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    if (options.method === "GET") return response({ count: 0, summary: {}, results: [] });
    return response({ id: "task", title: "Review anatomy" }, options.method === "POST" ? 201 : 200);
  };

  await studyPlanApi.getPlan({ from: "2026-08-17", to: "2026-08-23" });
  await studyPlanApi.createItem({ title: "Review anatomy", subject: "Anatomy", scheduledDate: "2026-08-22", durationMinutes: 25 });
  await studyPlanApi.updateItem("task", { status: "completed" });
  await studyPlanApi.deleteItem("task");

  assert.deepEqual(calls, [
    { url: "/api/v1/study-plan?from=2026-08-17&to=2026-08-23", method: "GET", body: undefined },
    { url: "/api/v1/study-plan/items", method: "POST", body: { title: "Review anatomy", subject: "Anatomy", scheduled_date: "2026-08-22", duration_minutes: 25 } },
    { url: "/api/v1/study-plan/items/task", method: "PATCH", body: { status: "completed" } },
    { url: "/api/v1/study-plan/items/task", method: "DELETE", body: undefined }
  ]);
});
