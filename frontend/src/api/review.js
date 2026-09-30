import { ApiError, request } from "./client.js";
import { resolveReviewData, resolveContent } from "../offline/resolver.js";

function reviewRead(path, userId, key) {
  return resolveReviewData(userId, key, () => request(path));
}

/**
 * Answers try the server first; a lost connection queues them on the device
 * under the same idempotency key, so an answer the server did receive is
 * never counted twice.
 */
async function reviewWrite(userId, online, offline) {
  const { currentOfflineUserId } = await import("../offline/profile.js");
  return resolveContent(userId || currentOfflineUserId(), online, offline);
}

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, any>} */ (payload);
}

async function offlineReview(userId) {
  const [review, { currentOfflineUserId }] = await Promise.all([import("../offline/review.js"), import("../offline/profile.js")]);
  return { ...review, currentOwner: userId || currentOfflineUserId() };
}

/** Central Review Bank, mistake events, and Weekly Recall API. */
export const reviewApi = {
  async getQueue(userId = "") {
    const payload = objectPayload(
      await reviewRead("/review-queue", userId, "queue"),
      "The recent-mistakes response was incomplete."
    );
    if (!Array.isArray(payload.results) || typeof payload.count !== "number") {
      throw new ApiError(500, payload, "The recent-mistakes response was incomplete.", "invalid_response");
    }
    return payload;
  },

  async getBank(userId = "") {
    const payload = objectPayload(
      await reviewRead("/review-bank", userId, "bank"),
      "The Review Bank response was incomplete."
    );
    if (!Array.isArray(payload.subjects) || typeof payload.active_count !== "number") {
      throw new ApiError(500, payload, "The Review Bank response was incomplete.", "invalid_response");
    }
    return payload;
  },

  async getSubject(subjectKey, userId = "") {
    const payload = objectPayload(
      await reviewRead(`/review-bank/subjects/${encodeURIComponent(subjectKey)}`, userId, `subject:${subjectKey}`),
      "The subject review response was incomplete."
    );
    if (!Array.isArray(payload.results) || typeof payload.count !== "number") {
      throw new ApiError(500, payload, "The subject review response was incomplete.", "invalid_response");
    }
    return payload;
  },

  async answerItem(itemId, { selectedOptionIds, idempotencyKey, userId = "" }) {
    return objectPayload(
      await reviewWrite(userId, () => request(`/review-bank/items/${itemId}/answer`, {
        method: "POST",
        body: {
          selected_option_ids: selectedOptionIds,
          idempotency_key: idempotencyKey
        }
      }), async () => {
        const { answerReviewItemOffline, currentOwner } = await offlineReview(userId);
        return answerReviewItemOffline(currentOwner, itemId, { selectedOptionIds, idempotencyKey });
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
          question_type: attempt.questionType || "single_choice",
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

  async getWeeklyRecall(userId = "") {
    return objectPayload(
      await reviewRead("/weekly-recall", userId, "weekly"),
      "The Weekly Recall response was incomplete."
    );
  },

  async startWeeklyRecall() {
    return objectPayload(
      await request("/weekly-recall", { method: "POST", body: {} }),
      "The Weekly Recall response was incomplete."
    );
  },

  async answerWeeklyRecall(sessionId, questionId, { selectedOptionIds, idempotencyKey, userId = "" }) {
    return objectPayload(
      await reviewWrite(userId, () => request(`/weekly-recall/${sessionId}/questions/${questionId}/answer`, {
        method: "POST",
        body: {
          selected_option_ids: selectedOptionIds,
          idempotency_key: idempotencyKey
        }
      }), async () => {
        const { answerWeeklyRecallOffline, currentOwner } = await offlineReview(userId);
        return answerWeeklyRecallOffline(currentOwner, sessionId, questionId, { selectedOptionIds, idempotencyKey });
      }),
      "The Weekly Recall answer response was incomplete."
    );
  }
};
