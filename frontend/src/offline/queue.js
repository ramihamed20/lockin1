import { request } from "../api/client.js";
import { offlineDatabase } from "./database.js";
import { getOfflineQuestions } from "./downloads.js";

/**
 * The one durable queue for work done offline: question answers, Active Study
 * attempts, Review answers and Focus documents waiting for their server mirror.
 *
 * Every operation is an immutable record in the account's own IndexedDB
 * database. It is removed only once the server acknowledges it. A network
 * failure never fails an operation permanently; only a server business-rule
 * refusal does, and that operation is kept, with its reason, instead of being
 * silently dropped.
 */

export const OPERATION_SCHEMA_VERSION = 1;
export const OPERATION_STATUS = Object.freeze({
  PENDING: "pending",
  SYNCING: "syncing",
  ACKNOWLEDGED: "acknowledged",
  RETRY: "retry",
  FAILED: "failed_permanent"
});
const OPERATION_PREFIX = "operation:";
const SEQUENCE_KEY = "queue:sequence";
const BATCH_SIZE = 100;
const MAX_BACKOFF_MS = 5 * 60_000;

/** @typedef {{ operation_id: string, operation_type: string, entity_type: string, entity_id: string, ordering_key?: string, payload: any, local_created_at: string, client_sequence: number, retry_count: number, sync_status: string, schema_version: number, next_attempt_at?: string | null, reason?: string, code?: string, local?: boolean }} OfflineOperation */

/**
 * Per type hooks. `onAccepted` applies the authoritative server result locally;
 * `execute` marks an operation the client replays itself against existing
 * endpoints (Focus documents) instead of the batch sync endpoint.
 * @type {Map<string, { onAccepted?: (userId: string, operation: OfflineOperation, result: any) => Promise<void>, onRejected?: (userId: string, operation: OfflineOperation, rejection: any) => Promise<void>, execute?: (userId: string, operation: OfflineOperation) => Promise<"done" | "deferred"> }>}
 */
const handlers = new Map();

export function registerOperationHandler(type, handler) {
  handlers.set(type, handler);
}

// Enqueues within one tab are serialised so client sequence numbers never repeat.
const enqueueLocks = new Map();

function withEnqueueLock(userId, action) {
  const previous = enqueueLocks.get(userId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  enqueueLocks.set(userId, next.catch(() => undefined));
  return next;
}

/**
 * Stores one operation, and optionally the local records it belongs with, in a
 * single IndexedDB transaction: an answer can never be saved without the work
 * that will sync it, or the other way round.
 * @param {string} userId
 * @param {{ type: string, entityType: string, entityId: string, orderingKey?: string, payload: any, local?: boolean, operationId?: string }} operation
 * @param {Array<[string, any]>} [records]
 */
export function enqueueOperation(userId, { type, entityType, entityId, orderingKey = "", payload, local = false, operationId = "" }, records = []) {
  return withEnqueueLock(userId, async () => {
    const sequence = Number(await offlineDatabase.get(userId, SEQUENCE_KEY)) || 0;
    /** @type {OfflineOperation} */
    const operation = {
      operation_id: operationId || globalThis.crypto.randomUUID(),
      operation_type: type,
      entity_type: entityType,
      entity_id: entityId,
      ordering_key: orderingKey || `${entityType}:${entityId}`,
      payload,
      local_created_at: new Date().toISOString(),
      client_sequence: sequence + 1,
      retry_count: 0,
      sync_status: OPERATION_STATUS.PENDING,
      schema_version: OPERATION_SCHEMA_VERSION,
      next_attempt_at: null,
      local
    };
    await offlineDatabase.putMany(userId, [
      [SEQUENCE_KEY, sequence + 1],
      [`${OPERATION_PREFIX}${operation.operation_id}`, operation],
      ...records
    ]);
    return operation;
  });
}

export async function readOperation(userId, operationId) {
  return offlineDatabase.get(userId, `${OPERATION_PREFIX}${operationId}`);
}

export async function saveOperation(userId, operation) {
  await offlineDatabase.put(userId, `${OPERATION_PREFIX}${operation.operation_id}`, operation);
}

export async function removeOperation(userId, operationId) {
  await offlineDatabase.delete(userId, `${OPERATION_PREFIX}${operationId}`);
}

/** Every stored operation, oldest first. */
export async function listOperations(userId) {
  const keys = (await offlineDatabase.keys(userId)).filter((key) => String(key).startsWith(OPERATION_PREFIX));
  const values = (await Promise.all(keys.map((key) => offlineDatabase.get(userId, key)))).filter(Boolean);
  return values.sort((a, b) => (a.client_sequence || 0) - (b.client_sequence || 0)
    || String(a.local_created_at).localeCompare(String(b.local_created_at)));
}

const isOpen = (operation) => [OPERATION_STATUS.PENDING, OPERATION_STATUS.RETRY, OPERATION_STATUS.SYNCING].includes(operation.sync_status);
const isFailed = (operation) => operation.sync_status === OPERATION_STATUS.FAILED || operation.sync_status === "conflict";

/** Work not yet acknowledged. An interrupted `syncing` operation is still pending. */
export async function pendingOfflineOperations(userId) {
  return (await listOperations(userId)).filter(isOpen);
}

/** Work the server refused for a business rule. Kept, never silently dropped. */
export async function offlineOperationConflicts(userId) {
  return (await listOperations(userId)).filter(isFailed);
}

/** Whether any unacknowledged operation shares this ordering key. */
export async function hasPendingFor(userId, orderingKey) {
  return (await pendingOfflineOperations(userId)).some((operation) => operation.ordering_key === orderingKey);
}

export function backoffDelay(retryCount) {
  return Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, retryCount - 1));
}

function due(operation, now) {
  return !operation.next_attempt_at || Date.parse(operation.next_attempt_at) <= now;
}

function scheduleRetry(operation, { reason = "", code = "" } = {}) {
  const retryCount = operation.retry_count + 1;
  return {
    ...operation,
    sync_status: OPERATION_STATUS.RETRY,
    retry_count: retryCount,
    next_attempt_at: new Date(Date.now() + backoffDelay(retryCount)).toISOString(),
    ...(reason ? { reason } : {}),
    ...(code ? { code } : {})
  };
}

export function isConnectivityError(error) {
  return error?.status === 0 || error?.status === 429 || Number(error?.status) >= 500;
}

async function flushServerBatch(userId, batch, leaseToken) {
  await offlineDatabase.putMany(userId, batch.map((operation) => [`${OPERATION_PREFIX}${operation.operation_id}`, { ...operation, sync_status: OPERATION_STATUS.SYNCING }]));
  let response;
  try {
    response = await request("/offline/sync/", {
      method: "POST",
      retryable: true,
      body: {
        lease_token: leaseToken,
        operations: batch.map(({ operation_id, operation_type, payload }) => ({ operation_id, operation_type, payload }))
      }
    });
  } catch (error) {
    // Nothing was acknowledged. Keep every operation; a lost connection or an
    // unavailable server is never a reason to give up on saved work. A refusal
    // of the whole batch (an ended session, a lease too old to prove the work)
    // keeps it too, with the server's reason instead of "connection", so it can
    // upload once the student signs in or renews access.
    const reason = isConnectivityError(error) ? {} : { reason: error?.message || "", code: Number(error?.status) === 401 ? "signin" : "access" };
    await offlineDatabase.putMany(userId, batch.map((operation) => [`${OPERATION_PREFIX}${operation.operation_id}`, scheduleRetry(operation, { code: "connection", ...reason })]));
    throw error;
  }
  const byId = new Map(batch.map((operation) => [operation.operation_id, operation]));
  const acknowledged = [];
  for (const accepted of response?.accepted || []) {
    const operation = byId.get(accepted.operation_id);
    if (!operation) continue;
    byId.delete(accepted.operation_id);
    try {
      await handlers.get(operation.operation_type)?.onAccepted?.(userId, operation, accepted.result);
    } catch {
      // The server result is authoritative and already stored there; a local
      // projection that fails to update is refreshed on the next read.
    }
    await removeOperation(userId, operation.operation_id);
    acknowledged.push({ operation, result: accepted.result });
  }
  // A temporary refusal blocks later work on the same entity: their
  // "out of order" answers mean "not yet", not "never".
  const blocked = new Set();
  for (const rejected of response?.rejected || []) {
    const operation = byId.get(rejected.operation_id);
    if (!operation) continue;
    byId.delete(rejected.operation_id);
    if (rejected.retryable || (rejected.code === "out_of_order" && blocked.has(operation.ordering_key))) {
      blocked.add(operation.ordering_key);
      await saveOperation(userId, scheduleRetry(operation, { reason: rejected.reason, code: rejected.code }));
      continue;
    }
    const failed = { ...operation, sync_status: OPERATION_STATUS.FAILED, retry_count: operation.retry_count + 1, reason: rejected.reason, code: rejected.code || "rejected" };
    await saveOperation(userId, failed);
    try { await handlers.get(operation.operation_type)?.onRejected?.(userId, failed, rejected); } catch { /* the failure stays visible in Settings */ }
  }
  // An operation the server did not mention was not processed.
  for (const operation of byId.values()) await saveOperation(userId, scheduleRetry(operation));
  return { acknowledged, xpTotal: response?.xp_total };
}

async function flushLocalOperation(userId, operation) {
  const handler = handlers.get(operation.operation_type);
  if (!handler?.execute) return false;
  try {
    const outcome = await handler.execute(userId, operation);
    if (outcome === "deferred") return false;
    await removeOperation(userId, operation.operation_id);
    return true;
  } catch (error) {
    if (isConnectivityError(error)) {
      await saveOperation(userId, scheduleRetry(operation, { code: "connection" }));
      throw error;
    }
    await saveOperation(userId, { ...operation, sync_status: OPERATION_STATUS.FAILED, retry_count: operation.retry_count + 1, reason: error?.message || "The change could not be synced.", code: "rejected" });
    return false;
  }
}

/**
 * Sends every due operation in client order.
 * @param {string} userId
 * @param {{ force?: boolean }} [options] `force` ignores retry backoff, for a
 * connection that has just returned or a manual "Sync now".
 */
export async function flushPendingOperations(userId, { force = false } = {}) {
  const now = Date.now();
  const pending = (await pendingOfflineOperations(userId)).filter((operation) => force || due(operation, now));
  const acknowledged = [];
  let xpTotal;
  const serverOperations = pending.filter((operation) => !operation.local);
  let serverError = null;
  try {
    if (serverOperations.length) {
      const lease = await offlineDatabase.get(userId, "lease");
      if (!lease?.token) throw new Error("An offline access lease is required to sync saved work.");
      for (let start = 0; start < serverOperations.length; start += BATCH_SIZE) {
        const result = await flushServerBatch(userId, serverOperations.slice(start, start + BATCH_SIZE), lease.token);
        acknowledged.push(...result.acknowledged);
        if (typeof result.xpTotal === "number") xpTotal = result.xpTotal;
      }
    }
  } catch (error) {
    serverError = error;
  }
  // Focus documents sync through their own endpoints. A refused or failed
  // batch above is no reason to hold them back, unless the connection itself
  // is gone, in which case they would only fail the same way.
  if (!serverError || !isConnectivityError(serverError)) {
    for (const operation of pending.filter((item) => item.local)) {
      if (await flushLocalOperation(userId, operation)) acknowledged.push({ operation, result: null });
    }
  }
  if (serverError) throw Object.assign(serverError, { acknowledged });
  return { acknowledged, remaining: await pendingOfflineOperations(userId), xpTotal };
}

/** Removes a refused operation the student has read about. */
export async function dismissFailedOperation(userId, operationId) {
  const operation = await readOperation(userId, operationId);
  if (operation && isFailed(operation)) await removeOperation(userId, operationId);
}

// --- Normal Questions -----------------------------------------------------

/** Optimistic feedback is local only; XP is awarded on the authoritative server. */
export async function answerQuestionOffline(userId, sheetId, source, questionId, choiceIds) {
  const bundle = await getOfflineQuestions(userId, sheetId, source);
  const question = bundle?.results?.find((item) => item.id === questionId);
  const key = bundle?.answer_keys?.[questionId];
  if (!question || !key) throw new Error("This content hasn’t been downloaded for offline use.");
  const prior = await offlineDatabase.get(userId, `answer:${questionId}`);
  if (prior) return { answer: prior, created: false };
  const validChoices = new Set(question.choices.map((choice) => choice.id));
  if (!Array.isArray(choiceIds) || !choiceIds.length || choiceIds.some((choice) => !validChoices.has(choice))) throw new Error("Invalid answer.");
  const correct = new Set(key.correct_choice_ids);
  const isCorrect = choiceIds.length === correct.size && choiceIds.every((choice) => correct.has(choice));
  const answer = {
    selected_choice_ids: choiceIds,
    correct_choice_ids: key.correct_choice_ids,
    is_correct: isCorrect,
    explanation: key.explanation,
    xp_awarded: 0,
    pending_sync: true,
    answered_at: new Date().toISOString()
  };
  await enqueueOperation(userId, {
    type: "question_answer",
    entityType: "question",
    entityId: questionId,
    payload: { sheet_id: sheetId, question_id: questionId, choice_ids: choiceIds }
  }, [[`answer:${questionId}`, answer]]);
  return { answer, created: true };
}

export async function mergeOfflineAnswers(userId, bundle) {
  const results = await Promise.all(bundle.results.map(async (question) => {
    const local = await offlineDatabase.get(userId, `answer:${question.id}`);
    return { ...question, answer: local || question.answer };
  }));
  return { ...bundle, results };
}

registerOperationHandler("question_answer", {
  async onAccepted(userId, _operation, result) {
    if (!result?.question_id) return;
    const answer = await offlineDatabase.get(userId, `answer:${result.question_id}`);
    if (answer) await offlineDatabase.put(userId, `answer:${result.question_id}`, {
      ...answer, is_correct: result.is_correct, xp_awarded: result.xp_awarded,
      selected_choice_ids: result.selected_choice_ids, pending_sync: false
    });
  }
});
