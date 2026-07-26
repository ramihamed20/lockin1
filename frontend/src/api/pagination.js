const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function normalisePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Builds Django query parameters. Arrays use the backend's documented
 * comma-separated format; endpoints that need repeated values build them
 * explicitly instead of relying on this helper.
 * @param {Record<string, unknown>} params
 */
export function buildQueryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (Array.isArray(value)) {
      const values = value.filter((item) => item != null && item !== "").map(String);
      if (values.length) query.set(key, values.join(","));
      return;
    }
    query.set(key, String(value));
  });
  const value = query.toString();
  return value ? "?" + value : "";
}

/**
 * Matches Django LockinPagination: page/page_size, default 25, max 100.
 * @param {number} [page]
 * @param {number} [pageSize]
 */
export function createPageState(page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  return {
    page: normalisePositiveInteger(page, 1),
    pageSize: Math.min(MAX_PAGE_SIZE, normalisePositiveInteger(pageSize, DEFAULT_PAGE_SIZE))
  };
}

/**
 * @param {string|null} [cursor]
 * @param {number} [pageSize]
 */
export function createCursorState(cursor = null, pageSize = DEFAULT_PAGE_SIZE) {
  return {
    cursor: typeof cursor === "string" && cursor ? cursor : null,
    pageSize: Math.min(MAX_PAGE_SIZE, normalisePositiveInteger(pageSize, DEFAULT_PAGE_SIZE))
  };
}

/**
 * @param {{page?: number, pageSize?: number, cursor?: string|null}} state
 */
export function resetPagination(state = {}) {
  return {
    ...state,
    page: 1,
    cursor: null
  };
}

export function generateIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }

  throw new Error("A secure random source is required to create an idempotency key.");
}
