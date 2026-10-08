import { ApiError } from "./client.js";
import { normalizePaginatedResponse } from "./contracts.js";

/** @param {unknown} payload @param {string} message */
export function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

/** @param {unknown} payload @param {string} message */
export function pagePayload(payload, message) {
  const source = objectPayload(payload, message);
  if (!Array.isArray(source.results) || typeof source.count !== "number") {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return normalizePaginatedResponse(source);
}
