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

const SESSION_ACTIONS = new Set(["pause", "resume", "complete", "abandon"]);
const SIDEBARS = new Set(["closed", "thumbnails", "notes"]);
const WORKSPACE_TOOLS = new Set(["", "pen", "pencil", "highlighter", "eraser", "line", "arrow", "rectangle", "circle", "text", "sticky-note"]);

/** Server-authoritative Focus document, session, workspace, and annotation contracts. */
export const focusApi = {
  async getDocument(documentVersionId) {
    const payload = objectPayload(
      await request(`/focus/documents/${documentVersionId}`),
      "The Focus document response was incomplete."
    );
    if (!payload.document || typeof payload.document !== "object" || typeof payload.annotation_revision !== "number") {
      throw new ApiError(500, payload, "The Focus document response was incomplete.", "invalid_response");
    }
    return payload;
  },

  async listSessions({ page = 1, pageSize = 25 } = {}) {
    return pagePayload(
      await request("/focus/sessions" + buildQueryString({ page, page_size: pageSize })),
      "The Focus session-history response was incomplete."
    );
  },

  async startSession({ documentVersionId, clientInstanceId, plannedDurationSeconds = null }) {
    if (typeof documentVersionId !== "string" || !documentVersionId || typeof clientInstanceId !== "string" || !clientInstanceId) {
      throw new ApiError(0, null, "A document version and stable client session ID are required.", "invalid_request");
    }
    const body = {
      document_version_id: documentVersionId,
      client_instance_id: clientInstanceId
    };
    if (plannedDurationSeconds != null) body.planned_duration_seconds = plannedDurationSeconds;
    return objectPayload(
      await request("/focus/sessions", { method: "POST", body }),
      "The Focus session response was incomplete."
    );
  },

  async sessionAction(sessionId, action) {
    if (!SESSION_ACTIONS.has(action)) {
      throw new ApiError(0, null, "This Focus session action is not supported.", "invalid_request");
    }
    return objectPayload(
      await request(`/focus/sessions/${sessionId}/${action}`, { method: "POST", body: {} }),
      "The Focus session action response was incomplete."
    );
  },

  async updateWorkspace(sessionId, { expectedRevision, currentPage, pageCount = null, zoom, sidebar, activeTool = "", layout = {}, openTabs = [] }) {
    if (!SIDEBARS.has(sidebar) || !WORKSPACE_TOOLS.has(activeTool)) {
      throw new ApiError(0, null, "The Focus workspace state contains an unsupported value.", "invalid_request");
    }
    const body = {
      expected_revision: expectedRevision,
      current_page: currentPage,
      zoom,
      sidebar,
      active_tool: activeTool,
      layout,
      open_tabs: openTabs
    };
    if (pageCount != null) body.page_count = pageCount;
    return objectPayload(
      await request(`/focus/sessions/${sessionId}/workspace`, { method: "PATCH", body }),
      "The Focus workspace response was incomplete."
    );
  },

  async getAnnotations(documentVersionId, { pages = [1], page = 1, pageSize = 250 } = {}) {
    const validPages = Array.from(new Set(pages.map(Number).filter((value) => Number.isInteger(value) && value > 0))).slice(0, 10);
    if (!validPages.length || pages.length > 10) {
      throw new ApiError(0, null, "Focus annotations can load one to ten valid pages at a time.", "invalid_request");
    }
    const payload = objectPayload(
      await request(`/focus/documents/${documentVersionId}/annotations` + buildQueryString({ pages: validPages, page, page_size: pageSize })),
      "The Focus annotation response was incomplete."
    );
    if (typeof payload.collection_revision !== "number") {
      throw new ApiError(500, payload, "The Focus annotation response was incomplete.", "invalid_response");
    }
    return {
      ...pagePayload(payload, "The Focus annotation response was incomplete."),
      collection_revision: payload.collection_revision
    };
  },

  async syncAnnotations(documentVersionId, { expectedCollectionRevision, idempotencyKey, annotations = [], deletedIds = [] }) {
    if (annotations.length + deletedIds.length > 100) {
      throw new ApiError(0, null, "A Focus sync can contain at most 100 mutations.", "invalid_request");
    }
    return objectPayload(
      await request(`/focus/documents/${documentVersionId}/annotations`, {
        method: "POST",
        body: {
          expected_collection_revision: expectedCollectionRevision,
          idempotency_key: idempotencyKey,
          annotations,
          deleted_ids: deletedIds
        }
      }),
      "The Focus annotation sync response was incomplete."
    );
  }
};
