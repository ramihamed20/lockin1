import { request, ApiError } from "./client.js";
import { objectPayload } from "./payloads.js";
import { buildQueryString } from "./pagination.js";
import { normalizeAssistanceIdea } from "../lib/studyAssistance.js";

const documentPath = (id) => "/catalog/documents/" + encodeURIComponent(id) + "/assistance";
const adminPath = (id) => "/operations/admin/content/sheets/" + encodeURIComponent(id) + "/assistance";

export const studyAssistanceApi = {
  /** @param {string} documentId @param {{page?: number, view?: string, saved?: boolean, signal?: AbortSignal}} [options] */
  async list(documentId, options = {}) {
    const { page, view = "study", saved = false, signal } = options;
    const query = buildQueryString({ page: saved ? undefined : page, view, saved: saved ? "true" : undefined });
    const payload = objectPayload(await request(documentPath(documentId) + query, { signal }), "Study help could not be loaded.");
    return { versionId: payload.version_id, results: (Array.isArray(payload.results) ? payload.results : []).map(normalizeAssistanceIdea).filter(Boolean) };
  },
  async save(documentId, ideaId, view, saved) {
    const payload = objectPayload(await request(documentPath(documentId) + "/" + encodeURIComponent(ideaId) + "/saved", {
      method: "PUT", body: { view, saved }, allowOfflineQueue: false
    }), "The idea could not be saved.");
    const idea = normalizeAssistanceIdea(payload.idea);
    if (!idea || idea.id !== ideaId || idea.saved !== saved) throw new ApiError(502, null, "The save was not confirmed.", "invalid_response");
    return idea;
  }
};

export const studyAssistanceAdminApi = {
  async importContext(sheetId, edition, view, signal) {
    return objectPayload(await request(adminPath(sheetId) + "/import" + buildQueryString({ edition, view }), { signal }), "Import context could not be loaded.");
  },
  async importCards(sheetId, payload, publish = false, previewToken = "") {
    return objectPayload(await request(adminPath(sheetId) + "/import", {
      method: "POST", body: { payload, publish, ...(previewToken ? { preview_token: previewToken } : {}) }, allowOfflineQueue: false
    }), "Cards could not be imported.");
  },
  /** @param {string} sheetId @param {{edition?: string, view?: string, signal?: AbortSignal}} [options] */
  async list(sheetId, options = {}) {
    const { edition = "university", view = "study", signal } = options;
    const payload = objectPayload(await request(adminPath(sheetId) + buildQueryString({ edition, view }), { signal }), "Study help could not be loaded.");
    return { results: Array.isArray(payload.results) ? payload.results : [], version_id: String(payload.version_id || ""), available: payload.available === true, page_count: typeof payload.page_count === "number" ? payload.page_count : null };
  },
  async save(sheetId, ideaId, body) {
    const path = adminPath(sheetId) + (ideaId ? "/" + encodeURIComponent(ideaId) : "");
    const payload = objectPayload(await request(path, { method: ideaId ? "PATCH" : "POST", body }), "The idea could not be saved.");
    return /** @type {any} */ (payload.idea);
  }
};
