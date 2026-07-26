import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { communityApi, moderationApi } from "../src/api/community.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";

const DISCUSSION_ID = "00000000-0000-4000-8000-000000000101";
const COMMENT_ID = "00000000-0000-4000-8000-000000000102";
const SPACE_ID = "00000000-0000-4000-8000-000000000103";
const MEMBER_ID = "00000000-0000-4000-8000-000000000104";
const CONTEXT_ID = "00000000-0000-4000-8000-000000000105";
const REPORT_ID = "00000000-0000-4000-8000-000000000106";
const REQUEST_ID = "00000000-0000-4000-8000-000000000107";

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

test("Phase 6 community and reporter requests use Django's exact contextual contracts", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: address, method: options.method, body, csrf: new Headers(options.headers).get("X-CSRFToken") });
    if (address.endsWith("/community/discussions") && options.method === "POST") return response({ id: DISCUSSION_ID, revision: 1 }, 201);
    if (address.startsWith("/api/v1/community/discussions?")) return response({ next: "/api/v1/community/discussions?cursor=discussion-next", previous: null, results: [{ id: DISCUSSION_ID }] });
    if (address.endsWith(`/community/discussions/${DISCUSSION_ID}`)) return response({ id: DISCUSSION_ID, revision: 2 });
    if (address.startsWith(`/api/v1/community/discussions/${DISCUSSION_ID}/comments?`)) return response({ next: `/api/v1/community/discussions/${DISCUSSION_ID}/comments?cursor=comment-next`, previous: null, results: [{ id: COMMENT_ID }] });
    if (address.endsWith(`/community/discussions/${DISCUSSION_ID}/comments`)) return response({ id: COMMENT_ID, revision: 1 });
    if (address.endsWith(`/community/comments/${COMMENT_ID}`)) return response({ id: COMMENT_ID, revision: 2 });
    if (address.startsWith("/api/v1/community/spaces?")) return response({ next: "/api/v1/community/spaces?cursor=space-next", previous: null, results: [{ id: SPACE_ID }] });
    if (address.endsWith(`/community/spaces/${SPACE_ID}`)) return response({ id: SPACE_ID, can_manage: true });
    if (address.endsWith("/community/spaces")) return response({ id: SPACE_ID });
    if (address.endsWith(`/community/spaces/${SPACE_ID}/members`)) return response({ user_id: MEMBER_ID, role: "member", status: "active" }, 201);
    if (address.endsWith(`/community/spaces/${SPACE_ID}/members/${MEMBER_ID}`)) return response({ user_id: MEMBER_ID, role: "member", status: "revoked" });
    if (address.startsWith("/api/v1/moderation/reports?")) return response({ next: "/api/v1/moderation/reports?cursor=report-next", previous: null, results: [{ id: REPORT_ID }] });
    if (address.endsWith(`/moderation/reports/${REPORT_ID}`)) return response({ id: REPORT_ID, status: "open" });
    if (address.endsWith("/moderation/reports")) return response({ id: REPORT_ID, status: "open" }, 201);
    throw new Error(`Unexpected request ${options.method} ${address}`);
  };

  const discussions = await communityApi.listDiscussions({ contextType: "lesson", contextId: CONTEXT_ID, spaceId: SPACE_ID, cursor: "cursor", pageSize: 20 });
  await communityApi.getDiscussion(DISCUSSION_ID);
  await communityApi.createDiscussion({ contextType: "lesson", contextId: CONTEXT_ID, spaceId: SPACE_ID, title: "A contextual question", body: "Please explain this learning context.", clientRequestId: REQUEST_ID });
  await communityApi.updateDiscussion(DISCUSSION_ID, { expectedRevision: 2, title: "Updated question", body: "Updated contextual body." });
  await communityApi.deleteDiscussion(DISCUSSION_ID, 3);
  const comments = await communityApi.listComments(DISCUSSION_ID);
  await communityApi.createComment(DISCUSSION_ID, { parentId: COMMENT_ID, body: "A contextual reply.", clientRequestId: REQUEST_ID });
  await communityApi.updateComment(COMMENT_ID, { expectedRevision: 1, body: "Updated reply." });
  await communityApi.deleteComment(COMMENT_ID, 2);
  const spaces = await communityApi.listSpaces();
  await communityApi.getSpace(SPACE_ID);
  await communityApi.createSpace({ contextType: "lesson", contextId: CONTEXT_ID, title: "Lesson space", description: "Creator-led discussion." });
  await communityApi.addSpaceMember(SPACE_ID, { email: "student@example.test", role: "member" });
  await communityApi.removeSpaceMember(SPACE_ID, MEMBER_ID);
  const reports = await moderationApi.listReports({ status: "open", targetType: "discussion", assignment: "mine" });
  await moderationApi.getReport(REPORT_ID);
  await moderationApi.createReport({ targetType: "discussion", targetId: DISCUSSION_ID, reason: "spam", description: "This contextual description has enough detail.", clientRequestId: REQUEST_ID });

  assert.equal(discussions.nextCursor, "discussion-next");
  assert.equal(comments.nextCursor, "comment-next");
  assert.equal(spaces.nextCursor, "space-next");
  assert.equal(reports.nextCursor, "report-next");
  assert.deepEqual(calls.map(({ url, method, body }) => ({ url, method, body })), [
    { url: `/api/v1/community/discussions?context_type=lesson&context_id=${CONTEXT_ID}&space_id=${SPACE_ID}&cursor=cursor&page_size=20`, method: "GET", body: undefined },
    { url: `/api/v1/community/discussions/${DISCUSSION_ID}`, method: "GET", body: undefined },
    { url: "/api/v1/community/discussions", method: "POST", body: { context_type: "lesson", context_id: CONTEXT_ID, space_id: SPACE_ID, title: "A contextual question", body: "Please explain this learning context.", client_request_id: REQUEST_ID } },
    { url: `/api/v1/community/discussions/${DISCUSSION_ID}`, method: "PATCH", body: { expected_revision: 2, title: "Updated question", body: "Updated contextual body." } },
    { url: `/api/v1/community/discussions/${DISCUSSION_ID}`, method: "DELETE", body: { expected_revision: 3 } },
    { url: `/api/v1/community/discussions/${DISCUSSION_ID}/comments?page_size=40`, method: "GET", body: undefined },
    { url: `/api/v1/community/discussions/${DISCUSSION_ID}/comments`, method: "POST", body: { parent_id: COMMENT_ID, body: "A contextual reply.", client_request_id: REQUEST_ID } },
    { url: `/api/v1/community/comments/${COMMENT_ID}`, method: "PATCH", body: { expected_revision: 1, body: "Updated reply." } },
    { url: `/api/v1/community/comments/${COMMENT_ID}`, method: "DELETE", body: { expected_revision: 2 } },
    { url: "/api/v1/community/spaces?page_size=20", method: "GET", body: undefined },
    { url: `/api/v1/community/spaces/${SPACE_ID}`, method: "GET", body: undefined },
    { url: "/api/v1/community/spaces", method: "POST", body: { context_type: "lesson", context_id: CONTEXT_ID, title: "Lesson space", description: "Creator-led discussion." } },
    { url: `/api/v1/community/spaces/${SPACE_ID}/members`, method: "POST", body: { email: "student@example.test", role: "member" } },
    { url: `/api/v1/community/spaces/${SPACE_ID}/members/${MEMBER_ID}`, method: "DELETE", body: {} },
    { url: "/api/v1/moderation/reports?status=open&target_type=discussion&assignment=mine&page_size=20", method: "GET", body: undefined },
    { url: `/api/v1/moderation/reports/${REPORT_ID}`, method: "GET", body: undefined },
    { url: "/api/v1/moderation/reports", method: "POST", body: { target_type: "discussion", target_id: DISCUSSION_ID, reason: "spam", description: "This contextual description has enough detail.", client_request_id: REQUEST_ID } }
  ]);
  assert.equal(calls.filter((call) => ["POST", "PATCH", "DELETE"].includes(call.method)).every((call) => call.csrf === "csrf-value"), true);
});

test("Phase 6 rejects incomplete contexts, invalid identifiers, and unrecognized community routes", async () => {
  setup();
  await assert.rejects(
    communityApi.listDiscussions({ contextType: "lesson" }),
    (error) => error.code === "invalid_request"
  );
  await assert.rejects(
    communityApi.getDiscussion("https://untrusted.invalid/anything"),
    (error) => error.code === "invalid_request"
  );
  await assert.rejects(
    communityApi.addSpaceMember(SPACE_ID, { email: "student@example.test", userId: MEMBER_ID, role: "member" }),
    (error) => error.code === "invalid_request"
  );
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, `/community/discussions/${DISCUSSION_ID}`), true);
  assert.equal(canAccessRoute(student, `/community/spaces/${SPACE_ID}`), true);
  assert.equal(canAccessRoute(student, `/community/reports/${REPORT_ID}`), true);
  assert.equal(canAccessRoute(student, `/community/context/quiz/${CONTEXT_ID}`), true);
  assert.equal(canAccessRoute(student, `/community/context/unknown/${CONTEXT_ID}`), false);
  assert.equal(canAccessRoute(student, "/community/unrelated"), false);
});

test("Phase 6 screens remove generic fake community data and keep reporting non-moderatorial", async () => {
  const [community, discussion, space, report, app] = await Promise.all([
    readFile(new URL("../src/pages/Community.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Discussion.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunitySpace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CommunityReport.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8")
  ]);
  assert.match(community, /communityApi\.listDiscussions/);
  assert.match(community, /import \{[^}]*DiscussionComposer[^}]*\} from "\.\.\/components\/community\/index\.jsx"/);
  assert.match(discussion, /expectedRevision/);
  assert.match(discussion, /clientRequestId/);
  assert.match(discussion, /ReportComposer/);
  assert.match(space, /space\.can_manage/);
  assert.match(report, /does not display moderation evidence or moderation controls/);
  assert.match(app, /path="\/community\/context\/:contextType\/:contextId"/);
  assert.doesNotMatch(community + discussion + space, /api\(\s*["']\/api\/community|post\.likes|Doctor Announcements/);
  assert.doesNotMatch(report, /evidence_snapshot|transition|assign/);
});
