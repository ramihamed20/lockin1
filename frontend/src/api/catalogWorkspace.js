import { request } from "./client.js";
import { generateIdempotencyKey } from "./pagination.js";
import { resolveContent, resolveQuestions, resolveStored } from "../offline/resolver.js";
import { answerQuestionOffline } from "../offline/queue.js";

export const catalogWorkspaceApi = {
  materials() {
    return request("/catalog/materials");
  },
  /**
   * The Questions directory. Same subjects and same sheet names as
   * `materials()`, narrowed to the sheets that carry published questions.
   */
  questionMaterials(source = "", userId = "") {
    return resolveStored(userId, `question-directory:${source}`, () => request("/catalog/questions" + (source ? `?source=${encodeURIComponent(source)}` : "")));
  },
  /**
   * One Material sheet's published questions.
   * @param {string} sheetId
   * @param {{ signal?: AbortSignal, source?: string, userId?: string }} [options]
   */
  sheetQuestions(sheetId, { signal, source = "", userId = "" } = {}) {
    return resolveQuestions(userId, sheetId, source, () => request(`/catalog/sheets/${encodeURIComponent(sheetId)}/questions` + (source ? `?source=${encodeURIComponent(source)}` : ""), { signal }));
  },
  /**
   * Submit one answer. The server grades it and awards its XP exactly once, so
   * a retry returns the answer already recorded rather than a second award.
   * @param {string} sheetId
   * @param {string} questionId
   * @param {string[]} choiceIds
   */
  answerQuestion(sheetId, questionId, choiceIds, { userId = "", source = "" } = {}) {
    return resolveContent(userId, () => request(`/catalog/sheets/${encodeURIComponent(sheetId)}/questions/${encodeURIComponent(questionId)}/answer`, {
      method: "POST", retryable: true, body: { choice_ids: choiceIds }
    }), () => answerQuestionOffline(userId, sheetId, source, questionId, choiceIds));
  },
  /**
   * Try an answered question again. The recorded answer and XP stay put; a
   * wrong try is one more mistake in Review, counted once per `retryKey`.
   * @param {string} sheetId
   * @param {string} questionId
   * @param {string[]} choiceIds
   */
  retryQuestion(sheetId, questionId, choiceIds, retryKey = generateIdempotencyKey()) {
    return request(`/catalog/sheets/${encodeURIComponent(sheetId)}/questions/${encodeURIComponent(questionId)}/retry`, {
      method: "POST", retryable: true, body: { choice_ids: choiceIds, retry_key: retryKey }
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
