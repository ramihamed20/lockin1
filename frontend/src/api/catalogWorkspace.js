import { request } from "./client.js";
import { generateIdempotencyKey } from "./pagination.js";

export const catalogWorkspaceApi = {
  materials() {
    return request("/catalog/materials");
  },
  resolve(materialSlug, sheetSlug) {
    return request(`/catalog/documents/${encodeURIComponent(materialSlug)}/${encodeURIComponent(sheetSlug)}`);
  },
  get(documentId) { return request(`/catalog/documents/${documentId}/workspace`); },
  save(documentId, expectedRevision, state, idempotencyKey = generateIdempotencyKey()) {
    return request(`/catalog/documents/${documentId}/workspace`, {
      method: "PATCH", retryable: true, allowOfflineQueue: true,
      body: { expected_revision: expectedRevision, state, idempotency_key: idempotencyKey }
    });
  }
};
