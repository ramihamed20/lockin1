import { API_BASE_PATH, ApiError, request } from "./client.js";
import { buildQueryString, generateIdempotencyKey } from "./pagination.js";

const DISCUSSION_PAGE_SIZE = 20;
const COMMENT_PAGE_SIZE = 40;
const SPACE_PAGE_SIZE = 20;
const REPORT_PAGE_SIZE = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

function requireId(source, payload, message) {
  if (typeof source.id !== "string" || !source.id) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return source;
}

function cursorForEndpoint(value, endpoint) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, "http://lock-in.invalid");
    const apiEndpoint = `${API_BASE_PATH === "/" ? "" : API_BASE_PATH}${endpoint}`;
    return url.pathname === apiEndpoint ? url.searchParams.get("cursor") : null;
  } catch {
    return null;
  }
}

function cursorPayload(payload, endpoint, message) {
  const source = objectPayload(payload, message);
  if (!Array.isArray(source.results)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return {
    results: source.results,
    nextCursor: cursorForEndpoint(source.next, endpoint),
    previousCursor: cursorForEndpoint(source.previous, endpoint)
  };
}

function discussionPayload(payload, message) {
  return requireId(objectPayload(payload, message), payload, message);
}

function commentPayload(payload, message) {
  return requireId(objectPayload(payload, message), payload, message);
}

function spacePayload(payload, message) {
  return requireId(objectPayload(payload, message), payload, message);
}

function reportPayload(payload, message) {
  return requireId(objectPayload(payload, message), payload, message);
}

function compactText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uuid(value, label = "identifier") {
  const id = compactText(value);
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError(0, null, `A valid ${label} is required.`, "invalid_request");
  }
  return id;
}

function ensureContextPair(contextType, contextId) {
  const type = compactText(contextType);
  const id = compactText(contextId);
  if (Boolean(type) !== Boolean(id)) {
    throw new ApiError(0, null, "A learning context type and identifier must be provided together.", "invalid_request");
  }
  return { type, id: id ? uuid(id, "learning context identifier") : "" };
}

function discussionQuery({ contextType = "", contextId = "", spaceId = "", cursor = null, pageSize = DISCUSSION_PAGE_SIZE } = {}) {
  const context = ensureContextPair(contextType, contextId);
  return buildQueryString({
    context_type: context.type || null,
    context_id: context.id || null,
    space_id: compactText(spaceId) || null,
    cursor,
    page_size: pageSize
  });
}

/** Contextual community and reporter APIs. Server controls visibility and permissions. */
export const communityApi = {
  async listDiscussions(filters = {}) {
    const payload = await request("/community/discussions" + discussionQuery(filters));
    return cursorPayload(payload, "/community/discussions", "The discussion list response was incomplete.");
  },

  async getDiscussion(discussionId) {
    const id = uuid(discussionId, "discussion identifier");
    return discussionPayload(
      await request(`/community/discussions/${id}`),
      "The discussion response was incomplete."
    );
  },

  async createDiscussion({ contextType, contextId, spaceId = null, title, body, clientRequestId = generateIdempotencyKey() }) {
    const rawSpaceId = compactText(spaceId);
    return discussionPayload(
      await request("/community/discussions", {
        method: "POST",
        body: {
          context_type: compactText(contextType),
          context_id: uuid(contextId, "learning context identifier"),
          space_id: rawSpaceId ? uuid(rawSpaceId, "space identifier") : null,
          title: compactText(title),
          body: compactText(body),
          client_request_id: clientRequestId
        }
      }),
      "The discussion response was incomplete."
    );
  },

  async updateDiscussion(discussionId, { expectedRevision, title, body }) {
    const id = uuid(discussionId, "discussion identifier");
    return discussionPayload(
      await request(`/community/discussions/${id}`, {
        method: "PATCH",
        body: { expected_revision: expectedRevision, title: compactText(title), body: compactText(body) }
      }),
      "The updated discussion response was incomplete."
    );
  },

  async deleteDiscussion(discussionId, expectedRevision) {
    const id = uuid(discussionId, "discussion identifier");
    return discussionPayload(
      await request(`/community/discussions/${id}`, {
        method: "DELETE",
        body: { expected_revision: expectedRevision }
      }),
      "The deleted discussion response was incomplete."
    );
  },

  async listComments(discussionId, { cursor = null, pageSize = COMMENT_PAGE_SIZE } = {}) {
    const endpoint = `/community/discussions/${uuid(discussionId, "discussion identifier")}/comments`;
    const payload = await request(endpoint + buildQueryString({ cursor, page_size: pageSize }));
    return cursorPayload(payload, endpoint, "The discussion-comment response was incomplete.");
  },

  async createComment(discussionId, { parentId = null, body, clientRequestId = generateIdempotencyKey() }) {
    const id = uuid(discussionId, "discussion identifier");
    const rawParentId = compactText(parentId);
    return commentPayload(
      await request(`/community/discussions/${id}/comments`, {
        method: "POST",
        body: { parent_id: rawParentId ? uuid(rawParentId, "parent reply identifier") : null, body: compactText(body), client_request_id: clientRequestId }
      }),
      "The comment response was incomplete."
    );
  },

  async updateComment(commentId, { expectedRevision, body }) {
    const id = uuid(commentId, "comment identifier");
    return commentPayload(
      await request(`/community/comments/${id}`, {
        method: "PATCH",
        body: { expected_revision: expectedRevision, body: compactText(body) }
      }),
      "The updated comment response was incomplete."
    );
  },

  async deleteComment(commentId, expectedRevision) {
    const id = uuid(commentId, "comment identifier");
    return commentPayload(
      await request(`/community/comments/${id}`, {
        method: "DELETE",
        body: { expected_revision: expectedRevision }
      }),
      "The deleted comment response was incomplete."
    );
  },

  async listSpaces({ cursor = null, pageSize = SPACE_PAGE_SIZE } = {}) {
    const payload = await request("/community/spaces" + buildQueryString({ cursor, page_size: pageSize }));
    return cursorPayload(payload, "/community/spaces", "The community-space response was incomplete.");
  },

  async getSpace(spaceId) {
    const id = uuid(spaceId, "space identifier");
    return spacePayload(await request(`/community/spaces/${id}`), "The community-space response was incomplete.");
  },

  async createSpace({ contextType, contextId, title, description = "" }) {
    return spacePayload(
      await request("/community/spaces", {
        method: "POST",
        body: {
          context_type: compactText(contextType),
          context_id: uuid(contextId, "learning context identifier"),
          title: compactText(title),
          description: compactText(description)
        }
      }),
      "The community-space response was incomplete."
    );
  },

  async addSpaceMember(spaceId, { userId = null, email = null, role }) {
    const spaceIdentifier = uuid(spaceId, "space identifier");
    const memberIdentifier = compactText(userId);
    const address = compactText(email);
    if (Boolean(memberIdentifier) === Boolean(address)) {
      throw new ApiError(0, null, "Provide exactly one member email or user identifier.", "invalid_request");
    }
    return objectPayload(
      await request(`/community/spaces/${spaceIdentifier}/members`, {
        method: "POST",
        body: { ...(memberIdentifier ? { user_id: uuid(memberIdentifier, "member identifier") } : { email: address }), role: compactText(role) }
      }),
      "The space-member response was incomplete."
    );
  },

  async removeSpaceMember(spaceId, userId) {
    const id = uuid(spaceId, "space identifier");
    const memberId = uuid(userId, "member identifier");
    return objectPayload(
      await request(`/community/spaces/${id}/members/${memberId}`, { method: "DELETE", body: {} }),
      "The space-member response was incomplete."
    );
  }
};

export const moderationApi = {
  async listReports({ status = null, targetType = null, assignment = null, cursor = null, pageSize = REPORT_PAGE_SIZE } = {}) {
    const payload = await request(
      "/moderation/reports" + buildQueryString({ status, target_type: targetType, assignment, cursor, page_size: pageSize })
    );
    return cursorPayload(payload, "/moderation/reports", "The moderation-report response was incomplete.");
  },

  async getReport(reportId) {
    const id = uuid(reportId, "report identifier");
    return reportPayload(await request(`/moderation/reports/${id}`), "The moderation-report response was incomplete.");
  },

  async createReport({ targetType, targetId, reason, description, clientRequestId = generateIdempotencyKey() }) {
    return reportPayload(
      await request("/moderation/reports", {
        method: "POST",
        body: {
          target_type: compactText(targetType),
          target_id: uuid(targetId, "report target identifier"),
          reason: compactText(reason),
          description: compactText(description),
          client_request_id: clientRequestId
        }
      }),
      "The moderation-report response was incomplete."
    );
  },

  async assignReport(reportId, { expectedRevision, assigneeId }) {
    const id = uuid(reportId, "report identifier");
    return reportPayload(
      await request(`/moderation/reports/${id}/assign`, {
        method: "POST",
        body: {
          expected_revision: expectedRevision,
          assignee_id: uuid(assigneeId, "assignee identifier")
        }
      }),
      "The assigned moderation-report response was incomplete."
    );
  },

  async transitionReport(reportId, { expectedRevision, status, resolutionNotes = "", duplicateOfId = null, contentAction = null }) {
    const id = uuid(reportId, "report identifier");
    const duplicate = compactText(duplicateOfId);
    return reportPayload(
      await request(`/moderation/reports/${id}/transition`, {
        method: "POST",
        body: {
          expected_revision: expectedRevision,
          status: compactText(status),
          resolution_notes: compactText(resolutionNotes),
          duplicate_of_id: duplicate ? uuid(duplicate, "original report identifier") : null,
          content_action: compactText(contentAction) || null
        }
      }),
      "The moderated report response was incomplete."
    );
  },

  async listAudit({ cursor = null, pageSize = REPORT_PAGE_SIZE } = {}) {
    const payload = await request("/moderation/audit" + buildQueryString({ cursor, page_size: pageSize }));
    return cursorPayload(payload, "/moderation/audit", "The moderation-audit response was incomplete.");
  }
};

export const COMMUNITY_CONTEXT_TYPES = Object.freeze(["lesson", "learning_object", "question", "quiz"]);
export const SPACE_CONTEXT_TYPES = Object.freeze(["lesson", "learning_object"]);
export const SPACE_MEMBER_ROLES = Object.freeze(["member", "moderator"]);
export const REPORT_REASONS = Object.freeze(["spam", "abuse", "incorrect_question", "incorrect_answer", "incorrect_explanation", "duplicate", "other"]);
