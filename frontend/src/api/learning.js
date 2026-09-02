import { ApiError, request } from "./client.js";
import { normalizePaginatedResponse } from "./contracts.js";
import { buildQueryString } from "./pagination.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

function pagePayload(payload, message) {
  const source = objectPayload(payload, message);
  if (!Array.isArray(source.results) || typeof source.count !== "number") {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return normalizePaginatedResponse(source);
}

/**
 * Public, server-filtered education hierarchy. It deliberately accepts only
 * the documented immediate-parent filter; descendant traversal is performed
 * through user navigation, not guessed client-side paths.
 */
export const educationApi = {
  async listNodes({ parentId = null, page = 1, pageSize = 25 } = {}) {
    const payload = await request(
      "/education/nodes" + buildQueryString({ parent: parentId, page, page_size: pageSize })
    );
    return pagePayload(payload, "The education-node list response was incomplete.");
  },

  async getNode(nodeId) {
    const payload = objectPayload(
      await request(`/education/nodes/${nodeId}`),
      "The education-node response was incomplete."
    );
    if (!payload.node || typeof payload.node !== "object" || !Array.isArray(payload.breadcrumbs)) {
      throw new ApiError(500, payload, "The education-node response was incomplete.", "invalid_response");
    }
    return payload;
  }
};

/** Public learning-object discovery and detail. */
export const learningApi = {
  async listLearningObjects({ nodeId = null, contentType = null, page = 1, pageSize = 25 } = {}) {
    const payload = await request(
      "/learning-objects" +
        buildQueryString({ node: nodeId, content_type: contentType, page, page_size: pageSize })
    );
    return pagePayload(payload, "The learning-object list response was incomplete.");
  },

  async getLearningObject(learningObjectId) {
    return objectPayload(
      await request(`/learning-objects/${learningObjectId}`),
      "The learning-object response was incomplete."
    );
  }
};

/** Authenticated, server-indexed search. */
export const discoveryApi = {
  /**
   * @param {{query?: string, kinds?: string[], contentTypes?: string[], academicPath?: string, limit?: number | null, page?: number, pageSize?: number, signal?: AbortSignal}} [options]
   */
  async search({ query = "", kinds = [], contentTypes = [], academicPath = "", limit = null, page = 1, pageSize = 25, signal } = {}) {
    const paging = limit == null ? { page, page_size: pageSize } : { limit };
    const payload = await request(
      "/search" +
        buildQueryString({
          q: query,
          kinds,
          content_types: contentTypes,
          academic_path: academicPath,
          ...paging
        }),
      { signal }
    );
    return pagePayload(payload, "The search response was incomplete.");
  }
};

/** Account-scoped dashboard metadata. Learning activity lives in progressApi. */
export const dashboardApi = {
  async accountDashboard() {
    return objectPayload(
      await request("/dashboard"),
      "The account dashboard response was incomplete."
    );
  }
};
