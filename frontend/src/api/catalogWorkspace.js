import { request } from "./client.js";
import { generateIdempotencyKey } from "./pagination.js";

export const catalogWorkspaceApi = {
  materials() {
    return request("/catalog/materials");
  },
  /**
   * The Questions directory. Same subjects and same sheet names as
   * `materials()`, narrowed to the sheets that carry published questions.
   */
  questionMaterials() {
    return request("/catalog/questions");
  },
  /**
   * One Material sheet's published questions.
   * @param {string} sheetId
   * @param {{ signal?: AbortSignal }} [options]
   */
  sheetQuestions(sheetId, { signal } = {}) {
    return request(`/catalog/sheets/${encodeURIComponent(sheetId)}/questions`, { signal });
  },
  /**
   * @param {string} materialSlug
   * @param {string} sheetSlug
   * @param {{ signal?: AbortSignal, view?: string }} [options] `view: "summary"`
   * resolves that edition's Sheet Summary instead of its study PDF.
   */
  resolve(materialSlug, sheetSlug, { signal, view = "" } = {}) {
    return request(`/catalog/documents/${encodeURIComponent(materialSlug)}/${encodeURIComponent(sheetSlug)}` + (view && view !== "study" ? `?view=${encodeURIComponent(view)}` : ""), { signal });
  },
  get(documentId) { return request(`/catalog/documents/${documentId}/workspace`); },
  probe(documentId) { return request(`/catalog/documents/${documentId}/workspace?probe=1`); },
  save(documentId, expectedRevision, state, idempotencyKey = generateIdempotencyKey()) {
    return request(`/catalog/documents/${documentId}/workspace`, {
      method: "PATCH", retryable: true, allowOfflineQueue: true,
      body: { expected_revision: expectedRevision, state, idempotency_key: idempotencyKey }
    });
  }
};
