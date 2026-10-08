import { offlineDatabase } from "./database.js";
import { offlineAccessStatus } from "./lease.js";
import { captureOfflineSession } from "./sessionScope.js";

/**
 * The one place that decides where study content comes from.
 *
 * Every read goes to the server first. Only a network failure, never an
 * authoritative 401/403/404, falls back to the device, and only while this
 * account's signed offline lease is valid. Pages never branch on
 * `navigator.onLine` themselves; they call a resolver and get the server's
 * response shape either way.
 */

const NOT_NETWORK_CODES = new Set(["aborted", "invalid_api_path"]);

export function isNetworkFailure(error) {
  return error?.status === 0 && !NOT_NETWORK_CODES.has(error?.code);
}

export function offlineUnavailableError(message = "This content hasn’t been downloaded for offline use.") {
  return Object.assign(new Error(message), { status: 0, code: "offline_unavailable" });
}

/**
 * @template T
 * @param {string} userId
 * @param {() => Promise<T>} online
 * @param {() => Promise<T | null | undefined>} offline
 * @param {{ remember?: (value: T, assertCurrent: () => void) => Promise<unknown> }} [options] `remember`
 * stores a successful online answer for a later offline read.
 * @returns {Promise<T>}
 */
export async function resolveContent(userId, online, offline, { remember } = {}) {
  const assertCurrent = userId ? captureOfflineSession(userId) : () => {};
  let value;
  try {
    value = await online();
  } catch (error) {
    if (!isNetworkFailure(error) || !userId || !(await offlineAccessStatus(userId).catch(() => ({ available: false }))).available) throw error;
    const stored = await offline();
    assertCurrent();
    if (stored == null) throw offlineUnavailableError();
    return stored;
  }
  assertCurrent();
  if (userId && remember) await remember(value, assertCurrent).catch(() => undefined);
  return value;
}

/** A stored directory or page, keyed within the account's own database. */
export function resolveStored(userId, key, online) {
  return resolveContent(userId, online, () => offlineDatabase.get(userId, key), {
    remember: (value, assertCurrent) => offlineDatabase.putScoped(userId, key, value, assertCurrent)
  });
}

export async function resolveSheet(userId, materialSlug, sheetSlug, online) {
  const { resolveOfflineDocument } = await import("./documents.js");
  return resolveContent(userId, online, () => resolveOfflineDocument(userId, { materialSlug, sheetSlug, view: "study" }));
}

export async function resolveSummary(userId, materialSlug, sheetSlug, online) {
  const { resolveOfflineDocument } = await import("./documents.js");
  return resolveContent(userId, online, () => resolveOfflineDocument(userId, { materialSlug, sheetSlug, view: "summary" }));
}

export async function resolveQuestions(userId, sheetId, source, online) {
  const [{ getOfflineQuestions }, { mergeOfflineAnswers }] = await Promise.all([import("./downloads.js"), import("./queue.js")]);
  return resolveContent(userId, online, async () => {
    const bundle = await getOfflineQuestions(userId, sheetId, source);
    return bundle ? mergeOfflineAnswers(userId, bundle) : null;
  });
}

export async function resolveReviewData(userId, key, online) {
  const { readOfflineReview, rememberReviewRead } = await import("./review.js");
  return resolveContent(userId, online, () => readOfflineReview(userId, key), {
    remember: (value, assertCurrent) => rememberReviewRead(userId, key, value, assertCurrent)
  });
}
