/* global __APP_VERSION__ */
import { apiClient } from "../api/client.js";

const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "development";
const recentlyReported = new Map();
const DEDUPLICATION_WINDOW_MS = 30_000;

function safeErrorType(value) {
  const candidate = value?.name || value?.constructor?.name || "UnknownError";
  const normalized = String(candidate).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  return /^[A-Za-z]/.test(normalized) ? normalized : "UnknownError";
}

const IDENTIFIER_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

/**
 * The route an error happened on. The app uses a hash router, so the path is
 * always "/" and the route lives in the hash; identifiers are collapsed so
 * reports group by screen and carry no record ids.
 */
export function reportedRoute(location) {
  const hash = String(location?.hash || "");
  const raw = hash.startsWith("#/") ? hash.slice(1) : String(location?.pathname || "/");
  const path = raw.split(/[?#]/)[0] || "/";
  return path.split("/").map((segment) => (IDENTIFIER_SEGMENT.test(segment) ? ":id" : segment)).join("/").slice(0, 200) || "/";
}

export function buildClientErrorEnvelope(eventType, value, location = window.location) {
  return {
    event_type: eventType,
    error_type: safeErrorType(value),
    route: reportedRoute(location),
    release: APP_VERSION.slice(0, 80)
  };
}

export function reportClientError(eventType, value, location) {
  const envelope = buildClientErrorEnvelope(eventType, value, location);
  const key = `${envelope.event_type}|${envelope.error_type}|${envelope.route}`;
  const now = Date.now();
  if (now - (recentlyReported.get(key) || 0) < DEDUPLICATION_WINDOW_MS) return;
  recentlyReported.set(key, now);
  if (recentlyReported.size > 50) recentlyReported.delete(recentlyReported.keys().next().value);
  apiClient.post("/telemetry/client-errors", { body: envelope }).catch(() => {});
}

export function installClientErrorReporting(target = window) {
  target.addEventListener("error", (event) => {
    reportClientError("error", event.error || { name: "ScriptError" }, target.location);
  });
  target.addEventListener("unhandledrejection", (event) => {
    reportClientError("unhandledrejection", event.reason, target.location);
  });
}

export const __testing = {
  reset() {
    recentlyReported.clear();
  }
};
