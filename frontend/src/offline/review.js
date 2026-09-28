import { request } from "../api/client.js";
import { offlineDatabase } from "./database.js";
import { offlineAccessStatus } from "./lease.js";
import { enqueueOperation, registerOperationHandler } from "./queue.js";
import { offlineUnavailableError } from "./resolver.js";

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

export async function refreshReviewSnapshot(userId) {
  const snapshot = await request("/offline/review/");
  if (!snapshot || typeof snapshot.subjects !== "object" || !snapshot.answer_keys) throw new Error("Invalid Review snapshot.");
  await offlineDatabase.put(userId, SNAPSHOT_KEY, { ...snapshot, fetched_at: new Date().toISOString() });
  return snapshot;
}

/** Online reads are kept too, so a screen opened before going offline reopens. */
export async function rememberReviewRead(userId, key, value) {
  await offlineDatabase.put(userId, `review:${key}`, value);
}

function subjectPayload(snapshot, subjectKey) {
  return snapshot.subjects?.[subjectKey] || { subject_key: subjectKey, subject_label: null, count: 0, results: [] };
}

export async function readOfflineReview(userId, key) {
  const snapshot = await offlineDatabase.get(userId, SNAPSHOT_KEY);
  if (snapshot) {
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
export async function answerReviewItemOffline(userId, itemId, { selectedOptionIds, idempotencyKey }) {
  const prior = await offlineDatabase.get(userId, `review-answer:${idempotencyKey}`);
  if (prior) return prior;
  const snapshot = await requireSnapshot(userId);
  const key = snapshot.answer_keys[itemId];
  const subject = Object.values(snapshot.subjects).find((entry) => entry.results.some((item) => item.id === itemId));
  const item = subject?.results.find((entry) => entry.id === itemId);
  if (!item || !key) throw offlineUnavailableError("This question hasn’t been saved on this device.");
  if (!validSelection(item, selectedOptionIds)) throw Object.assign(new Error("Choose one or more available answers."), { status: 400 });
  const wasCorrect = grade(selectedOptionIds.map(String), key.correct_option_ids.map(String));
  const response = { was_correct: wasCorrect, review_item: revealed(item, key), mistake_event_id: null, pending_sync: true };
  // A correct answer leaves the active bank, as it does on the server.
  const next = globalThis.structuredClone(snapshot);
  if (wasCorrect) {
    const entry = next.subjects[subject.subject_key];
    entry.results = entry.results.filter((candidate) => candidate.id !== itemId);
    entry.count = entry.results.length;
    const overview = next.bank.subjects.find((candidate) => candidate.subject_key === subject.subject_key);
    if (overview) overview.question_count = Math.max(0, overview.question_count - 1);
    next.bank.active_count = Math.max(0, next.bank.active_count - 1);
  }
  await enqueueOperation(userId, {
    type: "review_answer", entityType: "review_item", entityId: itemId,
    payload: { review_item_id: itemId, selected_option_ids: selectedOptionIds, idempotency_key: idempotencyKey, context: "review_bank" }
  }, [[SNAPSHOT_KEY, next], [`review-answer:${idempotencyKey}`, response]]);
  return response;
}

/** A Weekly Recall answer for the session already started online. */
export async function answerWeeklyRecallOffline(userId, sessionId, questionId, { selectedOptionIds, idempotencyKey }) {
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
  const response = { was_correct: wasCorrect, review_item: nextQuestion.review_item, session: nextSession, pending_sync: true };
  await enqueueOperation(userId, {
    type: "review_answer", entityType: "weekly_question", entityId: questionId,
    payload: {
      review_item_id: question.review_item.id, selected_option_ids: selectedOptionIds, idempotency_key: idempotencyKey,
      context: "weekly_recall", weekly_session_id: sessionId, weekly_question_id: questionId
    }
  }, [[SNAPSHOT_KEY, next], [`review-answer:${idempotencyKey}`, response]]);
  return response;
}

registerOperationHandler("review_answer", {
  async onAccepted(userId, operation) {
    await offlineDatabase.delete(userId, `review-answer:${operation.payload.idempotency_key}`);
  }
});
