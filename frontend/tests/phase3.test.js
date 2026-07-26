import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assessmentsApi } from "../src/api/assessments.js";
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

test("assessment requests use Django's exact attempt, revision, activity, result, report, and review contracts", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, csrf: new Headers(options.headers).get("X-CSRFToken") });
    if (String(url).startsWith("/api/v1/quizzes?")) return response(page([{ id: "quiz", version: {} }]));
    if (String(url).endsWith("/quizzes/quiz")) return response({ id: "quiz", version: {} });
    if (String(url).endsWith("/quizzes/quiz/attempts")) return response({ resumed: false, attempt: { id: "attempt" } }, 201);
    if (String(url).endsWith("/attempts/attempt") && options.method === "GET") return response({ id: "attempt", questions: [] });
    if (String(url).includes("/questions/question/answer")) return response({ selected_option_ids: ["option"], client_revision: 1, server_revision: 2, saved_at: "2026-01-01T00:00:00Z" });
    if (String(url).endsWith("/attempts/attempt/activities")) return response({ id: "activity", activity_type: "workspace_entered" }, 201);
    if (String(url).endsWith("/attempts/attempt/submit")) return response({ id: "result", released: false });
    if (String(url).endsWith("/assessment-results/result") && options.method === "GET") return response({ id: "result", released: false });
    if (String(url).endsWith("/assessment-results/result/reports")) return response({ id: "report", status: "open" }, 201);
    if (String(url).endsWith("/assessment-review")) return response({ count: 0, results: [] });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  await assessmentsApi.listQuizzes({ nodeId: "node", mode: "practice", page: 2, pageSize: 25 });
  await assessmentsApi.getQuiz("quiz");
  await assessmentsApi.startAttempt("quiz", { idempotencyKey: "00000000-0000-4000-8000-000000000001", questionCount: 5, difficulties: ["easy"], reviewOnly: true });
  await assessmentsApi.getAttempt("attempt");
  await assessmentsApi.saveAnswer("attempt", "question", { selectedOptionIds: ["option"], clientRevision: 1 });
  await assessmentsApi.recordActivity("attempt", { clientEventId: "00000000-0000-4000-8000-000000000002", activityType: "workspace_entered", clientOccurredAt: "2026-01-01T00:00:00.000Z" });
  await assessmentsApi.submitAttempt("attempt", "00000000-0000-4000-8000-000000000003");
  await assessmentsApi.getResult("result");
  await assessmentsApi.reportQuestionIssue("result", { attemptQuestionId: "question", category: "ambiguous", details: "Please review wording." });
  await assessmentsApi.getReviewQueue();

  assert.deepEqual(calls.map(({ url, method, body }) => ({ url, method, body })), [
    { url: "/api/v1/quizzes?node=node&mode=practice&page=2&page_size=25", method: "GET", body: undefined },
    { url: "/api/v1/quizzes/quiz", method: "GET", body: undefined },
    { url: "/api/v1/quizzes/quiz/attempts", method: "POST", body: { idempotency_key: "00000000-0000-4000-8000-000000000001", review_only: true, question_count: 5, difficulties: ["easy"] } },
    { url: "/api/v1/attempts/attempt", method: "GET", body: undefined },
    { url: "/api/v1/attempts/attempt/questions/question/answer", method: "PUT", body: { selected_option_ids: ["option"], client_revision: 1 } },
    { url: "/api/v1/attempts/attempt/activities", method: "POST", body: { client_event_id: "00000000-0000-4000-8000-000000000002", activity_type: "workspace_entered", client_occurred_at: "2026-01-01T00:00:00.000Z", metadata: {} } },
    { url: "/api/v1/attempts/attempt/submit", method: "POST", body: { idempotency_key: "00000000-0000-4000-8000-000000000003" } },
    { url: "/api/v1/assessment-results/result", method: "GET", body: undefined },
    { url: "/api/v1/assessment-results/result/reports", method: "POST", body: { attempt_question_id: "question", category: "ambiguous", details: "Please review wording." } },
    { url: "/api/v1/assessment-review", method: "GET", body: undefined }
  ]);
  assert.equal(calls.find((call) => call.method === "POST").csrf, "csrf-value");
  assert.equal(calls.find((call) => call.method === "PUT").csrf, "csrf-value");
});

test("phase 3 routes are guarded and question/answer leakage is absent from active attempt UI", async () => {
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/questions/quizzes/quiz"), true);
  assert.equal(canAccessRoute(student, "/questions/attempts/attempt"), true);
  assert.equal(canAccessRoute(student, "/questions/results/result"), true);
  assert.equal(canAccessRoute(student, "/questions/attempts/attempt/extra"), false);
  const [app, questions, attempt, result, review, worker] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Questions.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Attempt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/AssessmentResult.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Review.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/questions\/quizzes\/:quizId"/);
  assert.match(app, /path="\/questions\/attempts\/:attemptId"/);
  assert.match(app, /path="\/questions\/results\/:resultId"/);
  assert.doesNotMatch(questions, /\/api\/questions|useQuestionData|QuestionCard/);
  assert.doesNotMatch(attempt, /correct_option_ids|question\.explanation/);
  assert.match(attempt, /error\.fields\?\.current_answer/);
  assert.match(attempt, /error\.code === "attempt_closed"/);
  assert.match(result, /if \(!data\.released\)/);
  assert.match(review, /assessmentsApi\.getReviewQueue/);
  assert.doesNotMatch(review, /\/api\/review|advanced\/mistakes|completeReviewItem/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*api/i);
});
