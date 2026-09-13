import { request } from "./client.js";
import { generateIdempotencyKey } from "./pagination.js";

export const catalogWorkspaceApi = {
  materials() {
    return request("/catalog/materials");
  },
  /**
   * @param {string} materialSlug
   * @param {string} sheetSlug
   * @param {{ signal?: AbortSignal }} [options]
   */
  resolve(materialSlug, sheetSlug, { signal } = {}) {
    return request(`/catalog/documents/${encodeURIComponent(materialSlug)}/${encodeURIComponent(sheetSlug)}`, { signal });
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
