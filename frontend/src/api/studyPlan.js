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
          duration_minutes: item.durationMinutes
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

  async deleteItem(itemId) {
    await request(`/study-plan/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  }
};
