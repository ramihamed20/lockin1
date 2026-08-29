import { normalizeUserError } from "./errors.js";

/**
 * Session bootstrap recovery policy.
 *
 * The application cannot render anything useful until `GET /auth/session`
 * resolves, so a single transient failure used to strand the reader on an
 * error screen. These helpers decide what is worth retrying automatically,
 * how long to wait, and what the reader is told — without ever surfacing a
 * transport or authentication detail.
 */

export const MAX_AUTOMATIC_BOOT_RETRIES = 3;

/** Deterministic backoff. Short enough to feel like loading, bounded so it cannot spin. */
const RETRY_DELAYS_MS = Object.freeze([600, 1_500, 3_200]);

const OFFLINE_MESSAGE = "You appear to be offline. Your saved work stays on this device, and the workspace reopens once the connection returns.";
const RECONNECTING_MESSAGE = "Reconnecting to your session…";
const UNREACHABLE_MESSAGE = "We could not reach the server. Check your connection and try again.";
const SERVER_MESSAGE = "The server is having trouble right now. Please try again in a moment.";
const GENERIC_MESSAGE = "We could not open your session. Please try again.";

/**
 * A failure worth retrying on the reader's behalf: no connection, a timeout,
 * a rate limit, or a server-side fault. Anything else is a real answer from the
 * server and repeating it would only waste the reader's time.
 * @param {unknown} error
 */
export function isTransientBootFailure(error) {
  const status = Number(/** @type {any} */ (error)?.status);
  if (!Number.isFinite(status)) return false;
  if (status === 0) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500 && status <= 599;
}

/** @param {number} attempt 1-based attempt number */
export function bootRetryDelayMs(attempt) {
  const index = Math.min(RETRY_DELAYS_MS.length, Math.max(1, Math.round(Number(attempt) || 1))) - 1;
  return RETRY_DELAYS_MS[index];
}

/**
 * @param {unknown} error
 * @param {{ online?: boolean, attempts?: number }} [state]
 * @returns {boolean} whether another automatic attempt should be scheduled
 */
export function shouldRetryBootAutomatically(error, { online = true, attempts = 0 } = {}) {
  if (!online) return false;
  if (!isTransientBootFailure(error)) return false;
  return attempts < MAX_AUTOMATIC_BOOT_RETRIES;
}

/**
 * The reader-facing explanation. Server-authored copy is still allowed through
 * `normalizeUserError`, which drops HTML, stack-shaped, and oversized strings.
 * @param {unknown} error
 * @param {{ online?: boolean, retrying?: boolean }} [state]
 */
export function bootFailureMessage(error, { online = true, retrying = false } = {}) {
  if (!online) return OFFLINE_MESSAGE;
  if (retrying) return RECONNECTING_MESSAGE;
  const status = Number(/** @type {any} */ (error)?.status);
  if (status === 0) return UNREACHABLE_MESSAGE;
  if (Number.isFinite(status) && status >= 500) return SERVER_MESSAGE;
  return normalizeUserError(/** @type {any} */ (error)?.message, GENERIC_MESSAGE);
}
