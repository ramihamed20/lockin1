import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { reviewApi } from "../src/api/review.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

test("authenticated students can access every Review Bank route", () => {
  const student = { id: "student-1", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/review"), true);
  assert.equal(canAccessRoute(student, "/review/bank"), true);
  assert.equal(canAccessRoute(student, "/review/bank/oral-histology"), true);
  assert.equal(canAccessRoute(student, "/review/weekly"), true);
  assert.equal(canAccessRoute(student, "/review/weekly/extra"), false);
});

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

test("Review Bank client uses centralized owned endpoints and idempotent answers", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: String(url), method: options.method, body, csrf: new Headers(options.headers).get("X-CSRFToken") });
    if (String(url).endsWith("/review-queue")) return response({ count: 0, results: [] });
    if (String(url).endsWith("/review-bank")) return response({ active_count: 0, mastered_this_week: 0, subjects: [] });
    if (String(url).includes("/review-bank/subjects/")) return response({ count: 0, results: [] });
    if (String(url).includes("/review-bank/items/")) return response({ was_correct: true, review_item: {} });
    if (String(url).endsWith("/question-attempts")) return response({ mistake_recorded: true, created: true }, 201);
    if (String(url).endsWith("/weekly-recall") && options.method === "GET") return response({ available: false, session: null });
    if (String(url).endsWith("/weekly-recall") && options.method === "POST") return response({ available: true, session: { id: "weekly" } }, 201);
    if (String(url).includes("/weekly-recall/weekly/questions/question/answer")) return response({ was_correct: true, session: { id: "weekly" } });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  await reviewApi.getQueue();
  await reviewApi.getBank();
  await reviewApi.getSubject("catalog:oral-pathology");
  await reviewApi.answerItem("item", { selectedOptionIds: ["b"], idempotencyKey: "answer-key" });
  await reviewApi.trackAttempt({
    idempotencyKey: "attempt-key",
    questionKey: "question",
    subjectKey: "subject",
    subjectLabel: "Subject",
    sourceType: "sheet",
    sourceId: "sheet",
    sourceLabel: "Sheet 1",
    sourceQuestionIndex: 1,
    prompt: "Prompt",
    options: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    selectedOptionIds: ["a"],
    correctOptionIds: ["b"]
  });
  await reviewApi.getWeeklyRecall();
  await reviewApi.startWeeklyRecall();
  await reviewApi.answerWeeklyRecall("weekly", "question", { selectedOptionIds: ["b"], idempotencyKey: "weekly-key" });

  assert.equal(calls.filter((call) => call.method === "POST").every((call) => call.csrf === "csrf-value"), true);
  assert.deepEqual(calls.map((call) => call.url), [
    "/api/v1/review-queue",
    "/api/v1/review-bank",
    "/api/v1/review-bank/subjects/catalog%3Aoral-pathology",
    "/api/v1/review-bank/items/item/answer",
    "/api/v1/question-attempts",
    "/api/v1/weekly-recall",
    "/api/v1/weekly-recall",
    "/api/v1/weekly-recall/weekly/questions/question/answer"
  ]);
  assert.deepEqual(calls[3].body, { selected_option_ids: ["b"], idempotency_key: "answer-key" });
  assert.equal(calls[4].body.question_key, "question");
  assert.equal(calls[4].body.source_question_index, 1);
});

test("Review surfaces expose latest four, subject sessions, recall, loading, and accessible answer states", async () => {
  const [review, dashboard, questions, app, styles, catalogue] = await Promise.all([
    readFile(new URL("../src/pages/Review.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Questions.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8")
  ]);
  assert.match(dashboard, /items\.slice\(0, 4\)/);
  assert.match(review, /t\("review\.bank"\)/);
  assert.match(catalogue, /"review\.bank": "Review Bank"/);
  assert.match(review, /t\("review\.weekly"\)/);
  assert.match(catalogue, /"review\.weekly": "Weekly Recall"/);
  assert.match(review, /type=\{multiple \? "checkbox" : "radio"\}/);
  assert.match(review, /role="progressbar"/);
  assert.match(review, /t\("review\.leaveSafely"\)/);
  assert.match(catalogue, /"review\.leaveSafely": "Leave safely"/);
  assert.match(questions, /reviewApi\.trackAttempt/);
  assert.match(app, /path="\/review\/bank\/:subjectKey"/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*\.review-session-question/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.review-session-progress span/);
});
