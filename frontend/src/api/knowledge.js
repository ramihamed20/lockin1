import { request } from "./client.js";

export const knowledgeApi = {
  library: () => request("/knowledge/library"),
  mcqLinks: (id, attemptId) => request(String(attemptId).startsWith("result:")
    ? `/knowledge/documents/${id}/mcq-runs/${String(attemptId).slice(7)}/explain-links`
    : `/knowledge/documents/${id}/mcq-attempts/${attemptId}/explain-links`),
  bootstrap: (id) => request(`/knowledge/documents/${id}`),
  detail: (id, artifactId) => request(`/knowledge/documents/${id}/artifacts/${artifactId}`),
  save: (id, artifactId, body) => request(`/knowledge/documents/${id}/artifacts/${artifactId}`, {
    method: "PUT", body, retryable: true, allowOfflineQueue: false,
  }),
  attempt: (id, attemptId, body) => request(`/knowledge/documents/${id}/attempts/${attemptId}`, {
    method: "PUT", body, retryable: true, allowOfflineQueue: false,
  }),
};
