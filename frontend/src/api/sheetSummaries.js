import { objectPayload } from "./payloads.js";
import { request } from "./client.js";

/** My Summary: a student's own summaries of a catalog sheet (at most two a sheet). */
export const sheetSummariesApi = {
  async list() {
    const payload = objectPayload(await request("/catalog/summaries"), "Your summaries could not be loaded.");
    return /** @type {any[]} */ (payload.results || []);
  },
  async forDocument(documentId) {
    const payload = objectPayload(await request(`/catalog/documents/${documentId}/summaries`), "Summaries could not be loaded.");
    return { results: /** @type {any[]} */ (payload.results || []), maxPerSheet: Number(payload.max_per_sheet) || 2 };
  },
  async create(documentId, { title, mode, color }) {
    const payload = objectPayload(await request(`/catalog/documents/${documentId}/summaries`, { method: "POST", body: { title, mode, color } }), "The summary could not be started.");
    return /** @type {any} */ (payload.summary);
  },
  async update(summaryId, changes) {
    const payload = objectPayload(await request(`/catalog/summaries/${summaryId}`, { method: "PATCH", body: changes }), "The summary could not be saved.");
    return /** @type {any} */ (payload.summary);
  },
  async remove(summaryId) {
    await request(`/catalog/summaries/${summaryId}`, { method: "DELETE" });
  }
};
