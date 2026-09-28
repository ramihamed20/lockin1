import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import { installOfflineEnvironment, signedLease } from "./helpers/offlineEnvironment.js";

// The environment must exist before the API client reads `window` at import.
const env = installOfflineEnvironment();
const { focusApi } = await import("../src/api/focus.js");
const { reviewApi } = await import("../src/api/review.js");
const { catalogWorkspaceApi } = await import("../src/api/catalogWorkspace.js");
const { offlineDatabase } = await import("../src/offline/database.js");
const { saveVerifiedLease, offlineAccessStatus } = await import("../src/offline/lease.js");
const downloads = await import("../src/offline/downloads.js");
const queue = await import("../src/offline/queue.js");
const { forgetOfflineUser } = await import("../src/offline/profile.js");
const focusSync = await import("../src/offline/focusSync.js");
const { synchronizeOffline } = await import("../src/offline/coordinator.js");
const { reportConnectionSuccess, __testing: connectionTesting } = await import("../src/lib/connectionState.js");

after(() => connectionTesting.reset());

const SHEET = "11111111-1111-4111-8111-111111111111";
const PDF = Buffer.from("%PDF-1.7 offline sheet body");
const RANGES = [
  { part: 1, start_page: 2, end_page: 8 },
  { part: 2, start_page: 9, end_page: 15 },
  { part: 3, start_page: 16, end_page: 22 }
];
const question = (label) => ({ question: `Q ${label}?`, options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "B", explanation: `Because ${label}.` });

function bundle(version = "as-v1") {
  return {
    sheet_id: SHEET,
    edition: "university",
    content_version: version,
    total_pdf_pages: 22,
    rules: { checkpoint_pass: 10, final_pass: 35 },
    availability: {
      sheet_id: SHEET,
      enabled: true,
      difficulties: [
        { difficulty: "easy", status: "not_configured", number_of_parts: 0, page_ranges: [], progress: null, completed: false },
        { difficulty: "medium", status: "ready", number_of_parts: 3, page_ranges: RANGES, progress: null, completed: false }
      ]
    },
    difficulties: {
      medium: {
        number_of_parts: 3,
        page_ranges: RANGES,
        parts: RANGES.map(({ part }) => ({ part, questions: Array.from({ length: 15 }, (_, index) => question(`${part}-${index}`)) })),
        final_exam: { questions: Array.from({ length: 50 }, (_, index) => question(`F-${index}`)) }
      }
    }
  };
}

function manifest(asVersion = "as-v1", { withActiveStudy = true } = {}) {
  const pdf = {
    id: "doc-1:sheet", type: "sheet", document_id: "doc-1", document_version_id: "ver-1",
    material_slug: "anatomy", sheet_slug: "cranial", subject_id: "subject-1", sheet_id: SHEET, edition: "university",
    title: "Cranial nerves", version: 1, size: PDF.length, checksum: createHash("sha256").update(PDF).digest("hex"),
    download_url: "/api/v1/files/file-1/view", dependencies: [], available: true
  };
  const activeStudy = {
    id: `active_study:${SHEET}:university`, type: "active_study", sheet_id: SHEET, subject_id: "subject-1", edition: "university",
    material_slug: "anatomy", sheet_slug: "cranial", title: "Cranial nerves", version: asVersion, checksum: asVersion, size: null,
    download_url: `/api/v1/offline/active-study/${SHEET}/?edition=university`, dependencies: [pdf.id], available: true
  };
  return { version: 1, subjects: [{ id: "subject-1", title: "Anatomy", material_slug: "anatomy", cohort: "y1", program: "dds" }], items: withActiveStudy ? [pdf, activeStudy] : [pdf] };
}

function serveContent({ asVersion = "as-v1", pdfStatus = 200, bundleBody = null } = {}) {
  env.route("GET /offline/manifest/", () => manifest(asVersion));
  env.route("GET /files/file-1/view", () => new Response(pdfStatus === 200 ? PDF : "no", { status: pdfStatus, headers: { "Content-Type": "application/pdf", "Content-Length": String(PDF.length) } }));
  env.route(`GET /offline/active-study/${SHEET}/?edition=university`, () => bundleBody || bundle(asVersion));
}

async function freshUser() {
  const userId = `user-${randomUUID()}`;
  env.goOnline();
  reportConnectionSuccess();
  globalThis.localStorage.setItem("lock-in.offline-current-user-id", userId);
  assert.equal(await saveVerifiedLease(userId, signedLease({ userId })), true);
  return userId;
}

async function downloadActiveStudy(userId) {
  serveContent();
  const current = await downloads.fetchOfflineManifest(userId);
  const item = current.items.find((entry) => entry.type === "active_study");
  await downloads.downloadOfflineItem(userId, item, () => {}, { manual: true, manifest: current });
  return item;
}

function offline() {
  env.goOffline();
}

async function completeQuiz(runId, correct) {
  const quiz = await focusApi.getManagedActiveStudyQuestions(runId);
  for (const item of quiz.questions) {
    await focusApi.answerManagedActiveStudyQuestion(runId, { attemptId: quiz.attempt_id, position: item.position, selectedAnswer: item.position <= correct ? "B" : "A" });
  }
  return { quiz, submitted: await focusApi.submitManagedActiveStudy(runId, quiz.attempt_id) };
}

// --- Download manager ------------------------------------------------------

test("an Active Study bundle is offline ready only when its PDF and every checkpoint and final exam are stored", async () => {
  const userId = await freshUser();
  serveContent({ pdfStatus: 500 });
  let current = await downloads.fetchOfflineManifest(userId);
  const item = current.items.find((entry) => entry.type === "active_study");
  assert.deepEqual(downloads.dependencyGraph(current, item).map((entry) => entry.type), ["sheet", "active_study"]);
  await assert.rejects(downloads.downloadOfflineItem(userId, item, () => {}, { manifest: current }));
  assert.equal(await downloads.offlineItemState(userId, item, current), "download");

  const broken = bundle();
  broken.difficulties.medium.final_exam.questions = [];
  serveContent({ bundleBody: broken });
  await assert.rejects(downloads.downloadOfflineItem(userId, item, () => {}, { manifest: current }), /incomplete/);
  assert.equal(await downloads.offlineItemState(userId, item, current), "incomplete", "a stored PDF alone is not Available Offline");
  assert.equal(await downloads.isOfflineItemStored(userId, item, current), false);

  serveContent();
  env.calls.length = 0;
  await downloads.downloadOfflineItem(userId, item, () => {}, { manifest: current });
  assert.equal(await downloads.offlineItemState(userId, item, current), "downloaded");
  assert.ok(!env.calls.includes("GET /files/file-1/view"), "the verified PDF is not downloaded again");

  // A changed bundle version shows an update and re-fetches only that part.
  serveContent({ asVersion: "as-v2" });
  current = await downloads.fetchOfflineManifest(userId);
  const updated = current.items.find((entry) => entry.type === "active_study");
  assert.equal(await downloads.offlineItemState(userId, updated, current), "update");
  env.calls.length = 0;
  await downloads.downloadOfflineItem(userId, updated, () => {}, { manifest: current });
  assert.deepEqual(env.calls, [`GET /offline/active-study/${SHEET}/?edition=university`]);
  assert.equal(await downloads.offlineItemState(userId, updated, current), "downloaded");
  const keys = (await offlineDatabase.keys(userId)).filter((key) => String(key).startsWith(`content:${updated.id}:`));
  assert.deepEqual(keys, [`content:${updated.id}:as-v2`], "the superseded bundle version is removed");
});

// --- Active Study offline --------------------------------------------------

test("Active Study runs offline through the unchanged focusApi and survives an app restart", async () => {
  const userId = await freshUser();
  await downloadActiveStudy(userId);
  offline();

  const availability = await focusApi.getManagedActiveStudyAvailability(SHEET, "university");
  const medium = availability.difficulties.find((row) => row.difficulty === "medium");
  assert.equal(medium.status, "ready");
  assert.equal(availability.difficulties.find((row) => row.difficulty === "easy").status, "not_configured");

  // First-ever opening starts Part 1 in reading; choosing a difficulty never opens questions.
  const started = await focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" });
  assert.equal(started.resumed, false);
  assert.equal(started.run.stage, "reading");
  assert.deepEqual(started.run.current_page_range, RANGES[0]);
  const runId = started.run.id;

  // Questions open only through the existing trigger: complete-reading first.
  await assert.rejects(focusApi.getManagedActiveStudyQuestions(runId), /not available at this stage/);
  const checkpoint = await focusApi.managedActiveStudyAction(runId, "complete-reading");
  assert.equal(checkpoint.run.stage, "checkpoint");

  const { quiz, submitted } = await completeQuiz(runId, 15);
  assert.equal(quiz.questions.length, 15);
  assert.equal(quiz.kind, "checkpoint");
  assert.equal(submitted.result.passed, true);
  assert.equal(submitted.result.xp_awarded, 0, "no authoritative XP is granted locally");
  assert.equal(submitted.result.pending_sync, true);
  // Only the next part unlocks; earlier pages stay reachable and later parts stay locked.
  assert.equal(submitted.run.current_part, 2);
  assert.equal(submitted.run.stage, "reading");
  assert.deepEqual(submitted.run.completed_parts, [1]);
  assert.deepEqual(submitted.run.current_page_range, RANGES[1]);
  assert.ok(submitted.run.current_page_range.end_page < RANGES[2].start_page);

  // Answer locking: a submitted position cannot change inside an open attempt.
  await focusApi.managedActiveStudyAction(runId, "complete-reading");
  const second = await focusApi.getManagedActiveStudyQuestions(runId);
  await focusApi.answerManagedActiveStudyQuestion(runId, { attemptId: second.attempt_id, position: 1, selectedAnswer: "B" });
  await assert.rejects(focusApi.answerManagedActiveStudyQuestion(runId, { attemptId: second.attempt_id, position: 1, selectedAnswer: "C" }), /already submitted/);
  const reopened = await focusApi.getManagedActiveStudyQuestions(runId);
  assert.equal(reopened.attempt_id, second.attempt_id, "the open attempt and its answers survive closing the quiz");
  assert.equal(reopened.questions[0].answered, "B");

  // "PWA closed and reopened offline": all state is in IndexedDB.
  const resumed = await focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.run.id, runId);
  assert.equal(resumed.run.current_part, 2, "resuming never jumps back to Part 1");
  assert.equal(resumed.run.stage, "checkpoint");

  const pending = await queue.pendingOfflineOperations(userId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].operation_type, "active_study_attempt");
  assert.equal(pending[0].payload.kind, "checkpoint");
  assert.equal(pending[0].payload.part, 1);
  assert.equal(pending[0].payload.answers.length, 15);
  assert.equal(pending[0].sync_status, "pending");
  assert.equal(pending[0].schema_version, 1);
  assert.equal(pending[0].payload.attempt_id, quiz.attempt_id);
});

test("a failed checkpoint offers retake or continue, and the Final Exam completes offline", async () => {
  const userId = await freshUser();
  await downloadActiveStudy(userId);
  offline();
  const { run } = await focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" });
  await focusApi.managedActiveStudyAction(run.id, "complete-reading");
  const failed = await completeQuiz(run.id, 9);
  assert.equal(failed.submitted.result.passed, false, "the pass mark is the bundle's server rule");
  assert.equal(failed.submitted.run.stage, "checkpoint_result");
  const continued = await focusApi.managedActiveStudyAction(run.id, "continue");
  assert.equal(continued.run.current_part, 2);
  assert.equal(continued.run.last_outcome, "continued_anyway");

  for (const part of [2, 3]) {
    await focusApi.managedActiveStudyAction(run.id, "complete-reading");
    const { submitted } = await completeQuiz(run.id, 12);
    assert.equal(submitted.result.passed, true, `part ${part}`);
  }
  const final = await focusApi.getManagedActiveStudyQuestions(run.id);
  assert.equal(final.kind, "final");
  assert.equal(final.questions.length, 50);
  const firstTry = await completeQuiz(run.id, 34);
  assert.equal(firstTry.submitted.result.passed, false);
  assert.equal(firstTry.submitted.run.stage, "final_result");
  await focusApi.managedActiveStudyAction(run.id, "retry-final");
  const retry = await completeQuiz(run.id, 50);
  assert.equal(retry.submitted.result.passed, true);
  assert.equal(retry.submitted.result.completed, true);
  assert.equal(retry.submitted.run.status, "completed");

  const types = (await queue.pendingOfflineOperations(userId)).map((operation) => [operation.operation_type, operation.payload.kind ?? operation.payload.part]);
  assert.deepEqual(types, [
    ["active_study_attempt", "checkpoint"],
    ["active_study_continue", 1],
    ["active_study_attempt", "checkpoint"],
    ["active_study_attempt", "checkpoint"],
    ["active_study_attempt", "final"],
    ["active_study_attempt", "final"]
  ]);
  const sequences = (await queue.pendingOfflineOperations(userId)).map((operation) => operation.client_sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  const availability = await focusApi.getManagedActiveStudyAvailability(SHEET, "university");
  assert.equal(availability.difficulties.find((row) => row.difficulty === "medium").completed, true);
});

test("a connection lost halfway through a checkpoint continues the server's own attempt", async () => {
  const userId = await freshUser();
  await downloadActiveStudy(userId);
  const serverRun = { id: randomUUID(), sheet_id: SHEET, difficulty: "medium", status: "active", stage: "reading", current_part: 1, number_of_parts: 3, current_page_range: RANGES[0], completed_parts: [], checkpoint_attempts: 0, final_attempts: 0, last_score: null, last_outcome: "", xp_awarded: 0 };
  const attemptId = randomUUID();
  env.route("POST /focus/managed-active-study/start", () => ({ run: serverRun, resumed: false }));
  env.route(`POST /focus/managed-active-study/${serverRun.id}/complete-reading`, () => ({ run: { ...serverRun, stage: "checkpoint" } }));
  env.route(`GET /focus/managed-active-study/${serverRun.id}/questions`, () => ({
    run: { ...serverRun, stage: "checkpoint" }, attempt_id: attemptId, kind: "checkpoint",
    questions: bundle().difficulties.medium.parts[0].questions.map((item, index) => ({ position: index + 1, question: item.question, options: item.options, answered: null }))
  }));
  env.route(`POST /focus/managed-active-study/${serverRun.id}/answer`, ({ body }) => ({ correct: body.selected_answer === "B", correct_answer: "B", explanation: "x", answered_count: body.position, total: 15 }));

  const { run } = await focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" });
  assert.equal(run.id, serverRun.id);
  await focusApi.managedActiveStudyAction(run.id, "complete-reading");
  const quiz = await focusApi.getManagedActiveStudyQuestions(run.id);
  for (const position of [1, 2, 3, 4, 5]) {
    await focusApi.answerManagedActiveStudyQuestion(run.id, { attemptId: quiz.attempt_id, position, selectedAnswer: "B" });
  }
  offline();
  for (let position = 6; position <= 15; position += 1) {
    await focusApi.answerManagedActiveStudyQuestion(run.id, { attemptId: quiz.attempt_id, position, selectedAnswer: "B" });
  }
  const submitted = await focusApi.submitManagedActiveStudy(run.id, quiz.attempt_id);
  assert.equal(submitted.result.score, 15, "answers given online count toward the offline submission");
  const [operation] = await queue.pendingOfflineOperations(userId);
  assert.equal(operation.payload.attempt_id, attemptId, "the server's attempt ID is replayed, so it cannot be graded twice");
});

// --- Sync ------------------------------------------------------------------

test("reconnect sync sends queued work once, in order, and adopts the server's authoritative run", async () => {
  const userId = await freshUser();
  await downloadActiveStudy(userId);
  offline();
  const { run } = await focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" });
  await focusApi.managedActiveStudyAction(run.id, "complete-reading");
  await completeQuiz(run.id, 15);

  const serverRunId = randomUUID();
  const received = [];
  const serverRun = { id: serverRunId, sheet_id: SHEET, difficulty: "medium", status: "active", stage: "reading", current_part: 2, number_of_parts: 3, current_page_range: RANGES[1], completed_parts: [1], checkpoint_attempts: 1, final_attempts: 0, last_score: 15, last_outcome: "passed", xp_awarded: 0 };
  env.route("GET /offline/lease/", () => ({ lease: signedLease({ userId }) }));
  env.route("POST /offline/sync/", ({ body }) => {
    received.push(...body.operations);
    return { accepted: body.operations.map((operation) => ({ operation_id: operation.operation_id, result: { status: "applied", run: serverRun, result: { score: 15, total: 15, passed: true, completed: false, xp_awarded: 0 } } })), rejected: [], xp_total: 40 };
  });
  env.route(`GET /focus/managed-active-study/sheets/${SHEET}`, () => ({ sheet_id: SHEET, enabled: true, difficulties: [{ difficulty: "medium", status: "ready", number_of_parts: 3, page_ranges: RANGES, progress: serverRun, completed: false }] }));
  env.route("GET /catalog/materials", () => ({ results: [] }));
  env.route("GET /catalog/questions?source=exam", () => ({ results: [] }));
  env.route("GET /catalog/questions?source=ai-sheet", () => ({ results: [] }));
  env.route("GET /offline/review/", () => ({ bank: { active_count: 0, subjects: [] }, queue: { count: 0, results: [] }, subjects: {}, weekly: { available: false, session: null }, answer_keys: {}, version: "r1" }));
  serveContent();

  env.goOnline();
  reportConnectionSuccess();
  const states = [];
  window.addEventListener("lock-in:offline-sync", (event) => { if (event.detail.userId === userId) states.push(event.detail.state); });
  await synchronizeOffline(userId, () => {}, { force: true });
  assert.equal(received.length, 1);
  assert.equal(received[0].operation_type, "active_study_attempt");
  assert.equal(received[0].payload.xp_awarded, undefined, "the client sends evidence, never rewards");
  assert.deepEqual(await queue.pendingOfflineOperations(userId), []);
  assert.equal(states.at(-1), "synced");

  // The workspace keeps its local run ID; calls now reach the server's run.
  env.route(`POST /focus/managed-active-study/${serverRunId}/complete-reading`, () => ({ run: { ...serverRun, stage: "checkpoint" } }));
  const next = await focusApi.managedActiveStudyAction(run.id, "complete-reading");
  assert.equal(next.run.id, serverRunId);
  assert.ok(env.calls.includes(`POST /focus/managed-active-study/${serverRunId}/complete-reading`));

  // A second sync has nothing to send: no duplicate attempt, no duplicate XP.
  received.length = 0;
  await synchronizeOffline(userId, () => {}, { force: true });
  assert.equal(received.length, 0);
});

test("network failures never fail work permanently; business-rule refusals are kept visible", async () => {
  const userId = await freshUser();
  const enqueue = (entity, sequenceTag) => queue.enqueueOperation(userId, { type: "active_study_attempt", entityType: "active_study_run", entityId: entity, orderingKey: `active_study:${entity}`, payload: { tag: sequenceTag } });
  const first = await enqueue("run-a", 1);
  const second = await enqueue("run-a", 2);
  const other = await enqueue("run-b", 3);

  offline();
  await assert.rejects(queue.flushPendingOperations(userId, { force: true }));
  for (const operation of await queue.pendingOfflineOperations(userId)) {
    assert.equal(operation.sync_status, "retry");
    assert.ok(operation.next_attempt_at);
  }
  assert.equal((await queue.pendingOfflineOperations(userId)).length, 3, "the queue survives a failed upload");
  // Backoff: an automatic flush right away sends nothing.
  env.goOnline();
  reportConnectionSuccess();
  let batches = 0;
  env.route("POST /offline/sync/", ({ body }) => {
    batches += 1;
    return {
      accepted: [],
      rejected: body.operations.map((operation) => operation.operation_id === first.operation_id
        ? { operation_id: operation.operation_id, code: "unavailable", reason: "busy", retryable: true }
        : operation.operation_id === second.operation_id
          ? { operation_id: operation.operation_id, code: "out_of_order", reason: "earlier part missing", retryable: false }
          : { operation_id: operation.operation_id, code: "rejected", reason: "Sheet unavailable", retryable: false })
    };
  });
  await queue.flushPendingOperations(userId);
  assert.equal(batches, 0);
  await queue.flushPendingOperations(userId, { force: true });
  const byId = new Map((await queue.listOperations(userId)).map((operation) => [operation.operation_id, operation]));
  assert.equal(byId.get(first.operation_id).sync_status, "retry");
  assert.equal(byId.get(second.operation_id).sync_status, "retry", "waiting on a retryable predecessor is not a permanent failure");
  assert.equal(byId.get(other.operation_id).sync_status, "failed_permanent");
  assert.equal(byId.get(other.operation_id).reason, "Sheet unavailable");
  assert.deepEqual((await queue.offlineOperationConflicts(userId)).map((operation) => operation.operation_id), [other.operation_id]);
  await queue.dismissFailedOperation(userId, other.operation_id);
  assert.deepEqual(await queue.offlineOperationConflicts(userId), []);
});

test("an expired subscription keeps pending work and still uploads it with the last lease", async () => {
  const userId = await freshUser();
  env.calls.length = 0;
  await queue.enqueueOperation(userId, { type: "question_answer", entityType: "question", entityId: "q1", payload: { sheet_id: SHEET, question_id: "q1", choice_ids: ["c1"] } });
  const uploaded = [];
  env.route("GET /offline/lease/", () => new Response(JSON.stringify({ error: { message: "The subscription has expired." } }), { status: 403, headers: { "Content-Type": "application/json" } }));
  env.route("POST /offline/sync/", ({ body }) => {
    uploaded.push(...body.operations);
    return { accepted: body.operations.map((operation) => ({ operation_id: operation.operation_id, result: { question_id: "q1", is_correct: true, xp_awarded: 5, selected_choice_ids: ["c1"] } })), rejected: [] };
  });
  await assert.rejects(synchronizeOffline(userId, () => {}, { force: true }), /expired/);
  assert.equal(uploaded.length, 1);
  assert.deepEqual(await queue.pendingOfflineOperations(userId), []);
  assert.ok(!env.calls.includes("GET /offline/manifest/"), "no protected content is renewed");
});

// --- Leases, locking and isolation -----------------------------------------

test("an expired lease locks downloaded Active Study without deleting it", async () => {
  const userId = await freshUser();
  await downloadActiveStudy(userId);
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await saveVerifiedLease(userId, signedLease({ userId, iat: now - 90_000, exp: now - 3_600 })), true);
  assert.equal((await offlineAccessStatus(userId)).reason, "expired");
  offline();
  await assert.rejects(focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" }));
  assert.equal(await downloads.getOfflineActiveStudy(userId, SHEET, "university"), null);
  assert.ok(await downloads.readDownloadMetadata(userId, `active_study:${SHEET}:university`), "locked, not deleted");
  // Reconnecting with a valid subscription unlocks the same content.
  env.goOnline();
  assert.equal(await saveVerifiedLease(userId, signedLease({ userId })), true);
  assert.ok(await downloads.getOfflineActiveStudy(userId, SHEET, "university"));
});

test("clock rollback locks access, small corrections do not, and a slow device clock still works", async () => {
  const userId = await freshUser();
  const stored = await offlineDatabase.get(userId, "lease");
  await offlineDatabase.put(userId, "lease", { ...stored, trustedWall: Date.now() + 2 * 60_000 });
  assert.equal((await offlineAccessStatus(userId)).available, true, "a two-minute correction is tolerated");
  await offlineDatabase.put(userId, "lease", { ...stored, trustedWall: Date.now() + 3 * 3_600_000 });
  assert.equal((await offlineAccessStatus(userId)).reason, "clock_rollback");
  // A device whose clock runs an hour behind the server is not a rollback.
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await saveVerifiedLease(userId, signedLease({ userId, iat: now + 3600, exp: now + 3600 + 24 * 3600 })), true);
  const status = await offlineAccessStatus(userId);
  assert.equal(status.available, true);
  const lease = await offlineDatabase.get(userId, "lease");
  assert.ok(lease.serverOffset >= 3_590_000, "the offset is charged against expiry so no extra hours are gained");
});

test("signing out locks one account's downloads; another account on the device can never read them", async () => {
  const first = await freshUser();
  await downloadActiveStudy(first);
  offline();
  const { run } = await focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" });
  await focusApi.managedActiveStudyAction(run.id, "complete-reading");
  await completeQuiz(run.id, 15);
  await forgetOfflineUser(first);
  assert.equal((await offlineAccessStatus(first)).available, false);
  assert.equal(await downloads.getOfflineActiveStudy(first, SHEET, "university"), null);
  assert.equal(await downloads.readDownloadMetadata(first, `active_study:${SHEET}:university`), undefined);
  assert.equal((await env.caches.keys()).includes(`lock-in-private-offline-v1-${first}`), false);
  assert.equal((await queue.pendingOfflineOperations(first)).length, 1, "unsynced work is kept for its own account");

  const second = await freshUser();
  offline();
  assert.equal(await downloads.getOfflineActiveStudy(second, SHEET, "university"), null);
  await assert.rejects(focusApi.startManagedActiveStudy({ sheetId: SHEET, difficulty: "medium", edition: "university" }));
  assert.deepEqual(await queue.pendingOfflineOperations(second), []);
  assert.deepEqual((await offlineDatabase.keys(second)).filter((key) => String(key).startsWith("as-run:")), []);
});

// --- Review and Questions --------------------------------------------------

test("Review answers offline are graded, reflected locally and queued once per idempotency key", async () => {
  const userId = await freshUser();
  const item = { id: "item-1", subject_key: "catalog:path", prompt: "P?", answer_mode: "single", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], state: "active" };
  await offlineDatabase.put(userId, "review-snapshot", {
    bank: { active_count: 1, mastered_this_week: 0, subjects: [{ subject_key: "catalog:path", subject_label_snapshot: "Pathology", question_count: 1 }] },
    queue: { count: 0, results: [] },
    subjects: { "catalog:path": { subject_key: "catalog:path", subject_label: "Pathology", count: 1, results: [item] } },
    weekly: { available: false, session: null },
    answer_keys: { "item-1": { correct_option_ids: ["b"], explanation: "B it is." } }
  });
  offline();
  const subject = await reviewApi.getSubject("catalog:path", userId);
  assert.equal(subject.results[0].id, "item-1");
  const key = randomUUID();
  const outcome = await reviewApi.answerItem("item-1", { selectedOptionIds: ["b"], idempotencyKey: key });
  assert.equal(outcome.was_correct, true);
  assert.deepEqual(outcome.review_item.correct_option_ids, ["b"]);
  const again = await reviewApi.answerItem("item-1", { selectedOptionIds: ["b"], idempotencyKey: key });
  assert.deepEqual(again, outcome);
  const pending = await queue.pendingOfflineOperations(userId);
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].payload, { review_item_id: "item-1", selected_option_ids: ["b"], idempotency_key: key, context: "review_bank" });
  assert.equal((await reviewApi.getBank(userId)).active_count, 0, "a correct answer leaves the active bank on the device too");
});

test("downloaded normal Questions answer offline and keep XP pending until the server grades them", async () => {
  const userId = await freshUser();
  const bankItem = { id: `questions:${SHEET}:exam`, type: "questions", sheet_id: SHEET, subject_id: "subject-1", source: "exam", version: "q1", checksum: "q1", download_url: `/api/v1/offline/questions/${SHEET}/?source=exam`, dependencies: [], available: true };
  env.route("GET /offline/manifest/", () => ({ version: 1, subjects: [], items: [bankItem] }));
  env.route(`GET /offline/questions/${SHEET}/?source=exam`, () => ({
    sheet: { id: SHEET }, source: "exam", count: 1, content_version: "q1",
    results: [{ id: "q1", prompt: "?", choices: [{ id: "c1" }, { id: "c2" }], answer: null }],
    answer_keys: { q1: { correct_choice_ids: ["c2"], explanation: "c2" } }
  }));
  const current = await downloads.fetchOfflineManifest(userId);
  await downloads.downloadOfflineItem(userId, bankItem, () => {}, { manifest: current });
  offline();
  const questions = await catalogWorkspaceApi.sheetQuestions(SHEET, { source: "exam", userId });
  assert.equal(questions.results.length, 1);
  const { answer } = await catalogWorkspaceApi.answerQuestion(SHEET, "q1", ["c2"], { userId, source: "exam" });
  assert.equal(answer.is_correct, true);
  assert.equal(answer.xp_awarded, 0);
  assert.equal(answer.pending_sync, true);
  const merged = await catalogWorkspaceApi.sheetQuestions(SHEET, { source: "exam", userId });
  assert.equal(merged.results[0].answer.is_correct, true, "the answer persists across reloads");
});

// --- Focus -----------------------------------------------------------------

test("Focus documents enter the shared queue once, and an open workspace keeps ownership", async () => {
  const userId = await freshUser();
  const descriptor = { documentId: "doc-1", documentVersionId: "ver-1", scope: { edition: "university", view: "study" }, workspaceDocumentId: "doc-1", owner: `user:${userId}`, materialSlug: "anatomy", sheetSlug: "cranial", pageCount: 22 };
  await focusSync.markFocusDocumentDirty(userId, descriptor, "2026-09-27T10:00:00.000Z");
  await focusSync.markFocusDocumentDirty(userId, descriptor, "2026-09-27T10:05:00.000Z");
  let pending = await queue.pendingOfflineOperations(userId);
  assert.equal(pending.length, 1, "one queued document, however many edits");
  assert.equal(pending[0].local, true);
  assert.equal(pending[0].payload.dirty_at, "2026-09-27T10:05:00.000Z");
  assert.equal(pending[0].payload.pageCount, 22);
  await focusSync.acknowledgeFocusDocument(userId, descriptor, "2026-09-27T10:01:00.000Z");
  assert.equal((await queue.pendingOfflineOperations(userId)).length, 1, "an older push does not cover newer marks");

  const release = focusSync.registerOpenFocusDocument(descriptor);
  env.goOnline();
  reportConnectionSuccess();
  const { acknowledged } = await queue.flushPendingOperations(userId, { force: true });
  assert.equal(acknowledged.length, 0, "the open workspace syncs its own document");
  release();
  await focusSync.acknowledgeFocusDocument(userId, descriptor, "2026-09-27T10:06:00.000Z");
  pending = await queue.pendingOfflineOperations(userId);
  assert.deepEqual(pending, []);
});

test("a Focus document changed offline syncs on reconnect without reopening the sheet", async () => {
  const userId = await freshUser();
  const { createAnnotationStore } = await import("../src/workspace/storage/annotationStore.js");
  const store = createAnnotationStore();
  const owner = `user:${userId}`;
  const stroke = {
    id: "a03e6717-1c6d-4b6e-9ac5-c95835641c62", page: 2, type: "highlighter", color: "#ffee00", width: 12, opacity: 0.34,
    points: [{ x: 100, y: 200, p: 0.3, t: 10, pointer: "pen" }, { x: 300, y: 400, p: 0.6, t: 20, pointer: "pen" }]
  };
  await store.writeDocument({ owner, materialSlug: "anatomy", sheetSlug: "cranial", view: { page: 2, zoom: 1 }, notes: [{ id: "note-1", page: 2, body: "Offline note", createdAt: "2026-09-27T10:00:00.000Z", updatedAt: "2026-09-27T10:00:00.000Z" }], pages: new Map([[2, [stroke]]]) });
  const descriptor = { documentId: "doc-9", documentVersionId: "ver-9", scope: { edition: "university", view: "study" }, workspaceDocumentId: "doc-9", owner, materialSlug: "anatomy", sheetSlug: "cranial", pageCount: 3 };
  await focusSync.markFocusDocumentDirty(userId, descriptor);

  const server = { annotations: [], workspace: null, revision: 0, collection: 0 };
  env.route("GET /catalog/documents/doc-9/workspace", () => ({ revision: server.revision, state: server.workspace || {} }));
  env.route("PATCH /catalog/documents/doc-9/workspace", ({ body }) => { server.workspace = body.state; server.revision += 1; return { revision: server.revision }; });
  env.route("GET /focus/documents/ver-9/annotations*", () => ({ results: server.annotations, count: server.annotations.length, next: null, collection_revision: server.collection }));
  env.route("POST /focus/documents/ver-9/annotations*", ({ body }) => { server.annotations.push(...body.annotations); server.collection += 1; return { collection_revision: server.collection }; });
  env.goOnline();
  reportConnectionSuccess();
  const { acknowledged } = await queue.flushPendingOperations(userId, { force: true });
  assert.equal(acknowledged.length, 1);
  assert.equal(server.annotations.length, 1, "the mark reached the server");
  assert.equal(server.annotations[0].id, stroke.id);
  assert.equal(server.workspace.notes[0].body, "Offline note");
  assert.deepEqual(await queue.pendingOfflineOperations(userId), []);
  const local = await store.readDocument({ owner, materialSlug: "anatomy", sheetSlug: "cranial" });
  assert.equal(local.annotations.length, 1, "the device copy is untouched");
});

test("Automatic Downloads fetch opted-in content once and then only what changed", async () => {
  const userId = await freshUser();
  const { saveOfflinePreferences, readOfflinePreferences } = await import("../src/offline/coordinator.js");
  env.route("GET /offline/lease/", () => ({ lease: signedLease({ userId }) }));
  env.route("GET /catalog/materials", () => ({ results: [] }));
  env.route("GET /catalog/questions?source=exam", () => ({ results: [] }));
  env.route("GET /catalog/questions?source=ai-sheet", () => ({ results: [] }));
  env.route("GET /offline/review/", () => ({ bank: { active_count: 0, subjects: [] }, queue: { count: 0, results: [] }, subjects: {}, weekly: { available: false, session: null }, answer_keys: {}, version: "r1" }));
  serveContent();
  env.calls.length = 0;
  await synchronizeOffline(userId, () => {}, { force: true });
  assert.ok(!env.calls.some((call) => call.includes("/offline/active-study/")), "nothing downloads while Automatic Downloads is off");

  const preferences = await readOfflinePreferences(userId);
  assert.equal(preferences.types.active_study, true);
  await saveOfflinePreferences(userId, { ...preferences, automatic: true, network: "any" });
  env.calls.length = 0;
  await synchronizeOffline(userId, () => {}, { force: true });
  assert.ok(env.calls.includes("GET /files/file-1/view"));
  assert.ok(env.calls.includes(`GET /offline/active-study/${SHEET}/?edition=university`));
  const item = (await downloads.readOfflineManifest(userId)).items.find((entry) => entry.type === "active_study");
  assert.equal(await downloads.offlineItemState(userId, item), "downloaded");

  env.calls.length = 0;
  await synchronizeOffline(userId, () => {}, { force: true });
  assert.ok(!env.calls.some((call) => call.includes("/files/") || call.includes("/offline/active-study/")), "unchanged content is not downloaded again");

  serveContent({ asVersion: "as-v2" });
  env.calls.length = 0;
  await synchronizeOffline(userId, () => {}, { force: true });
  assert.ok(!env.calls.includes("GET /files/file-1/view"), "the unchanged PDF dependency is kept");
  assert.ok(env.calls.includes(`GET /offline/active-study/${SHEET}/?edition=university`));
  // Foreground triggers inside the quiet period do not start another run.
  env.calls.length = 0;
  assert.equal(await synchronizeOffline(userId, () => {}, { force: false }), null);
  assert.deepEqual(env.calls, []);
});

// --- Contracts that must not regress ---------------------------------------

test("the workspace, service worker and route guard keep their offline contracts", async () => {
  const [workspace, worker, guard, api] = await Promise.all([
    readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/auth/ProtectedRoute.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/focus.js", import.meta.url), "utf8")
  ]);
  // One Active Study flow: the workspace does not branch on connectivity.
  assert.doesNotMatch(workspace, /navigator\.onLine[\s\S]{0,80}ManagedActiveStudy/);
  assert.doesNotMatch(workspace, /getOfflineActiveStudy|offlineActiveStudy\./);
  for (const method of ["getManagedActiveStudyAvailability", "startManagedActiveStudy", "managedActiveStudyAction", "getManagedActiveStudyQuestions", "answerManagedActiveStudyQuestion", "submitManagedActiveStudy"]) {
    assert.match(api, new RegExp(`async ${method}\\([^)]*\\) \\{[\\s\\S]{0,160}?return objectPayload\\(await activeStudyClient\\.`));
  }
  // Inserted workspace pages never enter Active Study ranges or unlocks.
  assert.match(workspace, /const accessiblePageCount = activePageRange\?\.end_page \|\| pageCount/);
  // The worker never caches API responses and never touches private download caches.
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)\) return;/);
  assert.doesNotMatch(worker, /lock-in-private-offline/);
  assert.match(worker, /cleanupOutdatedCaches\(\)/);
  assert.match(worker, /SKIP_WAITING/);
  // Every navigation re-checks the lease, and access locks at the exact expiry.
  assert.match(guard, /useEffect\(\(\) => \{ checkOfflineLease\(\); \}, \[checkOfflineLease, location\.pathname\]\)/);
  assert.match(guard, /leaseExpiry \* 1000 - Date\.now\(\)/);
  // A single failed request ("reconnecting") must not swap the open reader for
  // a loading or expired screen; only a definitive offline state does.
  assert.match(guard, /return !navigator\.onLine \|\| getConnectionSnapshot\(\)\.status === "offline";/);
  assert.doesNotMatch(guard, /status === "connected"/);
});
