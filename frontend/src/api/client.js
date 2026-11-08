import { isHtmlErrorMessage, normalizeUserError } from "../lib/errors.js";
import { userErrorMessage } from "../lib/userErrors.js";
import {
  configureConnectionProbe,
  getConnectionSnapshot,
  isOffline,
  subscribeConnection,
  reportConnectionFailure,
  reportConnectionSuccess
} from "../lib/connectionState.js";

const configuredBasePath = import.meta.env?.VITE_API_BASE_URL || "/api/v1";
const SESSION_MARKER_KEY = "lock-in.session";
const CSRF_COOKIE_NAMES = ["__Host-lockin_csrf", "csrftoken"];

/**
 * @typedef {"json"|"text"|"blob"|"arraybuffer"} ResponseType
 * @typedef {{
 *   method?: string,
 *   headers?: HeadersInit,
 *   body?: unknown,
 *   responseType?: ResponseType,
 *   idempotencyKey?: string,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   retryable?: boolean,
 *   allowOfflineQueue?: boolean
 * }} ApiRequestOptions
 */

const unauthorizedSubscribers = new Set();
let cachedCsrfToken = "";
let pendingCsrfToken = null;

function runtimeOrigin() {
  return typeof window === "undefined" ? "http://lock-in.invalid" : window.location.origin;
}

function normaliseApiBasePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    throw new Error("VITE_API_BASE_URL must be a same-origin relative path.");
  }

  const url = new URL(value, runtimeOrigin());
  if (url.origin !== runtimeOrigin() || url.search || url.hash || url.pathname.includes("\\")) {
    throw new Error("VITE_API_BASE_URL must contain only a same-origin API path.");
  }

  return url.pathname.replace(/\/+$/, "") || "/";
}

export const API_BASE_PATH = normaliseApiBasePath(configuredBasePath);

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readCookie(name) {
  if (typeof document === "undefined" || typeof document.cookie !== "string") return "";
  const prefix = name + "=";
  const value = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

function readCsrfCookie() {
  return CSRF_COOKIE_NAMES.map(readCookie).find(Boolean) || "";
}

function apiPath(path) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#") ||
    /^[a-z][a-z\d+.-]*:/i.test(path)
  ) {
    throw new ApiError(0, null, "Only same-origin relative API paths are allowed.", "invalid_api_path");
  }

  const url = new URL(API_BASE_PATH + path, runtimeOrigin());
  const requiredPrefix = API_BASE_PATH === "/" ? "/" : API_BASE_PATH + "/";
  if (
    url.origin !== runtimeOrigin() ||
    (url.pathname !== API_BASE_PATH && !url.pathname.startsWith(requiredPrefix))
  ) {
    throw new ApiError(0, null, "The API path escapes the configured API boundary.", "invalid_api_path");
  }

  return url.pathname + url.search;
}

/**
 * The language the reader is using, for Django's own messages.
 *
 * Django translates its validator prose ("This password is too common") from
 * the request's Accept-Language. Left to the browser's header, an English
 * screen could answer in Arabic and an Arabic screen in English; the surface
 * the reader chose is the one that should decide.
 */
function readerLanguage() {
  if (typeof document === "undefined") return "";
  const documentLanguage = document.documentElement?.lang;
  if (documentLanguage) return documentLanguage;
  try {
    return localStorage.getItem("lock-in.locale") || "";
  } catch {
    return "";
  }
}

function isFormData(value) {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function isBinaryBody(value) {
  return (
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) ||
    (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams)
  );
}

function normaliseRequestBody(body, headers) {
  if (body == null || isFormData(body) || isBinaryBody(body) || typeof body === "string") {
    return body;
  }

  if (typeof body === "object") {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return JSON.stringify(body);
  }

  return body;
}

function isUnsafe(method = "GET") {
  return !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase());
}

function getErrorEnvelope(payload) {
  return payload && typeof payload === "object" && "error" in payload ? payload.error : null;
}

function detailMessage(payload) {
  return payload && typeof payload === "object" && typeof payload.detail === "string" ? payload.detail : "";
}

/**
 * How long a request may take before the reader is told it will not arrive.
 *
 * Without a deadline a request on a stalled mobile connection never settles:
 * the promise stays pending, the spinner stays up, and nothing retries. The
 * default is generous enough for a slow first byte on a poor connection and
 * short enough that a stall is reported rather than endured.
 *
 * Streamed private files legitimately take far longer -- nginx allows five
 * minutes for them -- so a caller can raise its own ceiling, and pass 0 to opt
 * out entirely for a transfer that is genuinely unbounded.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const FILE_REQUEST_TIMEOUT_MS = 300_000;
// While the server is already known to be unreachable, a read that hangs on a
// weak signal gives up sooner, so pages fall back to downloaded content in
// seconds rather than half a minute. Writes keep the full budget.
export const UNREACHABLE_READ_TIMEOUT_MS = 8_000;
// Once the connection probe has confirmed the server is unreachable, a read
// that would only hang again gives up faster still.
export const OFFLINE_READ_TIMEOUT_MS = 3_000;

function requestTimeoutMs(options, method = "GET") {
  const configured = options.timeoutMs;
  if (configured === 0) return 0;
  if (Number.isFinite(configured) && configured > 0) return configured;
  const connection = getConnectionSnapshot().status;
  if (["GET", "HEAD"].includes(method) && connection !== "connected") return connection === "offline" ? OFFLINE_READ_TIMEOUT_MS : UNREACHABLE_READ_TIMEOUT_MS;
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

function isAbortError(error) {
  return Boolean(error) && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * A deadline that reports whether it was the one that fired.
 * `AbortSignal.timeout` alone cannot be told apart from a caller's own abort
 * once both are merged into one signal.
 */
function timeoutSignal(timeoutMs) {
  if (!timeoutMs || typeof AbortController === "undefined") return null;
  const controller = new AbortController();
  const startedAt = Date.now();
  let dueAt = startedAt + timeoutMs;
  const fire = () => {
    state.expired = true;
    controller.abort();
  };
  let timer = setTimeout(fire, timeoutMs);
  const state = {
    signal: controller.signal,
    expired: false,
    clear: () => clearTimeout(timer),
    /** Brings the deadline forward to `limitMs` after the start, never later. */
    shorten(limitMs) {
      const next = startedAt + limitMs;
      if (next >= dueAt || state.expired) return;
      dueAt = next;
      clearTimeout(timer);
      timer = setTimeout(fire, Math.max(0, next - Date.now()));
    }
  };
  return state;
}

/**
 * `navigator.onLine === true` proves nothing, but `false` reliably means there
 * is no network interface, so retrying a failed request would only burn the
 * reader's wait.
 */
function browserReportsOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function combineSignals(callerSignal, deadlineSignal) {
  if (!callerSignal) return deadlineSignal || undefined;
  if (!deadlineSignal) return callerSignal;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([callerSignal, deadlineSignal]);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (callerSignal.aborted || deadlineSignal.aborted) abort();
  callerSignal.addEventListener("abort", abort, { once: true });
  deadlineSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

/** Wait without cancelling shared work (such as the CSRF bootstrap). */
function withinSignal(work, signal) {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error("Request cancelled"), { name: "AbortError" }));
    // Observe work even if already cancelled; fetch may have returned an
    // already-rejected promise, which must not become an unhandled rejection.
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {unknown} payload
   * @param {string} fallbackMessage
   * @param {string} [fallbackCode]
   */
  constructor(status, payload, fallbackMessage, fallbackCode = "request_failed") {
    const error = getErrorEnvelope(payload);
    const fields = error && typeof error.fields === "object" && error.fields ? error.fields : null;
    const fieldMessage = fields
      ? Object.values(fields).flat().find((value) => typeof value === "string" && value)
      : "";
    const detail = detailMessage(payload);
    super(normalizeUserError(
      (error && typeof error.message === "string" && !/^The request could not be completed\.?$/i.test(error.message) && error.message) ||
        fieldMessage ||
        detail ||
        fallbackMessage,
      fallbackMessage
    ));
    this.name = "ApiError";
    this.status = status;
    this.code = (error && typeof error.code === "string" && error.code) || fallbackCode;
    this.fields = fields;
    this.fieldCodes = error?.field_codes || null;
    this.rawMessage = this.message;
    this.method = "GET";
    this.requestSent = false;
    this.retryAfterSeconds = null;
    this.retryAt = null;
    this.message = userErrorMessage(this, { locale: readerLanguage() });
    this.request_id =
      (error && typeof error.request_id === "string" && error.request_id) || null;
    this.requestId = this.request_id;
    this.payload = payload;
  }
}

export function isApiError(error) {
  return error instanceof ApiError;
}

export function getSessionMarker() {
  return storage()?.getItem(SESSION_MARKER_KEY) || "";
}

/**
 * Stores only a non-secret UI hint. Django owns the real HttpOnly session cookie.
 * @param {boolean} active
 */
export function setSessionMarker(active) {
  const local = storage();
  if (!local) return;
  if (active) local.setItem(SESSION_MARKER_KEY, "active");
  else local.removeItem(SESSION_MARKER_KEY);
}

export function clearCsrfToken() {
  cachedCsrfToken = "";
  pendingCsrfToken = null;
}

function notifyUnauthorized() {
  setSessionMarker(false);
  clearCsrfToken();
  unauthorizedSubscribers.forEach((subscriber) => subscriber());
}

/**
 * @param {() => void} subscriber
 */
export function onUnauthorized(subscriber) {
  unauthorizedSubscribers.add(subscriber);
  return () => {
    unauthorizedSubscribers.delete(subscriber);
  };
}

async function readErrorPayload(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try { return await response.json(); }
    catch (error) {
      if (isAbortError(error)) throw error;
      // Keep the HTTP status authoritative even if its error body is broken.
      // In particular a 401 must still end the session, and 429 keeps headers.
      return null;
    }
  }

  const text = await response.text().catch(() => "");
  if (!text) return null;
  if (contentType.includes("text/html") || isHtmlErrorMessage(text)) {
    return { error: { message: "The server could not complete this request.", code: "server_html_error" } };
  }
  return { error: { message: normalizeUserError(text, "The server could not complete this request.") } };
}

async function fetchCsrfToken() {
  const deadline = timeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await withinSignal(fetch(apiPath("/auth/csrf"), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: deadline?.signal
    }), deadline?.signal);
    reportConnectionSuccess();
    if (!response.ok) {
      throw new ApiError(response.status, await withinSignal(readErrorPayload(response), deadline?.signal),
        "Unable to establish a secure session with the server.", "csrf_bootstrap_failed");
    }
    let payload;
    try { payload = await withinSignal(response.json(), deadline?.signal); }
    catch (error) {
      if (isAbortError(error)) throw error;
      throw new ApiError(response.status, null, "The server returned an incomplete response.", "invalid_response");
    }
    const token = (payload && typeof payload.csrf_token === "string" && payload.csrf_token) || readCsrfCookie();
    if (!token) throw new ApiError(response.status, null, "Unable to establish a secure session with the server.", "csrf_token_missing");
    return token;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    reportConnectionFailure();
    throw new ApiError(0, null, "Unable to establish a secure session with the server.", "csrf_bootstrap_failed");
  } finally { deadline?.clear(); }
}

export async function ensureCsrfToken() {
  const availableToken = cachedCsrfToken || readCsrfCookie();
  if (availableToken) return availableToken;
  if (pendingCsrfToken) return pendingCsrfToken;

  const request = fetchCsrfToken()
    .then((token) => {
      if (pendingCsrfToken === request) cachedCsrfToken = token;
      return token;
    })
    .finally(() => {
      if (pendingCsrfToken === request) pendingCsrfToken = null;
    });
  pendingCsrfToken = request;
  return request;
}

async function parseResponse(response, responseType) {
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const error = new ApiError(
      response.status,
      payload,
      "Request failed (" + response.status + ")."
    );
    // 401 is an expired credential. Django also answers 403 for a request that
    // arrives with no usable session at all -- which is what a session revoked
    // on the server, or a sign-out performed on another device, looks like from
    // here. Only that precise code counts: a permission_denied 403 is a real
    // answer about a live session, and a CSRF failure is not an ended one.
    if (response.status === 401 || (response.status === 403 && error.code === "not_authenticated")) {
      notifyUnauthorized();
    }
    const reference = response.headers?.get("X-Request-ID");
    if (!error.request_id && reference && /^[a-zA-Z0-9_-]{1,128}$/.test(reference)) {
      error.request_id = reference;
      error.requestId = reference;
    }
    error.retryAfterSeconds = retryAfterSeconds(response.headers?.get("Retry-After"));
    error.retryAt = error.retryAfterSeconds === null ? null : Date.now() + error.retryAfterSeconds * 1000;
    throw error;
  }

  if (response.status === 204) return null;
  if (responseType === "blob") return response.blob();
  if (responseType === "arraybuffer") return response.arrayBuffer();
  if (responseType === "text") return response.text();
  try { return await response.json(); }
  catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(response.status, null, "The server returned an incomplete response.", "invalid_response");
  }
}

/**
 * Makes a same-origin request inside the configured Django API path.
 * @param {string} path
 * @param {ApiRequestOptions} [options]
 * The API modules perform endpoint-specific validation where a strict shape is
 * security- or workflow-critical. Unspecified JSON remains dynamic in this JS client.
 * @returns {Promise<any>}
 */
export async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (isOffline() && isUnsafe(method) && !options.allowOfflineQueue) {
    throw new ApiError(0, null, "You’re offline. This action needs a connection before it can be confirmed.", "offline");
  }
  const headers = new Headers(options.headers || {});
  const body = normaliseRequestBody(options.body, headers);
  const language = readerLanguage();
  if (language && !headers.has("Accept-Language")) headers.set("Accept-Language", language);

  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  // One budget covers CSRF preparation, headers AND response body. A caller's
  // cancellation stops only its wait, never another caller's shared bootstrap.
  const deadline = timeoutSignal(requestTimeoutMs(options, method));
  const signal = combineSignals(options.signal, deadline?.signal);
  const defaultRead = deadline && ["GET", "HEAD"].includes(method) && !(Number(options.timeoutMs) > 0);
  const stopWatching = defaultRead ? subscribeConnection(({ status }) => {
    if (status !== "connected") deadline.shorten(status === "offline" ? OFFLINE_READ_TIMEOUT_MS : UNREACHABLE_READ_TIMEOUT_MS);
  }) : () => {};
  const retryable = options.retryable === true || ["GET", "HEAD", "OPTIONS"].includes(method);
  let requestSent = false;
  try {
    if (isUnsafe(method)) headers.set("X-CSRFToken", await withinSignal(ensureCsrfToken(), signal));
    let response;
    for (let attempt = 0; ; attempt += 1) {
      try {
        requestSent = true;
        response = await withinSignal(fetch(apiPath(path), { method, headers, body: /** @type {BodyInit | null | undefined} */ (body), credentials: "include", signal }), signal);
        reportConnectionSuccess();
        break;
      } catch (error) {
        if (error instanceof ApiError || isAbortError(error) || signal?.aborted) throw error;
        reportConnectionFailure();
        if (retryable && attempt < 2 && !browserReportsOffline()) {
          await withinSignal(new Promise(resolve => setTimeout(resolve, [400, 1100][attempt])), signal);
          continue;
        }
        throw new ApiError(0, null, "Network error. Check your connection and try again.", "network_error");
      }
    }
    return await withinSignal(parseResponse(response, options.responseType || "json"), signal);
  } catch (cause) {
    let error = cause;
    if (deadline?.expired) {
      reportConnectionFailure();
      error = new ApiError(0, null, "The server took too long to answer. Check your connection and try again.", "timeout");
    } else if (isAbortError(cause)) {
      error = new ApiError(0, null, "This request was cancelled.", "aborted");
    }
    if (error instanceof ApiError) {
      // A bootstrap rejection can be shared; never attach one request's state
      // to the Error that another request is also waiting on.
      const failure = new ApiError(error.status, error.payload, error.rawMessage, error.code);
      failure.request_id = error.request_id;
      failure.requestId = error.request_id;
      failure.retryAfterSeconds = error.retryAfterSeconds;
      failure.retryAt = error.retryAt;
      failure.method = method;
      failure.requestSent = requestSent;
      failure.message = userErrorMessage(failure, { locale: readerLanguage() });
      throw failure;
    }
    throw error;
  } finally {
    deadline?.clear();
    stopWatching();
  }
}

configureConnectionProbe(async () => {
  // A probe that can hang would leave the state "reconnecting" forever on a
  // radio that reports a connection but carries nothing.
  const deadline = timeoutSignal(UNREACHABLE_READ_TIMEOUT_MS);
  try {
    const response = await fetch(apiPath("/auth/csrf"), { credentials: "include", headers: { Accept: "application/json" }, signal: deadline?.signal });
    if (!response) throw new Error("No response");
  } finally {
    deadline?.clear();
  }
});

export const apiClient = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, options) => request(path, { ...options, method: "POST" }),
  put: (path, options) => request(path, { ...options, method: "PUT" }),
  patch: (path, options) => request(path, { ...options, method: "PATCH" }),
  del: (path, options) => request(path, { ...options, method: "DELETE" })
};

export const __testing = {
  apiPath,
  isUnsafe,
  reset() {
    cachedCsrfToken = "";
    pendingCsrfToken = null;
    unauthorizedSubscribers.clear();
    setSessionMarker(false);
  }
};
