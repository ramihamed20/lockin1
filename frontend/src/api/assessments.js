import { ApiError, request } from "./client.js";
import { normalizePaginatedResponse } from "./contracts.js";
import { buildQueryString } from "./pagination.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

function pagePayload(payload, message) {
  const source = objectPayload(payload, message);
  if (!Array.isArray(source.results) || typeof source.count !== "number") {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return normalizePaginatedResponse(source);
}

function attemptPayload(payload, message) {
  const source = objectPayload(payload, message);
  if (!source.attempt || typeof source.attempt !== "object" || typeof source.resumed !== "boolean") {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return source;
}

/** Server-authoritative public quizzes, attempts, released results, and review. */
export const assessmentsApi = {
  async listQuizzes({ nodeId = null, mode = null, page = 1, pageSize = 25 } = {}) {
    const payload = await request(
      "/quizzes" + buildQueryString({ node: nodeId, mode, page, page_size: pageSize })
    );
    return pagePayload(payload, "The quiz list response was incomplete.");
  },

  async getQuiz(quizId) {
    return objectPayload(
      await request(`/quizzes/${quizId}`),
      "The quiz response was incomplete."
    );
  },

  /**
   * @param {string} quizId
   * @param {{idempotencyKey?: string, questionCount?: number, difficulties?: string[], reviewOnly?: boolean}} [options]
   */
  async startAttempt(quizId, options = {}) {
    const { idempotencyKey, questionCount, difficulties = [], reviewOnly = false } = options;
    if (typeof idempotencyKey !== "string" || !idempotencyKey) {
      throw new ApiError(0, null, "A stable attempt idempotency key is required.", "invalid_request");
    }
    const body = { idempotency_key: idempotencyKey, review_only: reviewOnly };
    if (questionCount != null) body.question_count = questionCount;
    if (Array.isArray(difficulties) && difficulties.length) body.difficulties = difficulties;
    return attemptPayload(
      await request(`/quizzes/${quizId}/attempts`, { method: "POST", body }),
      "The attempt-start response was incomplete."
    );
  },

  async getAttempt(attemptId) {
    return objectPayload(
      await request(`/attempts/${attemptId}`),
      "The attempt response was incomplete."
    );
  },

  async saveAnswer(attemptId, attemptQuestionId, { selectedOptionIds, clientRevision }) {
    return objectPayload(
      await request(`/attempts/${attemptId}/questions/${attemptQuestionId}/answer`, {
        method: "PUT",
        body: {
          selected_option_ids: selectedOptionIds,
          client_revision: clientRevision
        }
      }),
      "The answer-save response was incomplete."
    );
  },

  async submitAttempt(attemptId, idempotencyKey) {
    return objectPayload(
      await request(`/attempts/${attemptId}/submit`, {
        method: "POST",
        body: { idempotency_key: idempotencyKey }
      }),
      "The attempt-submission response was incomplete."
    );
  },

  async recordActivity(attemptId, { clientEventId, activityType, clientOccurredAt = null, metadata = {} }) {
    return objectPayload(
      await request(`/attempts/${attemptId}/activities`, {
        method: "POST",
        body: {
          client_event_id: clientEventId,
          activity_type: activityType,
          client_occurred_at: clientOccurredAt,
          metadata
        }
      }),
      "The activity response was incomplete."
    );
  },

  async getResult(resultId) {
    return objectPayload(
      await request(`/assessment-results/${resultId}`),
      "The assessment-result response was incomplete."
    );
  },

  async reportQuestionIssue(resultId, { attemptQuestionId, category, details }) {
    return objectPayload(
      await request(`/assessment-results/${resultId}/reports`, {
        method: "POST",
        body: {
          attempt_question_id: attemptQuestionId,
          category,
          details
        }
      }),
      "The issue-report response was incomplete."
    );
  },

  async getReviewQueue() {
    const payload = objectPayload(
      await request("/assessment-review"),
      "The assessment-review response was incomplete."
    );
    if (!Array.isArray(payload.results) || typeof payload.count !== "number") {
      throw new ApiError(500, payload, "The assessment-review response was incomplete.", "invalid_response");
    }
    return payload;
  }
};
