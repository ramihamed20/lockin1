import { ApiError, request } from "./client.js";

function results(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.results)) {
    throw new ApiError(500, payload, "The suggestions response was incomplete.", "invalid_response");
  }
  return payload;
}

export const feedbackApi = {
  async list() {
    return results(await request("/feedback"));
  },

  async submit({ category, message }) {
    const payload = await request("/feedback", { method: "POST", body: { category, message } });
    if (!payload || typeof payload !== "object" || typeof payload.id !== "string") {
      throw new ApiError(500, payload, "The suggestion could not be saved.", "invalid_response");
    }
    return payload;
  },

  async adminList({ status = "", page = 1 } = {}) {
    const params = new URLSearchParams({ page: String(page), page_size: "25" });
    if (status) params.set("status", status);
    const payload = await request(`/operations/admin/feedback?${params.toString()}`);
    if (typeof payload?.count !== "number") {
      throw new ApiError(500, payload, "The suggestions response was incomplete.", "invalid_response");
    }
    return results(payload);
  },

  async adminUpdate(id, changes) {
    return request(`/operations/admin/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: changes
    });
  }
};
