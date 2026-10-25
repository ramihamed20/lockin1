import { ApiError, request } from "./client.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return payload;
}

const nonnegativeInteger = value => Number.isInteger(value) && value >= 0;
const dateValue = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const previewTask = task => task && typeof task.key === "string" && typeof task.title === "string"
  && Number.isInteger(task.page_start) && task.page_start >= 1
  && Number.isInteger(task.page_end) && task.page_end >= task.page_start
  && Number.isInteger(task.estimated_minutes) && task.estimated_minutes > 0 && task.estimated_minutes <= 480;

export const studyPlanApi = {
  /** @param {{signal?: AbortSignal}} [options] */
  async getExams({ signal } = {}) {
    const payload = objectPayload(await request("/study-plan/v2/exams", { signal }), "The exam response was incomplete.");
    if (payload.enabled !== true || payload.schema_version !== 1 || !Array.isArray(payload.results)
      || payload.results.some(exam => typeof exam.id !== "string" || typeof exam.title !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(exam.starts_on) || !["tentative", "confirmed"].includes(exam.status))) {
      throw new ApiError(500, payload, "The exam response was incomplete.", "invalid_response");
    }
    return payload.results;
  },

  /** @param {string} periodId @param {string} edition @param {{signal?: AbortSignal}} [options] */
  async previewReading(periodId, edition, { signal } = {}) {
    const payload = objectPayload(await request(`/study-plan/v2/exams/${encodeURIComponent(periodId)}/reading-preview`, {
      method: "POST", body: { edition }, signal
    }), "The reading preview was incomplete.");
    if (payload.kind !== "reading_only_preview" || payload.persisted !== false
      || !Array.isArray(payload.assignments) || !Array.isArray(payload.unscheduled)
      || !Array.isArray(payload.issues) || !Array.isArray(payload.days)
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

  async getPlan({ from, to }) {
    const params = new URLSearchParams({ from, to });
    const payload = objectPayload(
      await request(`/study-plan?${params.toString()}`),
      "The study-plan response was incomplete."
    );
    if (!Array.isArray(payload.results) || !payload.summary || typeof payload.count !== "number") {
      throw new ApiError(500, payload, "The study-plan response was incomplete.", "invalid_response");
    }
    return payload;
  },

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
