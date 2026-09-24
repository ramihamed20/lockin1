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
  questionMaterials(source = "") {
    return request("/catalog/questions" + (source ? `?source=${encodeURIComponent(source)}` : ""));
  },
  /**
   * One Material sheet's published questions.
   * @param {string} sheetId
   * @param {{ signal?: AbortSignal, source?: string }} [options]
   */
  sheetQuestions(sheetId, { signal, source = "" } = {}) {
    return request(`/catalog/sheets/${encodeURIComponent(sheetId)}/questions` + (source ? `?source=${encodeURIComponent(source)}` : ""), { signal });
  },
  /**
   * Submit one answer. The server grades it and awards its XP exactly once, so
   * a retry returns the answer already recorded rather than a second award.
   * @param {string} sheetId
   * @param {string} questionId
   * @param {string[]} choiceIds
   */
  answerQuestion(sheetId, questionId, choiceIds) {
    return request(`/catalog/sheets/${encodeURIComponent(sheetId)}/questions/${encodeURIComponent(questionId)}/answer`, {
      method: "POST", retryable: true, body: { choice_ids: choiceIds }
    });
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
