export const PRODUCT_ROLES = Object.freeze({
  STUDENT: "student",
  MODERATOR: "moderator",
  CREATOR: "creator",
  ADMINISTRATOR: "administrator"
});

/**
 * @typedef {{
 *   id: string,
 *   email: string,
 *   full_name: string,
 *   preferred_language: "en"|"ar"|string,
 *   status: string,
 *   is_email_verified: boolean,
 *   roles: string[],
 *   date_joined: string|null
 * }} UserContract
 */

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * Normalizes Django's UserSerializer response without inventing profile fields.
 * @param {unknown} payload
 * @returns {UserContract|null}
 */
export function normalizeUser(payload) {
  if (!payload || typeof payload !== "object") return null;
  const source = /** @type {Record<string, unknown>} */ (payload);
  const id = stringOrEmpty(source.id);
  if (!id) return null;

  return {
    id,
    email: stringOrEmpty(source.email),
    full_name: stringOrEmpty(source.full_name),
    preferred_language: stringOrEmpty(source.preferred_language),
    status: stringOrEmpty(source.status),
    is_email_verified: source.is_email_verified === true,
    roles: stringList(source.roles),
    date_joined: typeof source.date_joined === "string" ? source.date_joined : null
  };
}

/**
 * @param {unknown} payload
 */
export function normalizeSessionResponse(payload) {
  if (!payload || typeof payload !== "object") {
    return { authenticated: false, user: null };
  }
  const source = /** @type {Record<string, unknown>} */ (payload);
  const user = normalizeUser(source.user);
  return { authenticated: Boolean(user), user };
}

/**
 * Normalizes GET /api/v1/operations/session. This is intentionally separate
 * from GET /api/v1/auth/session.
 * @param {unknown} payload
 */
export function normalizeOperationsSession(payload) {
  if (!payload || typeof payload !== "object") return null;
  const source = /** @type {Record<string, unknown>} */ (payload);
  if (
    !Array.isArray(source.roles) ||
    !Array.isArray(source.capabilities) ||
    !Array.isArray(source.dashboards) ||
    typeof source.timezone !== "string"
  ) {
    return null;
  }

  return {
    roles: stringList(source.roles),
    capabilities: stringList(source.capabilities),
    dashboards: stringList(source.dashboards),
    timezone: stringOrEmpty(source.timezone)
  };
}

/**
 * @param {unknown} payload
 */
export function normalizePaginatedResponse(payload) {
  const source =
    payload && typeof payload === "object" ? /** @type {Record<string, unknown>} */ (payload) : {};
  return {
    count: typeof source.count === "number" ? source.count : 0,
    next: typeof source.next === "string" ? source.next : null,
    previous: typeof source.previous === "string" ? source.previous : null,
    results: Array.isArray(source.results) ? source.results : []
  };
}

/**
 * @param {unknown} error
 */
export function normalizeError(error) {
  if (error && typeof error === "object") {
    const source = /** @type {Record<string, unknown>} */ (error);
    return {
      status: typeof source.status === "number" ? source.status : 0,
      code: typeof source.code === "string" ? source.code : "request_failed",
      message: typeof source.message === "string" ? source.message : "The request could not be completed.",
      fields: source.fields && typeof source.fields === "object" ? source.fields : null,
      request_id:
        typeof source.request_id === "string"
          ? source.request_id
          : typeof source.requestId === "string"
            ? source.requestId
            : null
    };
  }

  return {
    status: 0,
    code: "request_failed",
    message: "The request could not be completed.",
    fields: null,
    request_id: null
  };
}
