import { isHtmlErrorMessage, normalizeUserError } from "../lib/errors.js";

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
 *   signal?: AbortSignal
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
      (error && typeof error.message === "string" && error.message) ||
        fieldMessage ||
        detail ||
        fallbackMessage,
      fallbackMessage
    ));
    this.name = "ApiError";
    this.status = status;
    this.code = (error && typeof error.code === "string" && error.code) || fallbackCode;
    this.fields = fields;
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
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  if (!text) return null;
  if (contentType.includes("text/html") || isHtmlErrorMessage(text)) {
    return { error: { message: "The server could not complete this request.", code: "server_html_error" } };
  }
  return { error: { message: normalizeUserError(text, "The server could not complete this request.") } };
}

async function fetchCsrfToken() {
  const response = await fetch(apiPath("/auth/csrf"), {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new ApiError(
      response.status,
      payload,
      "Unable to establish a secure session with the server.",
      "csrf_bootstrap_failed"
    );
  }

  const payload = await response.json().catch(() => null);
  const token =
    (payload && typeof payload.csrf_token === "string" && payload.csrf_token) || readCsrfCookie();
  if (!token) {
    throw new ApiError(
      response.status,
      payload,
      "The server did not provide a CSRF token.",
      "csrf_token_missing"
    );
  }

  return token;
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
    if (response.status === 401) notifyUnauthorized();
    throw error;
  }

  if (response.status === 204) return null;
  if (responseType === "blob") return response.blob();
  if (responseType === "arraybuffer") return response.arrayBuffer();
  if (responseType === "text") return response.text();
  return response.json().catch(() => null);
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
  const headers = new Headers(options.headers || {});
  const body = normaliseRequestBody(options.body, headers);

  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }
  if (isUnsafe(method)) {
    headers.set("X-CSRFToken", await ensureCsrfToken());
  }

  let response;
  try {
    response = await fetch(apiPath(path), {
      method,
      headers,
      body: /** @type {BodyInit | null | undefined} */ (body),
      credentials: "include",
      signal: options.signal
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      null,
      "Network error. Check your connection and try again.",
      "network_error"
    );
  }

  return parseResponse(response, options.responseType || "json");
}

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
    unauthorizedSubscribers.clear();
    setSessionMarker(false);
  }
};
