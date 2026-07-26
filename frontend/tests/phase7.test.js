import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { managementApi } from "../src/api/management.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";

const NODE_ID = "00000000-0000-4000-8000-000000000201";
const PARENT_ID = "00000000-0000-4000-8000-000000000202";
const CONTENT_ID = "00000000-0000-4000-8000-000000000203";
const FILE_ID = "00000000-0000-4000-8000-000000000204";
const QUESTION_ID = "00000000-0000-4000-8000-000000000205";
const QUIZ_ID = "00000000-0000-4000-8000-000000000206";
const OWNER_ID = "00000000-0000-4000-8000-000000000207";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

function json(payload, status = 200) {
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

test("Phase 7 management requests follow Django JSON, revision, paging, and lifecycle contracts", async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    const body = options.body instanceof FormData ? Object.fromEntries(options.body.entries()) : options.body ? JSON.parse(options.body) : undefined;
    calls.push({ address, method: options.method, body, csrf: new Headers(options.headers).get("X-CSRFToken"), contentType: new Headers(options.headers).get("Content-Type") });
    if (address.includes("/management/education/nodes?") || address.includes("/management/content?") || address.includes("/management/questions?") || address.includes("/management/quizzes?")) return json({ count: 1, next: null, previous: null, results: [{ id: NODE_ID }] });
    if (address.endsWith("/management/education/scopes")) return json({ scopes: [] });
    if (address.endsWith("/management/education/nodes")) return json({ id: NODE_ID }, 201);
    if (address.includes(`/management/education/nodes/${NODE_ID}`)) return json({ id: NODE_ID, revision: 2 });
    if (address.endsWith("/management/content")) return json({ id: CONTENT_ID }, 201);
    if (address.includes(`/management/content/${CONTENT_ID}`)) return json({ id: CONTENT_ID, revision: 2 });
    if (address.endsWith("/management/files")) return json({ id: FILE_ID, validation_status: "ready", scan_status: "clean" }, 201);
    if (address.endsWith("/management/questions")) return json({ id: QUESTION_ID }, 201);
    if (address.includes(`/management/questions/${QUESTION_ID}`)) return json({ id: QUESTION_ID, revision: 2 });
    if (address.endsWith("/management/quizzes")) return json({ id: QUIZ_ID }, 201);
    if (address.includes(`/management/quizzes/${QUIZ_ID}`)) return json({ id: QUIZ_ID, revision: 2 });
    throw new Error(`Unexpected request ${options.method} ${address}`);
  };

  await managementApi.listNodes({ page: 2, pageSize: 100 });
  await managementApi.listScopes();
  await managementApi.createNode({ parentId: PARENT_ID, kind: "lesson", title: "Head and neck", slug: "head-neck", description: "Creator hierarchy node", position: 3 });
  await managementApi.updateNode(NODE_ID, { expectedRevision: 1, title: "Head and neck anatomy", slug: "head-neck", description: "Updated node", position: 4 });
  await managementApi.moveNode(NODE_ID, { expectedRevision: 2, parentId: PARENT_ID, position: 1 });
  await managementApi.setNodeStatus(NODE_ID, { expectedRevision: 3, status: "published" });
  await managementApi.listContent({ status: "draft" });
  await managementApi.createContent({ academicNodeId: NODE_ID, contentType: "pdf", title: "Skull guide", summary: "Creator PDF", language: "en", allowDownload: true, metadata: {}, availableFrom: null, availableUntil: null, primaryFileId: FILE_ID });
  await managementApi.updateContent(CONTENT_ID, { expectedRevision: 1, academicNodeId: NODE_ID, contentType: "pdf", title: "Skull guide v2", summary: "Creator PDF", language: "en", allowDownload: false, metadata: {}, availableFrom: null, availableUntil: null, primaryFileId: FILE_ID });
  await managementApi.lifecycle("content", CONTENT_ID, "transfer", { expectedRevision: 2, ownerId: OWNER_ID });
  await managementApi.listQuestions();
  await managementApi.createQuestion({ academicNodeId: NODE_ID, questionType: "single_choice", prompt: "Which nerve?", explanation: "Creator explanation", difficulty: "medium", language: "en", metadata: {}, options: [{ text: "Facial", isCorrect: true }, { text: "Trigeminal", isCorrect: false }] });
  await managementApi.updateQuestion(QUESTION_ID, { expectedRevision: 1, academicNodeId: NODE_ID, questionType: "single_choice", prompt: "Which facial nerve?", explanation: "Creator explanation", difficulty: "hard", language: "en", metadata: {}, options: [{ text: "Facial", isCorrect: true }, { text: "Trigeminal", isCorrect: false }] });
  await managementApi.lifecycle("question", QUESTION_ID, "reject", { expectedRevision: 2, reviewNote: "Clarify the scope." });
  await managementApi.listQuizzes({ status: "draft" });
  await managementApi.createQuiz({ academicNodeId: NODE_ID, title: "Cranial nerves", instructions: "Choose the best answer.", mode: "quiz", selectionMode: "fixed", questionCount: 1, questionIds: [QUESTION_ID], durationSeconds: 600, maximumAttempts: 2, availableFrom: null, availableUntil: null, randomizeQuestions: true, randomizeOptions: true, resultRelease: "immediate", passPercent: "60.00", rankingEligible: true, achievementEligible: true, focusRequired: false, allowedDifficulties: ["medium"], language: "en", metadata: {} });
  await managementApi.updateQuiz(QUIZ_ID, { expectedRevision: 1, academicNodeId: NODE_ID, title: "Cranial nerves v2", instructions: "Choose the best answer.", mode: "quiz", selectionMode: "fixed", questionCount: 1, questionIds: [QUESTION_ID], durationSeconds: 600, maximumAttempts: 2, availableFrom: null, availableUntil: null, randomizeQuestions: true, randomizeOptions: true, resultRelease: "immediate", passPercent: "60.00", rankingEligible: true, achievementEligible: true, focusRequired: false, allowedDifficulties: ["medium"], language: "en", metadata: {} });
  await managementApi.lifecycle("quiz", QUIZ_ID, "retire", { expectedRevision: 2 });

  assert.deepEqual(calls.map(({ address, method, body }) => ({ address, method, body })), [
    { address: "/api/v1/management/education/nodes?page=2&page_size=100", method: "GET", body: undefined },
    { address: "/api/v1/management/education/scopes", method: "GET", body: undefined },
    { address: "/api/v1/management/education/nodes", method: "POST", body: { parent_id: PARENT_ID, kind: "lesson", title: "Head and neck", slug: "head-neck", description: "Creator hierarchy node", position: 3 } },
    { address: `/api/v1/management/education/nodes/${NODE_ID}`, method: "PATCH", body: { expected_revision: 1, title: "Head and neck anatomy", slug: "head-neck", description: "Updated node", position: 4 } },
    { address: `/api/v1/management/education/nodes/${NODE_ID}/move`, method: "POST", body: { expected_revision: 2, parent_id: PARENT_ID, position: 1 } },
    { address: `/api/v1/management/education/nodes/${NODE_ID}/status`, method: "POST", body: { expected_revision: 3, status: "published" } },
    { address: "/api/v1/management/content?page=1&page_size=25&status=draft", method: "GET", body: undefined },
    { address: "/api/v1/management/content", method: "POST", body: { academic_node_id: NODE_ID, content_type: "pdf", title: "Skull guide", summary: "Creator PDF", language: "en", allow_download: true, metadata: {}, available_from: null, available_until: null, primary_file_id: FILE_ID } },
    { address: `/api/v1/management/content/${CONTENT_ID}`, method: "PATCH", body: { academic_node_id: NODE_ID, content_type: "pdf", title: "Skull guide v2", summary: "Creator PDF", language: "en", allow_download: false, metadata: {}, available_from: null, available_until: null, primary_file_id: FILE_ID, expected_revision: 1 } },
    { address: `/api/v1/management/content/${CONTENT_ID}/transfer`, method: "POST", body: { expected_revision: 2, owner_id: OWNER_ID } },
    { address: "/api/v1/management/questions?page=1&page_size=25", method: "GET", body: undefined },
    { address: "/api/v1/management/questions", method: "POST", body: { academic_node_id: NODE_ID, question_type: "single_choice", prompt: "Which nerve?", explanation: "Creator explanation", difficulty: "medium", language: "en", metadata: {}, options: [{ text: "Facial", is_correct: true }, { text: "Trigeminal", is_correct: false }] } },
    { address: `/api/v1/management/questions/${QUESTION_ID}`, method: "PATCH", body: { academic_node_id: NODE_ID, question_type: "single_choice", prompt: "Which facial nerve?", explanation: "Creator explanation", difficulty: "hard", language: "en", metadata: {}, options: [{ text: "Facial", is_correct: true }, { text: "Trigeminal", is_correct: false }], expected_revision: 1 } },
    { address: `/api/v1/management/questions/${QUESTION_ID}/reject`, method: "POST", body: { expected_revision: 2, review_note: "Clarify the scope." } },
    { address: "/api/v1/management/quizzes?page=1&page_size=25&status=draft", method: "GET", body: undefined },
    { address: "/api/v1/management/quizzes", method: "POST", body: { academic_node_id: NODE_ID, title: "Cranial nerves", instructions: "Choose the best answer.", mode: "quiz", selection_mode: "fixed", question_count: 1, question_ids: [QUESTION_ID], duration_seconds: 600, maximum_attempts: 2, available_from: null, available_until: null, randomize_questions: true, randomize_options: true, result_release: "immediate", pass_percent: "60.00", ranking_eligible: true, achievement_eligible: true, focus_required: false, allowed_difficulties: ["medium"], language: "en", metadata: {} } },
    { address: `/api/v1/management/quizzes/${QUIZ_ID}`, method: "PATCH", body: { academic_node_id: NODE_ID, title: "Cranial nerves v2", instructions: "Choose the best answer.", mode: "quiz", selection_mode: "fixed", question_count: 1, question_ids: [QUESTION_ID], duration_seconds: 600, maximum_attempts: 2, available_from: null, available_until: null, randomize_questions: true, randomize_options: true, result_release: "immediate", pass_percent: "60.00", ranking_eligible: true, achievement_eligible: true, focus_required: false, allowed_difficulties: ["medium"], language: "en", metadata: {}, expected_revision: 1 } },
    { address: `/api/v1/management/quizzes/${QUIZ_ID}/retire`, method: "POST", body: { expected_revision: 2 } }
  ]);
  assert.equal(calls.filter((call) => ["POST", "PATCH"].includes(call.method)).every((call) => call.csrf === "csrf-value"), true);
});

test("Phase 7 omits blank optional creator text fields for Django serializer defaults", async () => {
  setup();
  const bodies = [];
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    bodies.push({ address, body: JSON.parse(options.body) });
    if (address.endsWith("/management/content")) return json({ id: CONTENT_ID }, 201);
    if (address.endsWith("/management/questions")) return json({ id: QUESTION_ID }, 201);
    if (address.endsWith("/management/quizzes")) return json({ id: QUIZ_ID }, 201);
    throw new Error(`Unexpected request ${options.method} ${address}`);
  };

  await managementApi.createContent({ academicNodeId: NODE_ID, contentType: "video", title: "Blank summary", summary: "   ", language: "en", allowDownload: false, metadata: {}, availableFrom: null, availableUntil: null, primaryFileId: null });
  await managementApi.createQuestion({ academicNodeId: NODE_ID, questionType: "single_choice", prompt: "Blank explanation?", explanation: "", difficulty: "medium", language: "en", metadata: {}, options: [{ text: "One", isCorrect: true }, { text: "Two", isCorrect: false }] });
  await managementApi.createQuiz({ academicNodeId: NODE_ID, title: "Blank instructions", instructions: "", mode: "quiz", selectionMode: "fixed", questionCount: 1, questionIds: [QUESTION_ID], durationSeconds: 600, maximumAttempts: 1, availableFrom: null, availableUntil: null, randomizeQuestions: true, randomizeOptions: true, resultRelease: "immediate", passPercent: "60.00", rankingEligible: false, achievementEligible: false, focusRequired: false, allowedDifficulties: ["medium"], language: "en", metadata: {} });

  assert.equal("summary" in bodies[0].body, false);
  assert.equal("explanation" in bodies[1].body, false);
  assert.equal("instructions" in bodies[2].body, false);
});

test("Phase 7 upload uses browser FormData without a JSON content type", async () => {
  setup();
  let uploadCall = null;
  globalThis.fetch = async (url, options = {}) => {
    uploadCall = { url: String(url), body: options.body, headers: new Headers(options.headers) };
    return json({ id: FILE_ID, validation_status: "ready", scan_status: "clean" }, 201);
  };
  const upload = new File(["safe PDF bytes"], "study.pdf", { type: "application/pdf" });
  const response = await managementApi.uploadFile({ kind: "pdf", file: upload });
  assert.equal(response.id, FILE_ID);
  assert.equal(uploadCall.url, "/api/v1/management/files");
  assert.equal(uploadCall.body instanceof FormData, true);
  assert.equal(uploadCall.body.get("kind"), "pdf");
  assert.equal(uploadCall.body.get("file").name, "study.pdf");
  assert.equal(uploadCall.headers.get("Content-Type"), null);
  assert.equal(uploadCall.headers.get("X-CSRFToken"), "csrf-value");
});

test("Phase 7 fails closed for invalid management identifiers and creator routes", async () => {
  setup();
  await assert.rejects(managementApi.getContent("https://untrusted.invalid/content"), (error) => error.code === "invalid_request");
  await assert.rejects(managementApi.lifecycle("content", CONTENT_ID, "unsupported", { expectedRevision: 1 }), (error) => error.code === "invalid_request");
  const student = { id: "student", roles: ["student"] };
  const creator = { id: "creator", roles: ["creator"] };
  const administrator = { id: "administrator", roles: ["administrator"] };
  assert.equal(canAccessRoute(student, "/creator/content"), false);
  assert.equal(canAccessRoute(creator, "/creator/questions/123"), true);
  assert.equal(canAccessRoute(administrator, "/creator/quizzes/123"), true);
});

test("Phase 7 isolates management answer data and replaces the deferred creator routes", async () => {
  const [app, management, assessments, content] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/management.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CreatorAssessments.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CreatorContent.jsx", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/creator\/education"/);
  assert.match(app, /CreatorRoute user=\{user\}/);
  assert.doesNotMatch(app, /Creator tools will be connected/);
  assert.match(management, /new FormData\(\)/);
  assert.match(management, /expected_revision/);
  assert.match(assessments, /QuestionOptionsEditor/);
  assert.doesNotMatch(assessments, /AssessmentResult|AttemptResult|localStorage/);
  assert.match(content, /FileUploadField/);
});
