import { API_BASE_PATH, ApiError, ensureCsrfToken, FILE_REQUEST_TIMEOUT_MS, request } from "./client.js";
import { generateIdempotencyKey } from "./pagination.js";

export const PERSONAL_SHEET_MAX_BYTES = 20 * 1024 * 1024;
// The reader files a personal sheet's device copy under this material slug.
export const PERSONAL_MATERIAL = "personal";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only a same-origin managed-file view, which Django authorizes per request.
const VIEW_URL_PATTERN = /^\/api\/v1\/files\/[0-9a-f-]+\/view$/i;

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   pageCount: number,
 *   sizeBytes: number,
 *   createdAt: string,
 *   status: "ready" | "processing" | "unavailable",
 *   viewUrl: string,
 *   activeStudy: { status: string }
 * }} PersonalSheet
 * @typedef {{ maxSheets: number, maxFileBytes: number, used: number, remaining: number }} PersonalSheetLimits
 */

/** @returns {PersonalSheet | null} */
export function parsePersonalSheet(value) {
  if (!value || typeof value !== "object" || !UUID_PATTERN.test(String(value.id))) return null;
  const status = ["ready", "processing"].includes(value.status) ? value.status : "unavailable";
  const viewUrl = status === "ready" && VIEW_URL_PATTERN.test(String(value.view_url)) ? String(value.view_url) : "";
  return {
    id: String(value.id),
    title: String(value.title || ""),
    pageCount: Number(value.page_count) || 0,
    sizeBytes: Number(value.size_bytes) || 0,
    createdAt: String(value.created_at || ""),
    status: viewUrl ? status : status === "ready" ? "unavailable" : status,
    viewUrl,
    activeStudy: { status: String(value.active_study?.status || "unavailable") }
  };
}

/** @returns {PersonalSheetLimits} */
export function parseLimits(value) {
  const maxSheets = Number(value?.max_sheets) || 20;
  const used = Math.max(0, Number(value?.used) || 0);
  return {
    maxSheets,
    maxFileBytes: Number(value?.max_file_bytes) || PERSONAL_SHEET_MAX_BYTES,
    used,
    remaining: Math.max(0, Number(value?.remaining ?? maxSheets - used))
  };
}

function collectionPath(materialSlug) {
  return `/catalog/materials/${encodeURIComponent(materialSlug)}/personal-sheets`;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * multipart upload through XHR, the one browser API that reports upload
 * progress; CSRF and the error envelope match `request()`.
 * @param {string} path
 * @param {FormData} body
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} options
 */
export async function uploadWithProgress(path, body, { onProgress, signal } = {}) {
  const token = await ensureCsrfToken();
  return new Promise((resolve, reject) => {
    const xhr = new globalThis.XMLHttpRequest();
    xhr.open("POST", `${API_BASE_PATH}${path}`);
    xhr.withCredentials = true;
    xhr.timeout = FILE_REQUEST_TIMEOUT_MS;
    xhr.setRequestHeader("X-CSRFToken", token);
    xhr.setRequestHeader("Accept", "application/json");
    const language = typeof document === "undefined" ? "" : document.documentElement.lang;
    if (language) xhr.setRequestHeader("Accept-Language", language);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      const payload = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new ApiError(xhr.status, payload, `Request failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new ApiError(0, null, "The upload could not reach the server. Check your connection and try again.", "network_error"));
    xhr.ontimeout = () => reject(new ApiError(0, null, "The upload took too long. Check your connection and try again.", "timeout"));
    xhr.onabort = () => reject(new ApiError(0, null, "The upload was cancelled.", "aborted"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

export const personalSheetsApi = {
  /**
   * @param {string} materialSlug
   * @param {{ signal?: AbortSignal }} [options]
   */
  async list(materialSlug, { signal } = {}) {
    const payload = await request(collectionPath(materialSlug), { signal });
    return {
      subject: { slug: String(payload?.subject?.slug || materialSlug), title: String(payload?.subject?.title || "") },
      sheets: (Array.isArray(payload?.results) ? payload.results : []).map(parsePersonalSheet).filter(Boolean),
      limits: parseLimits(payload?.limits)
    };
  },
  /**
   * @param {string} materialSlug
   * @param {{ title: string, file: File }} input
   * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [options]
   */
  async add(materialSlug, { title, file }, options = {}) {
    const body = new FormData();
    body.append("title", title);
    body.append("file", file);
    const payload = await uploadWithProgress(collectionPath(materialSlug), body, options);
    const sheet = parsePersonalSheet(payload?.sheet);
    if (!sheet) throw new ApiError(0, payload, "The upload response was incomplete.");
    return { sheet, limits: parseLimits(payload?.limits) };
  },
  /**
   * @param {string} sheetId
   * @param {{ signal?: AbortSignal }} [options]
   */
  async get(sheetId, { signal } = {}) {
    const payload = await request(`/personal-sheets/${encodeURIComponent(sheetId)}`, { signal });
    const sheet = parsePersonalSheet(payload?.sheet);
    if (!sheet) throw new ApiError(404, payload, "Sheet not found.", "not_found");
    return { sheet, subject: { slug: String(payload?.subject?.slug || ""), title: String(payload?.subject?.title || "") } };
  },
  /** @param {string[]} ids */
  async remove(ids) {
    const payload = await request("/personal-sheets/delete", { method: "POST", body: { ids } });
    return { deleted: Number(payload?.deleted) || 0, limits: parseLimits(payload?.limits) };
  }
};

/**
 * Reader state of a personal sheet, in the catalog workspace's shape so the
 * Focus sync runs over it unchanged. Its ink syncs through the Focus
 * annotation routes under the sheet's id.
 */
export const personalWorkspaceApi = {
  get(sheetId) { return request(`/personal-sheets/${encodeURIComponent(sheetId)}/workspace`); },
  probe(sheetId) { return request(`/personal-sheets/${encodeURIComponent(sheetId)}/workspace?probe=1`); },
  save(sheetId, expectedRevision, state, idempotencyKey = generateIdempotencyKey()) {
    return request(`/personal-sheets/${encodeURIComponent(sheetId)}/workspace`, {
      method: "PATCH", retryable: true, allowOfflineQueue: true,
      body: { expected_revision: expectedRevision, state, idempotency_key: idempotencyKey }
    });
  }
};
