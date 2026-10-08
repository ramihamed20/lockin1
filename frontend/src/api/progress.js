import { objectPayload, pagePayload } from "./payloads.js";
import { request } from "./client.js";
import { buildQueryString } from "./pagination.js";

/** Server-authoritative bookmarks and learning progress. */
export const progressApi = {
  async learningDashboard() {
    return objectPayload(
      await request("/learning/dashboard"),
      "The learning dashboard response was incomplete."
    );
  },

  async listBookmarks({ page = 1, pageSize = 25 } = {}) {
    const payload = await request("/bookmarks" + buildQueryString({ page, page_size: pageSize }));
    return pagePayload(payload, "The bookmark list response was incomplete.");
  },

  async createBookmark(learningObjectId) {
    return objectPayload(
      await request("/bookmarks", { method: "POST", body: { learning_object_id: learningObjectId } }),
      "The bookmark response was incomplete."
    );
  },

  removeBookmark: (learningObjectId) =>
    request(`/bookmarks/${learningObjectId}`, { method: "DELETE" }),

  async getCatalogBookmark(materialSlug, sheetSlug) {
    return objectPayload(
      await request(`/bookmarks/catalog/${encodeURIComponent(materialSlug)}/${encodeURIComponent(sheetSlug)}`),
      "The catalog bookmark response was incomplete."
    );
  },

  async createCatalogBookmark({ materialSlug, materialTitle, sheetSlug, sheetTitle, position = {} }) {
    return objectPayload(
      await request("/bookmarks", {
        method: "POST",
        body: {
          catalog_material_slug: materialSlug,
          catalog_material_title: materialTitle,
          catalog_sheet_slug: sheetSlug,
          catalog_sheet_title: sheetTitle,
          position
        }
      }),
      "The catalog bookmark response was incomplete."
    );
  },

  removeCatalogBookmark: (materialSlug, sheetSlug) =>
    request(`/bookmarks/catalog/${encodeURIComponent(materialSlug)}/${encodeURIComponent(sheetSlug)}`, { method: "DELETE" }),

  async listResume({ page = 1, pageSize = 25 } = {}) {
    const payload = await request("/progress/resume" + buildQueryString({ page, page_size: pageSize }));
    return pagePayload(payload, "The resume list response was incomplete.");
  },

  async getLearningObjectProgress(learningObjectId) {
    return objectPayload(
      await request(`/progress/learning-objects/${learningObjectId}`),
      "The learning-progress response was incomplete."
    );
  },

  async updateLearningObjectProgress(learningObjectId, { expectedRevision, status, completionPercent, position }) {
    return objectPayload(
      await request(`/progress/learning-objects/${learningObjectId}`, {
        method: "PUT",
        body: {
          expected_revision: expectedRevision,
          status,
          completion_percent: completionPercent,
          position
        }
      }),
      "The learning-progress response was incomplete."
    );
  }
};
