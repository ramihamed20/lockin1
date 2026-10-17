import { ApiError, request } from "./client.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return payload;
}

export const studyPlanApi = {
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
