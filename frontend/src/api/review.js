import { ApiError, request } from "./client.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, any>} */ (payload);
}

/** Central Review Bank, mistake events, and Weekly Recall API. */
export const reviewApi = {
  async getQueue() {
    const payload = objectPayload(
      await request("/review-queue"),
      "The recent-mistakes response was incomplete."
    );
    if (!Array.isArray(payload.results) || typeof payload.count !== "number") {
      throw new ApiError(500, payload, "The recent-mistakes response was incomplete.", "invalid_response");
    }
    return payload;
  },

  async getBank() {
    const payload = objectPayload(
      await request("/review-bank"),
      "The Review Bank response was incomplete."
    );
    if (!Array.isArray(payload.subjects) || typeof payload.active_count !== "number") {
      throw new ApiError(500, payload, "The Review Bank response was incomplete.", "invalid_response");
    }
    return payload;
  },

  async getSubject(subjectKey) {
    const payload = objectPayload(
      await request(`/review-bank/subjects/${encodeURIComponent(subjectKey)}`),
      "The subject review response was incomplete."
    );
    if (!Array.isArray(payload.results) || typeof payload.count !== "number") {
      throw new ApiError(500, payload, "The subject review response was incomplete.", "invalid_response");
    }
    return payload;
  },

  async answerItem(itemId, { selectedOptionIds, idempotencyKey }) {
    return objectPayload(
      await request(`/review-bank/items/${itemId}/answer`, {
        method: "POST",
        body: {
          selected_option_ids: selectedOptionIds,
          idempotency_key: idempotencyKey
        }
      }),
      "The review answer response was incomplete."
    );
  },

  async trackAttempt(attempt) {
    return objectPayload(
      await request("/question-attempts", {
        method: "POST",
        body: {
          idempotency_key: attempt.idempotencyKey,
          question_key: attempt.questionKey,
          subject_key: attempt.subjectKey,
          subject_label: attempt.subjectLabel,
          source_type: attempt.sourceType,
          source_id: attempt.sourceId || "",
          source_label: attempt.sourceLabel || "",
          source_question_index: attempt.sourceQuestionIndex,
          prompt: attempt.prompt,
          explanation: attempt.explanation || "",
          options: attempt.options,
          selected_option_ids: attempt.selectedOptionIds,
          correct_option_ids: attempt.correctOptionIds
        }
      }),
      "The question-attempt response was incomplete."
    );
  },

  async getWeeklyRecall() {
    return objectPayload(
      await request("/weekly-recall"),
      "The Weekly Recall response was incomplete."
    );
  },

  async startWeeklyRecall() {
    return objectPayload(
      await request("/weekly-recall", { method: "POST", body: {} }),
      "The Weekly Recall response was incomplete."
    );
  },

  async answerWeeklyRecall(sessionId, questionId, { selectedOptionIds, idempotencyKey }) {
    return objectPayload(
      await request(`/weekly-recall/${sessionId}/questions/${questionId}/answer`, {
        method: "POST",
        body: {
          selected_option_ids: selectedOptionIds,
          idempotency_key: idempotencyKey
        }
      }),
      "The Weekly Recall answer response was incomplete."
    );
  }
};
