import { request } from "./client.js";

export const rescueApi = {
  suggestions: (documentId = "", page = null) => request("/focus/rescue/suggestions?" + new URLSearchParams({
    ...(documentId ? { document_id: documentId } : {}), ...(page === null ? {} : { page: String(page) }),
  })),
  save: (id, body) => request(`/focus/rescue/sessions/${encodeURIComponent(id)}`, {
    method: "PUT", body, retryable: true, allowOfflineQueue: false,
  }),
};
