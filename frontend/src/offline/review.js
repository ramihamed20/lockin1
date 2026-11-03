import { request } from "../api/client.js";
import { offlineDatabase } from "./database.js";
import { offlineAccessStatus } from "./lease.js";
import { enqueueOperation, registerOperationHandler } from "./queue.js";
import { offlineUnavailableError } from "./resolver.js";
import { captureOfflineSession } from "./sessionScope.js";

/**
 * Review without a connection.
 *
 * The snapshot holds the student's own Review Bank, Weekly Recall and recent
 * mistakes, with the answer keys those items already revealed. An offline
 * answer is graded locally for immediate feedback, applied to the snapshot so
 * the Review screens stay consistent, and queued with the idempotency key the
 * online request would have used. The server grades it again and owns every
 * scheduling, mastery and mistake decision.
 */

const SNAPSHOT_KEY = "review-snapshot";

export async function refreshReviewSnapshot(userId, assertCurrent = captureOfflineSession(userId)) {
  const snapshot = await request("/offline/review/");
  if (!snapshot || typeof snapshot.subjects !== "object" || !snapshot.answer_keys) throw new Error("Invalid Review snapshot.");
  await offlineDatabase.putScoped(userId, SNAPSHOT_KEY, { ...snapshot, fetched_at: new Date().toISOString() }, assertCurrent);
  return snapshot;
}

/** Online reads are kept too, so a screen opened before going offline reopens.
 * @param {string} userId
 * @param {string} key
 * @param {any} value
 * @param {() => void} [assertCurrent]
 */
export async function rememberReviewRead(userId, key, value, assertCurrent = captureOfflineSession(userId)) {
  await offlineDatabase.putScoped(userId, `review:${key}`, value, assertCurrent);
}

function subjectPayload(snapshot, subjectKey) {
  return snapshot.subjects?.[subjectKey] || { subject_key: subjectKey, subject_label: null, count: 0, results: [] };
}

export async function readOfflineReview(userId, key) {
  const snapshot = await offlineDatabase.get(userId, SNAPSHOT_KEY);
  if (snapshot) {
    if (key === "daily") {
      // Read the saved bank after queued answers have updated it. Never use
      // cached daily questions in preference to the current offline snapshot.
      const now = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);
      const examRank = item => item.exam_on >= today ? item.exam_on : "9999-12-31";
      const due = Object.values(snapshot.subjects || {}).flatMap((subject) => subject.results || [])
        .map(item => ({ ...item, ...(snapshot.daily?.results.find(saved => saved.id === item.id) || {}), ...item }))
        .filter((item) => item.state === "active_review" && Date.parse(item.next_review_at) <= now && item.options?.length && snapshot.answer_keys[item.id]?.correct_option_ids?.length)
        .sort((a, b) => examRank(a).localeCompare(examRank(b)) || b.mistake_count - a.mistake_count || b.review_incorrect_count - a.review_incorrect_count || Number(b.priority_reasons?.includes("unsure") || false) - Number(a.priority_reasons?.includes("unsure") || false) || Date.parse(a.next_review_at) - Date.parse(b.next_review_at) || a.id.localeCompare(b.id));
      return { seconds_per_question: snapshot.daily?.seconds_per_question || 30, personalized_timing: Boolean(snapshot.daily?.personalized_timing), timing_sample_count: snapshot.daily?.timing_sample_count || 0, due_count: due.length, count: Math.min(20, due.length), results: due.slice(0, 20) };
    }
    if (key === "queue") return snapshot.queue;
    if (key === "bank") return snapshot.bank;
    if (key === "weekly") return snapshot.weekly;
    if (key.startsWith("subject:")) return subjectPayload(snapshot, key.slice("subject:".length));
  }
  return offlineDatabase.get(userId, `review:${key}`);
}

function grade(selected, correct) {
  return selected.length === correct.length && selected.every((id) => correct.includes(id));
}

function answerMetadata(confidence, activeSeconds) {
  return { ...(confidence === undefined ? {} : { confidence }), ...(activeSeconds === undefined ? {} : { active_seconds: activeSeconds }) };
}

async function requireSnapshot(userId) {
  if (!(await offlineAccessStatus(userId)).available) throw offlineUnavailableError();
  const snapshot = await offlineDatabase.get(userId, SNAPSHOT_KEY);
  if (!snapshot) throw offlineUnavailableError("Review hasn’t been saved on this device yet.");
  return snapshot;
}

function revealed(item, key) {
  return { ...item, correct_option_ids: key.correct_option_ids, explanation: key.explanation };
}

function validSelection(item, selected) {
  const options = new Set((item.options || []).map((option) => String(option.id)));
  return Array.isArray(selected) && selected.length > 0 && selected.length <= 12
    && new Set(selected).size === selected.length && selected.every((id) => options.has(String(id)));
}

/** A Review Bank answer, graded now and synced later. */
export async function answerReviewItemOffline(userId, itemId, { selectedOptionIds, idempotencyKey, confidence = undefined, activeSeconds = undefined }) {
  const prior = await offlineDatabase.get(userId, `review-answer:${idempotencyKey}`);
  if (prior) return prior;
  const snapshot = await requireSnapshot(userId);
  const key = snapshot.answer_keys[itemId];
  const subject = Object.values(snapshot.subjects).find((entry) => entry.results.some((item) => item.id === itemId));
  const item = subject?.results.find((entry) => entry.id === itemId);
  if (!item || !key) throw offlineUnavailableError("This question hasn’t been saved on this device.");
  if (!validSelection(item, selectedOptionIds)) throw Object.assign(new Error("Choose one or more available answers."), { status: 400 });
  const wasCorrect = grade(selectedOptionIds.map(String), key.correct_option_ids.map(String));
  const response = { was_correct: wasCorrect, review_item: revealed(item, key), mistake_event_id: null, pending_sync: true, ...answerMetadata(confidence, activeSeconds) };
  // A correct answer leaves the active bank, as it does on the server.
  const next = globalThis.structuredClone(snapshot);
  if (wasCorrect) {
    const entry = next.subjects[subject.subject_key];
    entry.results = entry.results.filter((candidate) => candidate.id !== itemId);
    entry.count = entry.results.length;
    const overview = next.bank.subjects.find((candidate) => candidate.subject_key === subject.subject_key);
    if (overview) overview.question_count = Math.max(0, overview.question_count - 1);
    next.bank.active_count = Math.max(0, next.bank.active_count - 1);
    if (Date.parse(item.next_review_at) <= Date.now()) {
      if (typeof next.bank.due_count === "number") next.bank.due_count = Math.max(0, next.bank.due_count - 1);
      if (typeof overview?.due_count === "number") overview.due_count = Math.max(0, overview.due_count - 1);
    }
    next.bank.subjects = next.bank.subjects.filter((candidate) => candidate.question_count > 0);
  }
  await enqueueOperation(userId, {
    type: "review_answer", entityType: "review_item", entityId: itemId,
    payload: { review_item_id: itemId, selected_option_ids: selectedOptionIds, idempotency_key: idempotencyKey, context: "review_bank", ...answerMetadata(confidence, activeSeconds) }
  }, [[SNAPSHOT_KEY, next], [`review-answer:${idempotencyKey}`, response]]);
  return response;
}

/** A Weekly Recall answer for the session already started online. */
export async function answerWeeklyRecallOffline(userId, sessionId, questionId, { selectedOptionIds, idempotencyKey, confidence = undefined, activeSeconds = undefined }) {
  const prior = await offlineDatabase.get(userId, `review-answer:${idempotencyKey}`);
  if (prior) return prior;
  const snapshot = await requireSnapshot(userId);
  const session = snapshot.weekly?.session;
  const question = session?.id === sessionId ? session.questions.find((entry) => entry.id === questionId) : null;
  const key = question ? snapshot.answer_keys[question.review_item.id] : null;
  if (!question || !key) throw offlineUnavailableError("This Weekly Recall hasn’t been saved on this device.");
  if (question.answered_at) throw Object.assign(new Error("This Weekly Recall question is already answered."), { status: 409 });
  if (!validSelection(question.review_item, selectedOptionIds)) throw Object.assign(new Error("Choose one or more available answers."), { status: 400 });
  const wasCorrect = grade(selectedOptionIds.map(String), key.correct_option_ids.map(String));
  const next = globalThis.structuredClone(snapshot);
  const nextSession = next.weekly.session;
  const nextQuestion = nextSession.questions.find((entry) => entry.id === questionId);
  Object.assign(nextQuestion, {
    selected_option_ids: selectedOptionIds, was_correct: wasCorrect, answered_at: new Date().toISOString(),
    review_item: revealed(nextQuestion.review_item, key)
  });
  nextSession.answered_count = nextSession.questions.filter((entry) => entry.answered_at).length;
  if (nextSession.answered_count === nextSession.total_questions) {
    nextSession.status = "completed";
    nextSession.correct_answers = nextSession.questions.filter((entry) => entry.was_correct).length;
    nextSession.completed_at = new Date().toISOString();
  }
  const response = { was_correct: wasCorrect, review_item: nextQuestion.review_item, session: nextSession, pending_sync: true, ...answerMetadata(confidence, activeSeconds) };
  await enqueueOperation(userId, {
    type: "review_answer", entityType: "weekly_question", entityId: questionId,
    payload: {
      review_item_id: question.review_item.id, selected_option_ids: selectedOptionIds, idempotency_key: idempotencyKey,
      context: "weekly_recall", weekly_session_id: sessionId, weekly_question_id: questionId,
      ...answerMetadata(confidence, activeSeconds)
    }
  }, [[SNAPSHOT_KEY, next], [`review-answer:${idempotencyKey}`, response]]);
  return response;
}

registerOperationHandler("review_answer", {
  async onAccepted(userId, operation) {
    await offlineDatabase.delete(userId, `review-answer:${operation.payload.idempotency_key}`);
  }
});
