import { ApiError, request } from "./client.js";
import { isConnectivityError } from "../offline/queue.js";
import { rememberPlan, restorePlan, submitPlanProgress } from "../offline/studyPlan.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return payload;
}

const nonnegativeInteger = value => Number.isInteger(value) && value >= 0;
const dateValue = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const previewTask = task => task && typeof task.key === "string" && typeof task.title === "string"
  && (task.activity === "review" ? typeof task.review_item_id === "string" && typeof task.start_url === "string" && task.start_url.startsWith("/review/bank/") : task.activity === "questions" ? Number.isInteger(task.question_count) && task.question_count >= 1 && typeof task.start_url === "string" && task.start_url.startsWith("/questions/categories/") : Number.isInteger(task.page_start) && task.page_start >= 1 && Number.isInteger(task.page_end) && task.page_end >= task.page_start)
  && Number.isInteger(task.estimated_minutes) && task.estimated_minutes > 0 && task.estimated_minutes <= 480;

export const studyPlanApi = {
  /** @param {{signal?: AbortSignal, user?: any}} [options] */
  async getExams({ signal, user } = {}) {
    let raw;
    try { raw = await request("/study-plan/v2/exams", { signal }); }
    catch (error) { const saved = isConnectivityError(error) && await restorePlan(user, "exams"); if (saved) return saved.payload.results; throw error; }
    const payload = objectPayload(raw, "The exam response was incomplete.");
    if (payload.enabled !== true || payload.schema_version !== 1 || !Array.isArray(payload.results)
      || payload.results.some(exam => typeof exam.id !== "string" || typeof exam.title !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(exam.starts_on) || !["tentative", "confirmed"].includes(exam.status))) {
      throw new ApiError(500, payload, "The exam response was incomplete.", "invalid_response");
    }
    await rememberPlan(user, "exams", payload);
    return payload.results;
  },

  async getChanges(periodId) {
    const result = objectPayload(await request(`/study-plan/v2/exams/${encodeURIComponent(periodId)}/changes`), "Could not check plan changes.");
    if (typeof result.has_plan !== "boolean" || typeof result.needs_review !== "boolean" || !Array.isArray(result.reasons)) {
      throw new ApiError(500, result, "The plan change response was incomplete.", "invalid_response");
    }
    return result;
  },

  /** @param {string} periodId @param {string} edition @param {{signal?: AbortSignal, includeReviews?: boolean, reportId?: string, includeActiveStudy?: boolean, includeQuestions?: boolean, replan?: boolean, difficulty?: string}} [options] */
  async previewReading(periodId, edition, { signal, includeReviews = false, reportId, includeActiveStudy = false, includeQuestions = false, replan = false, difficulty = "medium" } = {}) {
    const payload = objectPayload(await request(`/study-plan/v2/exams/${encodeURIComponent(periodId)}/reading-preview`, {
      method: "POST", body: { edition, ...(includeActiveStudy ? { include_active_study: true } : {}), ...(includeQuestions ? { include_questions: true } : {}), ...(replan ? { replan: true } : {}), ...(difficulty !== "medium" ? { difficulty } : {}), ...(includeReviews ? { include_reviews: true } : {}), ...(reportId ? { report_id: reportId } : {}) }, signal
    }), "The reading preview was incomplete.");
    if (!["reading_only_preview", "reading_and_review_preview"].includes(payload.kind) || payload.persisted !== false
      || (payload.kind === "reading_and_review_preview" && (!nonnegativeInteger(payload.required_review_minutes) || !nonnegativeInteger(payload.scheduled_review_minutes) || payload.scheduled_review_minutes > payload.required_review_minutes))
      || (payload.apply_token !== undefined && (typeof payload.apply_token !== "string" || !/^[a-f0-9]{64}$/.test(payload.apply_token)))
      || !Array.isArray(payload.assignments) || !Array.isArray(payload.unscheduled)
      || !Array.isArray(payload.issues) || !Array.isArray(payload.days)
      || (includeQuestions && (!nonnegativeInteger(payload.required_question_minutes) || !nonnegativeInteger(payload.scheduled_question_minutes) || payload.scheduled_question_minutes > payload.required_question_minutes))
      || !nonnegativeInteger(payload.required_reading_minutes) || !nonnegativeInteger(payload.scheduled_reading_minutes)
      || payload.required_reading_minutes < payload.scheduled_reading_minutes
      || !Number.isInteger(payload.profile_revision) || payload.profile_revision < 1
      || !payload.estimate || !Number.isFinite(payload.estimate.minutes_per_page) || payload.estimate.minutes_per_page <= 0
      || payload.assignments.some(task => !previewTask(task) || !dateValue(task.scheduled_date))
      || payload.unscheduled.some(task => !previewTask(task) || typeof task.reason !== "string")
      || payload.issues.some(issue => !issue || typeof issue.sheet_id !== "string" || typeof issue.reason !== "string" || typeof issue.title !== "string")
      || payload.days.some(day => !day || !dateValue(day.date) || !["available_minutes", "existing_minutes", "allocated_minutes", "remaining_minutes", "existing_overflow_minutes"].every(key => nonnegativeInteger(day[key])))) {
      throw new ApiError(500, payload, "The reading preview was incomplete.", "invalid_response");
    }
    return payload;
  },

  async applyPreview(periodId, body) {
    const payload = objectPayload(await request(`/study-plan/v2/exams/${encodeURIComponent(periodId)}/apply`, { method: "POST", body, retryable: true, allowOfflineQueue: false }), "The plan could not be saved.");
    if (payload.persisted !== true || typeof payload.run_id !== "string" || !nonnegativeInteger(payload.unscheduled_count) || !nonnegativeInteger(payload.issues_count) || !nonnegativeInteger(payload.created_count) || payload.created_count > 3000 || !Array.isArray(payload.item_ids) || payload.item_ids.length !== payload.created_count || payload.item_ids.some(id => typeof id !== "string") || !dateValue(payload.first_date)) throw new ApiError(500, payload, "The plan receipt was incomplete.", "invalid_response");
    return payload;
  },

  async getPlan({ from, to, user }) {
    const params = new URLSearchParams({ from, to });
    let raw;
    try { raw = await request(`/study-plan?${params.toString()}`); }
    catch (error) { const saved = isConnectivityError(error) && await restorePlan(user, `week:${from}`); if (saved) return { ...saved.payload, offline: true, saved_at: saved.savedAt }; throw error; }
    const payload = objectPayload(
      raw,
      "The study-plan response was incomplete."
    );
    if (!Array.isArray(payload.results) || !payload.summary || typeof payload.count !== "number") {
      throw new ApiError(500, payload, "The study-plan response was incomplete.", "invalid_response");
    }
    await rememberPlan(user, `week:${from}`, payload);
    return payload;
  },

  reportTaskProgress(userId, itemId, body) { return submitPlanProgress(userId, `/study-plan/items/${encodeURIComponent(itemId)}/progress`, body); },
  reportReading(userId, periodId, body) { return submitPlanProgress(userId, `/study-plan/v2/exams/${encodeURIComponent(periodId)}/reading-progress`, body); },

  async createItem(item) {
    return objectPayload(
      await request("/study-plan/items", {
        method: "POST",
        body: {
          title: item.title,
          subject: item.subject,
          scheduled_date: item.scheduledDate,
          duration_minutes: item.durationMinutes,
          ...(item.clientRequestId ? { client_request_id: item.clientRequestId } : {})
        }
      }),
      "The study task could not be created."
    );
  },

  async updateItem(itemId, changes) {
    return objectPayload(
      await request(`/study-plan/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: changes
      }),
      "The study task could not be updated."
    );
  },

  async deleteItem(itemId, revision) {
    const query = revision === undefined ? "" : `?revision=${encodeURIComponent(revision)}`;
    await request(`/study-plan/items/${encodeURIComponent(itemId)}${query}`, { method: "DELETE" });
  },

  async saveProfile(profile, revision) {
    return objectPayload(await request("/study-plan/profile", {
      method: "PATCH", body: { ...profile, expected_revision: revision }
    }), "The plan settings could not be saved.");
  },

  async previewWeek(start) {
    return objectPayload(await request("/study-plan/preview", {
      method: "POST", body: { start_date: start }
    }), "The plan preview could not be loaded.");
  },

  async generateWeek(start, token) {
    return objectPayload(await request("/study-plan/generate", {
      method: "POST", body: { start_date: start, preview_token: token }
    }), "The plan could not be generated.");
  }
};
